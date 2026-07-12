import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { homedir } from 'os'
import { dirname, join, normalize, resolve } from 'path'

export type McpRegistrationTarget = 'cursor' | 'claudeCode' | 'codex' | 'opencode'

export interface McpLaunchSpec {
  command: string
  scriptPath: string
}

export interface McpRegistrationTargetStatus {
  id: McpRegistrationTarget
  label: string
  configPath: string
  registered: boolean
  stale: boolean
  detail?: string
}

export interface McpRegistrationResult {
  id: McpRegistrationTarget
  ok: boolean
  message: string
}

const SERVER_KEY = 'nodeshell'

const TARGET_META: Array<{ id: McpRegistrationTarget; label: string }> = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'claudeCode', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' }
]

export function normalizePathForCompare(p: string): string {
  return normalize(resolve(p)).replace(/\\/g, '/').toLowerCase()
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePathForCompare(a) === normalizePathForCompare(b)
}

export function configPathForTarget(
  target: McpRegistrationTarget,
  home = homedir()
): string {
  switch (target) {
    case 'cursor':
      return join(home, '.cursor', 'mcp.json')
    case 'claudeCode':
      return join(home, '.claude.json')
    case 'codex':
      return join(home, '.codex', 'config.toml')
    case 'opencode':
      return join(home, '.config', 'opencode', 'opencode.json')
  }
}

export interface McpAppPaths {
  appRoot: string
  isPackaged?: boolean
  resourcesPath?: string
}

export async function resolveMcpLauncherScript(
  paths: McpAppPaths | string
): Promise<string | null> {
  const opts: McpAppPaths = typeof paths === 'string' ? { appRoot: paths } : paths
  const candidates: string[] = []
  if (opts.isPackaged && opts.resourcesPath) {
    candidates.push(join(opts.resourcesPath, 'mcp', 'nodeshell-mcp.mjs'))
  }
  candidates.push(
    join(opts.appRoot, 'scripts', 'nodeshell-mcp.mjs'),
    join(opts.appRoot, 'resources', 'mcp', 'nodeshell-mcp.mjs'),
    // Legacy worktree layouts while MCP lived on a sibling branch
    join(opts.appRoot, '.worktrees', 'mcp-ssh-server', 'scripts', 'nodeshell-mcp.mjs'),
    join(opts.appRoot, '..', 'mcp-ssh-server', 'scripts', 'nodeshell-mcp.mjs'),
    join(opts.appRoot, '..', '..', '.worktrees', 'mcp-ssh-server', 'scripts', 'nodeshell-mcp.mjs')
  )
  for (const c of candidates) {
    try {
      await access(c, fsConstants.R_OK)
      return resolve(c)
    } catch {
      /* try next */
    }
  }
  return null
}

export function buildLaunchSpec(scriptPath: string): McpLaunchSpec {
  // Prefer forward slashes in configs so JSON/TOML escaping stays unambiguous on Windows.
  return { command: 'node', scriptPath: resolve(scriptPath).replace(/\\/g, '/') }
}

export function buildClipboardSnippet(spec: McpLaunchSpec): string {
  const script = spec.scriptPath.replace(/\\/g, '/')
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_KEY]: {
          command: spec.command,
          args: [script]
        }
      }
    },
    null,
    2
  )
}

function extractScriptFromArgs(args: unknown): string | null {
  if (!Array.isArray(args) || args.length === 0) return null
  const last = args[args.length - 1]
  return typeof last === 'string' ? last : null
}

export function isRegisteredInMcpServersJson(
  raw: unknown,
  expectedScript: string
): { registered: boolean; stale: boolean } {
  if (!raw || typeof raw !== 'object') return { registered: false, stale: false }
  const servers = (raw as { mcpServers?: unknown }).mcpServers
  if (!servers || typeof servers !== 'object') return { registered: false, stale: false }
  const entry = (servers as Record<string, unknown>)[SERVER_KEY]
  if (!entry || typeof entry !== 'object') return { registered: false, stale: false }
  const script = extractScriptFromArgs((entry as { args?: unknown }).args)
  if (!script) return { registered: true, stale: true }
  const match = pathsEqual(script, expectedScript)
  return { registered: match, stale: !match }
}

export function isRegisteredInOpenCodeJson(
  raw: unknown,
  expectedScript: string
): { registered: boolean; stale: boolean } {
  if (!raw || typeof raw !== 'object') return { registered: false, stale: false }
  const mcp = (raw as { mcp?: unknown }).mcp
  if (!mcp || typeof mcp !== 'object') return { registered: false, stale: false }
  const entry = (mcp as Record<string, unknown>)[SERVER_KEY]
  if (!entry || typeof entry !== 'object') return { registered: false, stale: false }
  const command = (entry as { command?: unknown }).command
  if (!Array.isArray(command) || command.length < 2) return { registered: true, stale: true }
  const script = command[command.length - 1]
  if (typeof script !== 'string') return { registered: true, stale: true }
  const match = pathsEqual(script, expectedScript)
  return { registered: match, stale: !match }
}

export function isRegisteredInCodexToml(
  text: string,
  expectedScript: string
): { registered: boolean; stale: boolean } {
  if (!/\[mcp_servers\.nodeshell\]/.test(text)) {
    return { registered: false, stale: false }
  }
  const argsMatch = text.match(/\[mcp_servers\.nodeshell\][\s\S]*?args\s*=\s*(\[[^\]]*\])/)
  if (!argsMatch) return { registered: true, stale: true }
  try {
    const scripts = JSON.parse(argsMatch[1]) as unknown
    if (!Array.isArray(scripts) || scripts.length === 0) {
      return { registered: true, stale: true }
    }
    const script = scripts[scripts.length - 1]
    if (typeof script !== 'string') return { registered: true, stale: true }
    const match = pathsEqual(script, expectedScript)
    return { registered: match, stale: !match }
  } catch {
    return { registered: true, stale: true }
  }
}

