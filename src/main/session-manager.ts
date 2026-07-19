import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { ConnectOptions } from '../shared/types'
import { IPC } from '../shared/types'
import type { CredentialStore } from './credential-store'
import { ConnectionStore } from './connection-store'
import { KnownHosts } from './known-hosts'
import { SshClient } from './ssh-client'

interface Session {
  id: string
  hostId: string
  client: SshClient
}

/** Coalesce PTY output to cut IPC storms under high-volume terminal data. */
const DATA_FLUSH_MS = 12
const DATA_FLUSH_BYTES = 48 * 1024

interface PendingOutput {
  chunks: Buffer[]
  bytes: number
  timer: ReturnType<typeof setTimeout> | null
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private pendingOutput = new Map<string, PendingOutput>()
  /** In-flight connect client — cancelled via cancelConnect(). */
  private connectingClient: SshClient | null = null

  constructor(
    private readonly store: ConnectionStore,
    private readonly knownHosts: KnownHosts,
    private readonly credentials: CredentialStore,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onSessionDisposed?: (sessionId: string) => void
  ) {}

  /** Expose client for SFTP subsystem */
  getClient(sessionId: string): SshClient {
    return this.require(sessionId).client
  }

  async connect(hostId: string, options: ConnectOptions = {}): Promise<{ sessionId: string }> {
    // Load host + credentials in parallel (both usually cache hits after first connect).
    const [host, savedMaybe] = await Promise.all([
      this.store.getById(hostId),
      this.credentials.get(hostId)
    ])
    if (!host) {
      throw { code: 'UNKNOWN', message: `Host not found: ${hostId}` }
    }

    const saved = host.credentialsSaved ? savedMaybe : undefined
    const client = new SshClient(this.knownHosts)
    const sessionId = randomUUID()
    this.connectingClient = client

    try {
      await client.connect({
        host,
        password: options.password ?? saved?.password,
        privateKey: saved?.privateKey,
        acceptHostKey: options.acceptHostKey
      })
    } catch (err) {
      client.dispose()
      throw err
    } finally {
      if (this.connectingClient === client) {
        this.connectingClient = null
      }
    }

    const session: Session = { id: sessionId, hostId, client }
    this.sessions.set(sessionId, session)

    client.onData((buf) => {
      this.enqueueData(sessionId, buf)
    })
    client.onClose(() => {
      if (!this.sessions.has(sessionId)) return
      this.sessions.delete(sessionId)
      this.flushData(sessionId)
      this.onSessionDisposed?.(sessionId)
      client.dispose()
      this.send(IPC.sessionClosed, { sessionId })
    })

    return { sessionId }
  }

  /** Abort the in-flight TCP/SSH handshake (no-op if idle). */
  cancelConnect(): void {
    const client = this.connectingClient
    if (!client) return
    this.connectingClient = null
    client.cancel()
  }

  write(sessionId: string, data: string): void {
    this.require(sessionId).client.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.require(sessionId).client.resize(cols, rows)
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    this.flushData(sessionId)
    this.onSessionDisposed?.(sessionId)
    session.client.dispose()
    this.send(IPC.sessionClosed, { sessionId })
  }

  private enqueueData(sessionId: string, buf: Buffer): void {
    let pending = this.pendingOutput.get(sessionId)
    if (!pending) {
      pending = { chunks: [], bytes: 0, timer: null }
      this.pendingOutput.set(sessionId, pending)
    }
    pending.chunks.push(buf)
    pending.bytes += buf.length

    if (pending.bytes >= DATA_FLUSH_BYTES) {
      this.flushData(sessionId)
      return
    }
    if (pending.timer == null) {
      pending.timer = setTimeout(() => {
        this.flushData(sessionId)
      }, DATA_FLUSH_MS)
    }
  }

  private flushData(sessionId: string): void {
    const pending = this.pendingOutput.get(sessionId)
    if (!pending) return
    if (pending.timer != null) {
      clearTimeout(pending.timer)
      pending.timer = null
    }
    this.pendingOutput.delete(sessionId)
    if (pending.chunks.length === 0) return
    const data = Buffer.concat(pending.chunks).toString('utf8')
    this.send(IPC.sessionData, { sessionId, data })
  }

  private require(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw { code: 'SESSION_NOT_FOUND', message: `Session not found: ${sessionId}` }
    }
    return session
  }

  private send(channel: string, payload: unknown): void {
    const win = this.getWindow()
    win?.webContents.send(channel, payload)
  }
}
