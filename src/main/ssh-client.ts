import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { mapSshError } from '../shared/map-ssh-error'
import type { HostConfig } from '../shared/types'
import type { KnownHosts } from './known-hosts'

export interface SshConnectParams {
  host: HostConfig
  password?: string
  /** In-memory private key PEM/contents; preferred over host.privateKeyPath when set */
  privateKey?: string
  acceptHostKey?: boolean
  cols?: number
  rows?: number
}

export class SshClient {
  private client: Client | null = null
  private stream: ClientChannel | null = null

  constructor(private readonly knownHosts: KnownHosts) {}

  async connect(params: SshConnectParams): Promise<void> {
    const { host, password, privateKey, acceptHostKey, cols = 80, rows = 24 } = params

    let fingerprint = ''
    const config: ConnectConfig = {
      host: host.host,
      port: host.port,
      username: host.username,
      readyTimeout: 20000,
      hostVerifier: (key) => {
        const buf = Buffer.isBuffer(key) ? key : Buffer.from((key as { getPublicSSH?: () => Buffer }).getPublicSSH?.() ?? [])
        fingerprint = createHash('sha256').update(buf).digest('base64')
        return true
      }
    }

    if (host.authMethod === 'privateKey') {
      if (privateKey) {
        config.privateKey = Buffer.from(privateKey, 'utf8')
      } else if (host.privateKeyPath) {
        config.privateKey = await readFile(host.privateKeyPath)
      } else {
        throw { code: 'AUTH_FAILED', message: 'Private key path missing' }
      }
    } else {
      config.password = password
    }

    await new Promise<void>((resolve, reject) => {
      const client = new Client()
      this.client = client
      client
        .on('ready', () => resolve())
        .on('error', (err) => reject(mapSshError(err)))
        .connect(config)
    })

    const check = await this.knownHosts.check(host.host, host.port, fingerprint)
    if (check.status === 'changed' && !acceptHostKey) {
      this.dispose()
      throw { code: 'HOST_KEY_CHANGED', message: 'Host key has changed' }
    }
    if (check.status === 'unknown' || (check.status === 'changed' && acceptHostKey)) {
      await this.knownHosts.remember(host.host, host.port, fingerprint)
    }

    await new Promise<void>((resolve, reject) => {
      if (!this.client) {
        reject({ code: 'UNKNOWN', message: 'Client missing' })
        return
      }
      this.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          reject(mapSshError(err))
          return
        }
        this.stream = stream
        resolve()
      })
    })
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.stream?.setWindow(rows, cols, 0, 0)
  }

  onData(cb: (data: string) => void): void {
    this.stream?.on('data', (buf: Buffer) => cb(buf.toString('utf8')))
  }

  onClose(cb: () => void): void {
    let closed = false
    const once = (): void => {
      if (closed) return
      closed = true
      cb()
    }
    this.stream?.on('close', once)
    this.client?.on('close', once)
  }

  /** Underlying ssh2 client for SFTP / exec */
  getRawClient(): Client | null {
    return this.client
  }

  /** Run a non-interactive remote command; does not use the shell PTY. */
  async exec(command: string, timeoutMs = 8000): Promise<string> {
    const raw = this.client
    if (!raw) throw { code: 'SESSION_NOT_FOUND', message: 'SSH client missing' }

    return new Promise((resolve, reject) => {
      raw.exec(command, (err, stream) => {
        if (err || !stream) {
          reject({ code: 'UNKNOWN', message: err?.message ?? 'exec failed' })
          return
        }
        let stdout = ''
        let stderr = ''
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          try {
            stream.close()
          } catch {
            /* ignore */
          }
          reject({ code: 'TIMEOUT', message: 'Remote command timed out' })
        }, timeoutMs)

        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          fn()
        }

        stream.on('data', (buf: Buffer) => {
          stdout += buf.toString('utf8')
        })
        stream.stderr.on('data', (buf: Buffer) => {
          stderr += buf.toString('utf8')
        })
        stream.on('close', (code: number | null) => {
          finish(() => {
            if (code && code !== 0 && !stdout) {
              reject({
                code: 'UNKNOWN',
                message: stderr.trim() || `Remote command exited with ${code}`
              })
              return
            }
            resolve(stdout)
          })
        })
        stream.on('error', (e: Error) => {
          finish(() => reject({ code: 'UNKNOWN', message: e.message }))
        })
      })
    })
  }

  dispose(): void {
    try {
      this.stream?.close()
    } catch {
      /* ignore */
    }
    try {
      this.client?.end()
    } catch {
      /* ignore */
    }
    this.stream = null
    this.client = null
  }
}
