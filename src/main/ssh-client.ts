import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { mapSshError } from '../shared/map-ssh-error'
import type { AppError, HostConfig } from '../shared/types'
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
    const { host, password, privateKey, acceptHostKey = false, cols = 80, rows = 24 } = params

    let fingerprint = ''
    let hostKeyReject: AppError | null = null

    const config: ConnectConfig = {
      host: host.host,
      port: host.port,
      username: host.username,
      readyTimeout: 20000,
      // Enforce known_hosts BEFORE authentication so credentials are never sent
      // to an unknown or changed host key unless the caller opted in.
      hostVerifier: (key) => {
        const buf = Buffer.isBuffer(key)
          ? key
          : Buffer.from((key as { getPublicSSH?: () => Buffer }).getPublicSSH?.() ?? [])
        fingerprint = createHash('sha256').update(buf).digest('base64')
        const check = this.knownHosts.checkSync(host.host, host.port, fingerprint)
        if (check.status === 'ok') return true
        if (acceptHostKey) return true
        if (check.status === 'unknown') {
          hostKeyReject = {
            code: 'HOST_KEY_UNKNOWN',
            message: `Unknown host key (SHA256:${fingerprint})`
          }
          return false
        }
        hostKeyReject = {
          code: 'HOST_KEY_CHANGED',
          message: `Host key has changed (was SHA256:${check.previous}, now SHA256:${fingerprint})`
        }
        return false
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
      // Some servers advertise keyboard-interactive instead of (or in addition
      // to) password. Enable both and answer interactive prompts with the password.
      config.password = password
      config.tryKeyboard = true
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const client = new Client()
        this.client = client
        client
          .on('ready', () => resolve())
          .on('error', (err) => {
            if (hostKeyReject) {
              reject(hostKeyReject)
              return
            }
            reject(mapSshError(err))
          })
          .on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
            const answers = prompts.map((p) => {
              const prompt = String(p.prompt ?? '')
              if (/password/i.test(prompt) || p.echo === false) return password ?? ''
              return ''
            })
            finish(answers)
          })
          .connect(config)
      })
    } catch (err) {
      this.dispose()
      if (hostKeyReject) throw hostKeyReject
      throw err
    }

    if (acceptHostKey && fingerprint) {
      await this.knownHosts.remember(host.host, host.port, fingerprint)
    } else {
      // Defensive: ensure cache agrees after connect (ok path).
      const check = this.knownHosts.checkSync(host.host, host.port, fingerprint)
      if (check.status !== 'ok') {
        this.dispose()
        throw {
          code: check.status === 'changed' ? 'HOST_KEY_CHANGED' : 'HOST_KEY_UNKNOWN',
          message: 'Host key verification failed after connect'
        }
      }
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
