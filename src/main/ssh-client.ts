import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { mapSshError } from '../shared/map-ssh-error'
import type { AppError, HostConfig } from '../shared/types'
import type { KnownHosts } from './known-hosts'

/** Max bytes collected from a single remote exec (stdout). Prevents OOM on noisy commands. */
export const MAX_EXEC_BYTES = 2 * 1024 * 1024

/** ssh2 readyTimeout — fail faster on bad host/port so the UI does not feel frozen. */
export const SSH_READY_TIMEOUT_MS = 10_000
/** Application hard abort slightly above readyTimeout if ssh2 never settles. */
export const SSH_HARD_TIMEOUT_MS = 10_500

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
  private cancelled = false

  constructor(private readonly knownHosts: KnownHosts) {}

  /** Abort an in-flight connect (and tear down any partial session). */
  cancel(): void {
    this.cancelled = true
    this.dispose()
  }

  async connect(params: SshConnectParams): Promise<void> {
    const { host, password, privateKey, acceptHostKey = false, cols = 80, rows = 24 } = params
    this.cancelled = false

    let fingerprint = ''
    let hostKeyReject: AppError | null = null
    let hostKeyAccepted = false

    const config: ConnectConfig = {
      host: host.host,
      port: host.port,
      username: host.username,
      readyTimeout: SSH_READY_TIMEOUT_MS,
      // Skip zlib — saves CPU/memory and often shaves handshake + interactive latency.
      algorithms: {
        compress: ['none']
      },
      // Enforce known_hosts BEFORE authentication so credentials are never sent
      // to an unknown or changed host key unless the caller opted in.
      hostVerifier: (key) => {
        const buf = Buffer.isBuffer(key)
          ? key
          : Buffer.from((key as { getPublicSSH?: () => Buffer }).getPublicSSH?.() ?? [])
        fingerprint = createHash('sha256').update(buf).digest('base64')
        const check = this.knownHosts.checkSync(host.host, host.port, fingerprint)
        if (check.status === 'ok') {
          hostKeyAccepted = true
          return true
        }
        if (acceptHostKey) {
          hostKeyAccepted = true
          return true
        }
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
      await this.withHardTimeout(async () => {
        if (this.cancelled) {
          throw { code: 'CANCELLED', message: 'Connection cancelled' }
        }
        await new Promise<void>((resolve, reject) => {
          const client = new Client()
          this.client = client
          client
            .on('ready', () => {
              if (this.cancelled) {
                reject({ code: 'CANCELLED', message: 'Connection cancelled' })
                return
              }
              resolve()
            })
            .on('error', (err) => {
              if (this.cancelled) {
                reject({ code: 'CANCELLED', message: 'Connection cancelled' })
                return
              }
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
      })
    } catch (err) {
      this.dispose()
      if (this.cancelled) {
        throw { code: 'CANCELLED', message: 'Connection cancelled' }
      }
      if (hostKeyReject) throw hostKeyReject
      throw err
    }

    if (this.cancelled) {
      this.dispose()
      throw { code: 'CANCELLED', message: 'Connection cancelled' }
    }

    if (!hostKeyAccepted || !fingerprint) {
      this.dispose()
      throw {
        code: 'HOST_KEY_UNKNOWN' as const,
        message: 'Host key verification failed after connect'
      }
    }

    // Persist new/changed keys in parallel with shell open — don't block the PTY.
    const rememberPromise =
      acceptHostKey && fingerprint
        ? this.knownHosts.remember(host.host, host.port, fingerprint)
        : Promise.resolve()

    const shellPromise = new Promise<void>((resolve, reject) => {
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

    try {
      await Promise.all([shellPromise, rememberPromise])
    } catch (err) {
      this.dispose()
      throw err
    }
  }

  private async withHardTimeout<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            this.dispose()
            reject({ code: 'TIMEOUT', message: 'Connection timed out' })
          }, SSH_HARD_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timer != null) clearTimeout(timer)
    }
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.stream?.setWindow(rows, cols, 0, 0)
  }

  onData(cb: (data: Buffer) => void): void {
    this.stream?.on('data', (buf: Buffer) => cb(buf))
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
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        let stdoutBytes = 0
        let stderrBytes = 0
        let settled = false
        let oversized = false

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

        const append = (side: 'stdout' | 'stderr', buf: Buffer): void => {
          if (settled || oversized) return
          if (side === 'stdout') {
            stdoutBytes += buf.length
            if (stdoutBytes > MAX_EXEC_BYTES) {
              oversized = true
              finish(() =>
                reject({
                  code: 'UNKNOWN',
                  message: `Remote command output exceeded ${MAX_EXEC_BYTES} bytes`
                })
              )
              try {
                stream.close()
              } catch {
                /* ignore */
              }
              return
            }
            stdoutChunks.push(buf)
            return
          }
          stderrBytes += buf.length
          if (stderrBytes > MAX_EXEC_BYTES) {
            // Cap stderr growth but keep collecting until close for error messages.
            return
          }
          stderrChunks.push(buf)
        }

        stream.on('data', (buf: Buffer) => append('stdout', buf))
        stream.stderr.on('data', (buf: Buffer) => append('stderr', buf))
        stream.on('close', (code: number | null) => {
          finish(() => {
            if (oversized) return
            const stdout = Buffer.concat(stdoutChunks).toString('utf8')
            const stderr = Buffer.concat(stderrChunks).toString('utf8')
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