export function mergeMcpServersJson(existingRaw: string | null, spec: McpLaunchSpec): string {
  let root: Record<string, unknown> = {}
  if (existingRaw && existingRaw.trim()) {
    const parsed = JSON.parse(existingRaw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Config is not a JSON object')
    }
    root = parsed as Record<string, unknown>
  }
  const servers =
    root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
      ? { ...(root.mcpServers as Record<string, unknown>) }
      : {}
  servers[SERVER_KEY] = {
    command: spec.command,
    args: [spec.scriptPath]
  }
  root.mcpServers = servers
  return `${JSON.stringify(root, null, 2)}\n`
}

export function mergeOpenCodeJson(existingRaw: string | null, spec: McpLaunchSpec): string {
  let root: Record<string, unknown> = {}
  if (existingRaw && existingRaw.trim()) {
    const parsed = JSON.parse(existingRaw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Config is not a JSON object')
    }
    root = parsed as Record<string, unknown>
  }
  const mcp =
    root.mcp && typeof root.mcp === 'object' && !Array.isArray(root.mcp)
      ? { ...(root.mcp as Record<string, unknown>) }
      : {}
  mcp[SERVER_KEY] = {
    type: 'local',
    command: [spec.command, spec.scriptPath],
    enabled: true
  }
  root.mcp = mcp
  if (!root.$schema) root.$schema = 'https://opencode.ai/config.json'
  return `${JSON.stringify(root, null, 2)}\n`
}

export function mergeCodexToml(existingRaw: string | null, spec: McpLaunchSpec): string {
  const scriptJson = JSON.stringify(spec.scriptPath)
  const block = `[mcp_servers.${SERVER_KEY}]\ncommand = ${JSON.stringify(spec.command)}\nargs = [${scriptJson}]\n`
  const text = existingRaw ?? ''
  const re = new RegExp(
    `\\[mcp_servers\\.${SERVER_KEY}\\][^\\[]*`,
    'm'
  )
  if (re.test(text)) {
    return text.replace(re, block).replace(/\n*$/, '\n')
  }
  const trimmed = text.replace(/\s*$/, '')
  return trimmed ? `${trimmed}\n\n${block}` : block
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') return null
    throw err
  }
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export class McpRegistrationService {
  constructor(
    private readonly getPaths: () => McpAppPaths | string,
    private readonly getHome: () => string = homedir
  ) {}

  async getLaunchSpec(): Promise<McpLaunchSpec> {
    const script = await resolveMcpLauncherScript(this.getPaths())
    if (!script) {
      throw new Error(
        'nodeshell-mcp.mjs not found — reinstall NodeShell or run from a built checkout'
      )
    }
    return buildLaunchSpec(script)
  }

  async status(): Promise<McpRegistrationTargetStatus[]> {
    let spec: McpLaunchSpec | null = null
    let launcherError: string | undefined
    try {
      spec = await this.getLaunchSpec()
    } catch (err) {
      launcherError = err instanceof Error ? err.message : String(err)
    }

    const home = this.getHome()
    const out: McpRegistrationTargetStatus[] = []
    for (const meta of TARGET_META) {
      const configPath = configPathForTarget(meta.id, home)
      if (!spec) {
        out.push({
          ...meta,
          configPath,
          registered: false,
          stale: false,
          detail: launcherError
        })
        continue
      }
      try {
        const raw = await readTextIfExists(configPath)
        let registered = false
        let stale = false
        if (raw != null) {
          if (meta.id === 'codex') {
            ;({ registered, stale } = isRegisteredInCodexToml(raw, spec.scriptPath))
          } else if (meta.id === 'opencode') {
            const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : {}
            ;({ registered, stale } = isRegisteredInOpenCodeJson(parsed, spec.scriptPath))
          } else {
            const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : {}
            ;({ registered, stale } = isRegisteredInMcpServersJson(parsed, spec.scriptPath))
          }
        }
        out.push({ ...meta, configPath, registered, stale })
      } catch (err) {
        out.push({
          ...meta,
          configPath,
          registered: false,
          stale: false,
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return out
  }

  async register(target: McpRegistrationTarget | 'all'): Promise<McpRegistrationResult[]> {
    const spec = await this.getLaunchSpec()
    const ids =
      target === 'all' ? TARGET_META.map((t) => t.id) : ([target] as McpRegistrationTarget[])
    const results: McpRegistrationResult[] = []
    for (const id of ids) {
      results.push(await this.registerOne(id, spec))
    }
    return results
  }

  async clipboardSnippet(): Promise<string> {
    return buildClipboardSnippet(await this.getLaunchSpec())
  }

  private async registerOne(
    id: McpRegistrationTarget,
    spec: McpLaunchSpec
  ): Promise<McpRegistrationResult> {
    const configPath = configPathForTarget(id, this.getHome())
    try {
      const existing = await readTextIfExists(configPath)
      let next: string
      if (id === 'codex') {
        next = mergeCodexToml(existing, spec)
      } else if (id === 'opencode') {
        next = mergeOpenCodeJson(existing, spec)
      } else {
        next = mergeMcpServersJson(existing, spec)
      }
      await writeText(configPath, next)
      return { id, ok: true, message: `Registered in ${configPath}` }
    } catch (err) {
      return {
        id,
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }
}
