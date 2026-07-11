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

export class SessionManager {
  private sessions = new Map<string, Session>()

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
    const host = await this.store.getById(hostId)
    if (!host) {
      throw { code: 'UNKNOWN', message: `Host not found: ${hostId}` }
    }

    const saved = host.credentialsSaved ? await this.credentials.get(hostId) : undefined
    const client = new SshClient(this.knownHosts)
    const sessionId = randomUUID()

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
    }

    const session: Session = { id: sessionId, hostId, client }
    this.sessions.set(sessionId, session)

    client.onData((data) => {
      this.send(IPC.sessionData, { sessionId, data })
    })
    client.onClose(() => {
      if (!this.sessions.has(sessionId)) return
      this.sessions.delete(sessionId)
      this.onSessionDisposed?.(sessionId)
      this.send(IPC.sessionClosed, { sessionId })
    })

    return { sessionId }
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
    this.onSessionDisposed?.(sessionId)
    session.client.dispose()
    this.send(IPC.sessionClosed, { sessionId })
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
