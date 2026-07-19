import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  buildLaunchSpec,
  isRegisteredInCodexToml,
  isRegisteredInMcpServersJson,
  isRegisteredInOpenCodeJson,
  mergeCodexToml,
  mergeMcpServersJson,
  mergeOpenCodeJson,
  McpRegistrationService,
  pathsEqual,
  resolveMcpLauncherScript
} from '../src/main/mcp-registration'

describe('mcp-registration merges', () => {
  const spec = buildLaunchSpec('E:/Projects/SSH-Client/.worktrees/mcp-ssh-server/scripts/nodeshell-mcp.mjs')

  it('merges Cursor/Claude mcpServers without dropping others', () => {
    const next = mergeMcpServersJson(
      JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }),
      spec
    )
    const parsed = JSON.parse(next)
    expect(parsed.mcpServers.other.command).toBe('x')
    expect(parsed.mcpServers.nodeshell.command).toBe('node')
    expect(parsed.mcpServers.nodeshell.args[0]).toContain('nodeshell-mcp.mjs')
  })

  it('merges OpenCode mcp block', () => {
    const next = mergeOpenCodeJson('{"model":"x"}', spec)
    const parsed = JSON.parse(next)
    expect(parsed.model).toBe('x')
    expect(parsed.mcp.nodeshell.type).toBe('local')
    expect(parsed.mcp.nodeshell.command[0]).toBe('node')
  })

  it('upserts Codex TOML section', () => {
    const first = mergeCodexToml('model = "gpt"\n', spec)
    expect(first).toContain('model = "gpt"')
    expect(first).toContain('[mcp_servers.nodeshell]')
    const second = mergeCodexToml(first, buildLaunchSpec('D:/other/nodeshell-mcp.mjs'))
    expect(second.match(/\[mcp_servers\.nodeshell\]/g)?.length).toBe(1)
    expect(second).toContain('nodeshell-mcp.mjs')
    expect(second).toContain('D:')
  })

  it('detects registered vs stale paths', () => {
    const script = spec.scriptPath
    expect(
      isRegisteredInMcpServersJson(
        { mcpServers: { nodeshell: { command: 'node', args: [script] } } },
        script
      )
    ).toEqual({ registered: true, stale: false })
    expect(
      isRegisteredInMcpServersJson(
        { mcpServers: { nodeshell: { command: 'node', args: ['C:/old/nodeshell-mcp.mjs'] } } },
        script
      )
    ).toEqual({ registered: false, stale: true })
    expect(
      isRegisteredInOpenCodeJson(
        { mcp: { nodeshell: { type: 'local', command: ['node', script] } } },
        script
      )
    ).toEqual({ registered: true, stale: false })
    expect(
      isRegisteredInCodexToml(
        `[mcp_servers.nodeshell]\ncommand = "node"\nargs = [${JSON.stringify(script)}]\n`,
        script
      )
    ).toEqual({ registered: true, stale: false })
  })

  it('pathsEqual normalizes separators and case', () => {
    expect(pathsEqual('C:\\A\\b.mjs', 'c:/a/b.mjs')).toBe(true)
  })
})

describe('resolveMcpLauncherScript', () => {
  it('resolves packaged resources/mcp launcher before scripts/', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ns-mcp-pack-'))
    const resources = join(root, 'resources')
    const mcpDir = join(resources, 'mcp')
    const scripts = join(root, 'scripts')
    mkdirSync(mcpDir, { recursive: true })
    mkdirSync(scripts, { recursive: true })
    const packaged = join(mcpDir, 'nodeshell-mcp.mjs')
    const dev = join(scripts, 'nodeshell-mcp.mjs')
    writeFileSync(packaged, '// packaged\n', 'utf8')
    writeFileSync(dev, '// dev\n', 'utf8')

    const found = await resolveMcpLauncherScript({
      appRoot: root,
      isPackaged: true,
      resourcesPath: resources
    })
    expect(pathsEqual(found!, packaged)).toBe(true)
  })
})

describe('McpRegistrationService', () => {
  it('registers into temp home configs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ns-mcp-reg-'))
    const appRoot = mkdtempSync(join(tmpdir(), 'ns-mcp-app-'))
    const scripts = join(appRoot, 'scripts')
    mkdirSync(scripts)
    const launcher = join(scripts, 'nodeshell-mcp.mjs')
    writeFileSync(launcher, '// stub\n', 'utf8')

    const svc = new McpRegistrationService(() => appRoot, () => home)
    const results = await svc.register('all')
    expect(results.every((r) => r.ok)).toBe(true)

    const status = await svc.status()
    const bad = status.filter((s) => !s.registered || s.stale)
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([])

    const cursor = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'))
    expect(pathsEqual(cursor.mcpServers.nodeshell.args[0], launcher)).toBe(true)

    const opencode = JSON.parse(
      readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8')
    )
    expect(pathsEqual(opencode.mcp.nodeshell.command[1], launcher)).toBe(true)

    const codex = readFileSync(join(home, '.codex', 'config.toml'), 'utf8')
    expect(codex).toContain('mcp_servers.nodeshell')
  })
})
