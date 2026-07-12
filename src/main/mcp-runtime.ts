import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { basename, dirname } from 'path'
import type { ConnectOptions, HostConfig } from '../shared/types'
import type { ConnectionStore } from './connection-store'
import type { CredentialStore } from './credential-store'
import type { KnownHosts } from './known-hosts'
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

const MAX_READ_BYTES = 512 * 1024
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

    const host = await this.hosts.getById(hostId)
    if (!host) throw { code: 'UNKNOWN', message: `Host not found: ${hostId}` }

    const saved = host.credentialsSaved ? await this.credentials.get(hostId) : undefined
    const client = new SshClient(this.knownHosts)
    const sessionId = randomUUID()

    try {
      await client.connect({
        host,
        password: options.password ?? saved?.password,
        privateKey: saved?.privateKey,
        acceptHostKey: options.acceptHostKey ?? true
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
      this.sessions.delete(sessionId)
      this.sftp.dispose(sessionId)
    })

    return { sessionId, title }
  }

  disconnectSession(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.sessions.delete(sessionId)
    this.sftp.dispose(sessionId)
    s.client.dispose()
  }

  async reapIdleSessions(now = Date.now()): Promise<string[]> {
    const { idleTimeoutMs } = await this.getPolicy()
    const closed: string[] = []
    for (const s of [...this.sessions.values()]) {
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

  async runCommand(sessionId: string, command: string, timeoutMs = 60000): Promise<string> {
    return this.getClient(sessionId).exec(command, timeoutMs)
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
    const client = this.getClient(sessionId)
    const raw = client.getRawClient()
    if (!raw) throw { code: 'SESSION_NOT_FOUND', message: 'SSH client missing' }

    const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => {
      raw.sftp((err, session) => {
        if (err || !session) reject({ code: 'UNKNOWN', message: err?.message ?? 'sftp failed' })
        else resolve(session)
      })
    })

    try {
      const buf = await new Promise<Buffer>((resolve, reject) => {
        sftp.readFile(remotePath, (err, data) => {
          if (err || !data) reject({ code: 'UNKNOWN', message: err?.message ?? 'read failed' })
          else resolve(data)
        })
      })
      if (buf.length > MAX_READ_BYTES) {
        throw {
          code: 'UNKNOWN',
          message: `File too large (${buf.length} bytes); max ${MAX_READ_BYTES}`
        }
      }
      return { path: remotePath, content: buf.toString('utf8') }
    } finally {
      sftp.end()
    }
  }

  async sftpWrite(sessionId: string, remotePath: string, content: string): Promise<void> {
    const client = this.getClient(sessionId)
    const raw = client.getRawClient()
    if (!raw) throw { code: 'SESSION_NOT_FOUND', message: 'SSH client missing' }

    const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => {
      raw.sftp((err, session) => {
        if (err || !session) reject({ code: 'UNKNOWN', message: err?.message ?? 'sftp failed' })
        else resolve(session)
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) => {
          if (err) reject({ code: 'UNKNOWN', message: err.message })
          else resolve()
        })
      })
    } finally {
      sftp.end()
    }
  }

  async sftpUpload(sessionId: string, localPath: string, remoteName?: string): Promise<void> {
    await this.sftp.upload(sessionId, localPath, remoteName ?? basename(localPath))
  }

  async sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    await mkdir(dirname(localPath), { recursive: true })
    await this.sftp.download(sessionId, remotePath, localPath)
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
}
