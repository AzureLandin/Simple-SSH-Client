import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { basename, dirname } from 'path'
import type { ConnectOptions, HostConfig } from '../shared/types'
import type { ConnectionStore } from './connection-store'
import type { CredentialStore } from './credential-store'
import type { KnownHosts } from './known-hosts'
import { assertLocalPathUnderHome } from './local-path-guard'
import { SftpService } from './sftp-service'
import { SshClient } from './ssh-client'

export interface McpSessionPolicy {
  idleTimeoutMs: number
  maxSessions: number
}

interface McpSession {
  id: string
  hostId: string
  title: string
  client: SshClient
  lastActiveAt: number
}

export const MAX_MCP_FILE_BYTES = 512 * 1024
const IDLE_CHECK_INTERVAL_MS = 15_000

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  if (err instanceof Error) return err.message
  return String(err)
}

export class McpRuntime {
  private sessions = new Map<string, McpSession>()
  private readonly sftp: SftpService
  private idleTimer: ReturnType<typeof setInterval> | null = null
  /** In-flight command counts — idle reap skips busy sessions. */
  private activeCommands = new Map<string, number>()

  constructor(
    private readonly hosts: ConnectionStore,
    private readonly credentials: CredentialStore,
    private readonly knownHosts: KnownHosts,
    private readonly getPolicy: () => Promise<McpSessionPolicy>
  ) {
    this.sftp = new SftpService((sessionId) => this.getClient(sessionId), () => null)
    this.idleTimer = setInterval(() => {
      void this.reapIdleSessions()
    }, IDLE_CHECK_INTERVAL_MS)
    // Allow process to exit even if the timer is still scheduled.
    if (typeof this.idleTimer === 'object' && this.idleTimer && 'unref' in this.idleTimer) {
      this.idleTimer.unref()
    }
  }

  listHosts(): Promise<HostConfig[]> {
    return this.hosts.list()
  }

  listSessions(): Array<{ sessionId: string; hostId: string; title: string }> {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.id,
      hostId: s.hostId,
      title: s.title
    }))
  }

  getClient(sessionId: string): SshClient {
    const s = this.sessions.get(sessionId)
    if (!s) throw { code: 'SESSION_NOT_FOUND', message: `Session not found: ${sessionId}` }
    s.lastActiveAt = Date.now()
    return s.client
  }

  async connectHost(
    hostId: string,
    options: ConnectOptions = {}
  ): Promise<{ sessionId: string; title: string }> {
    const { maxSessions } = await this.getPolicy()
    if (this.sessions.size >= maxSessions) {
      throw {
        code: 'MCP_SESSION_LIMIT',
        message: `Too many MCP sessions (max ${maxSessions}); disconnect one first`
      }
    }

    const [host, savedMaybe] = await Promise.all([
      this.hosts.getById(hostId),
      this.credentials.get(hostId)
    ])
    if (!host) throw { code: 'UNKNOWN', message: `Host not found: ${hostId}` }

    const saved = host.credentialsSaved ? savedMaybe : undefined
    const client = new SshClient(this.knownHosts)
    const sessionId = randomUUID()

    try {
      await client.connect({
        host,
        password: options.password ?? saved?.password,
        privateKey: saved?.privateKey,
        acceptHostKey: options.acceptHostKey ?? false
      })
    } catch (err) {
      client.dispose()
      throw err
    }

    const title = `${host.username}@${host.host}`
    this.sessions.set(sessionId, {
      id: sessionId,
      hostId,
      title,
      client,
      lastActiveAt: Date.now()
    })
    client.onClose(() => {
      if (!this.sessions.has(sessionId)) return
      this.sessions.delete(sessionId)
      this.activeCommands.delete(sessionId)
      this.sftp.dispose(sessionId)
      client.dispose()
    })

    return { sessionId, title }
  }

  disconnectSession(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.sessions.delete(sessionId)
    this.activeCommands.delete(sessionId)
    this.sftp.dispose(sessionId)
    s.client.dispose()
  }

  async reapIdleSessions(now = Date.now()): Promise<string[]> {
    const { idleTimeoutMs } = await this.getPolicy()
    const closed: string[] = []
    for (const s of [...this.sessions.values()]) {
      if ((this.activeCommands.get(s.id) ?? 0) > 0) continue
      if (now - s.lastActiveAt >= idleTimeoutMs) {
        closed.push(s.id)
        this.disconnectSession(s.id)
      }
    }
    return closed
  }

  /** Test helper: override last-active timestamp. */
  setLastActiveAtForTest(sessionId: string, lastActiveAt: number): void {
    const s = this.sessions.get(sessionId)
    if (s) s.lastActiveAt = lastActiveAt
  }

  /** Test helper: register a fake session without SSH. */
  addSessionForTest(session: Omit<McpSession, 'lastActiveAt'> & { lastActiveAt?: number }): void {
    this.sessions.set(session.id, {
      ...session,
      lastActiveAt: session.lastActiveAt ?? Date.now()
    })
  }

  /** Test helper: mark session as having in-flight commands (skip idle reap). */
  setActiveCommandCountForTest(sessionId: string, count: number): void {
    if (count <= 0) this.activeCommands.delete(sessionId)
    else this.activeCommands.set(sessionId, count)
  }

  async runCommand(sessionId: string, command: string, timeoutMs = 60000): Promise<string> {
    this.bumpActive(sessionId, 1)
    try {
      return await this.getClient(sessionId).exec(command, timeoutMs)
    } finally {
      this.bumpActive(sessionId, -1)
      const s = this.sessions.get(sessionId)
      if (s) s.lastActiveAt = Date.now()
    }
  }

  async sftpList(sessionId: string, remotePath?: string) {
    if (remotePath) {
      await this.sftp.chdir(sessionId, remotePath)
    }
    const cwd = await this.sftp.cwd(sessionId)
    const entries = await this.sftp.list(sessionId)
    return { cwd, entries }
  }

  async sftpRead(sessionId: string, remotePath: string): Promise<{ path: string; content: string }> {
    this.getClient(sessionId)
    return this.sftp.readText(sessionId, remotePath, MAX_MCP_FILE_BYTES)
  }

  async sftpWrite(sessionId: string, remotePath: string, content: string): Promise<void> {
    this.getClient(sessionId)
    await this.sftp.writeText(sessionId, remotePath, content, MAX_MCP_FILE_BYTES)
  }

  async sftpUpload(sessionId: string, localPath: string, remoteName?: string): Promise<void> {
    const safeLocal = await assertLocalPathUnderHome(localPath)
    await this.sftp.upload(sessionId, safeLocal, remoteName ?? basename(safeLocal))
  }

  async sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    const safeLocal = await assertLocalPathUnderHome(localPath)
    await mkdir(dirname(safeLocal), { recursive: true })
    await this.sftp.download(sessionId, remotePath, safeLocal)
  }

  disposeAll(): void {
    if (this.idleTimer != null) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    for (const id of [...this.sessions.keys()]) {
      this.disconnectSession(id)
    }
  }

  static formatError(err: unknown): string {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    const msg = errMessage(err)
    return code ? `${code}: ${msg}` : msg
  }

  private bumpActive(sessionId: string, delta: number): void {
    const next = (this.activeCommands.get(sessionId) ?? 0) + delta
    if (next <= 0) this.activeCommands.delete(sessionId)
    else this.activeCommands.set(sessionId, next)
  }
}
