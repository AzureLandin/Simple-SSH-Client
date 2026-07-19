import { readFile } from 'fs/promises'
import { writeJsonAtomic } from './atomic-write'

export type HostKeyCheck =
  | { status: 'ok' }
  | { status: 'unknown' }
  | { status: 'changed'; previous: string }

type StoreFile = Record<string, string>

export class KnownHosts {
  private cache: StoreFile | null = null

  constructor(private readonly filePath: string) {}

  private key(host: string, port: number): string {
    return `${host}:${port}`
  }

  /** Load known hosts into memory (call once at process start). */
  async load(): Promise<void> {
    this.cache = await this.readFromDisk()
  }

  private ensureCache(): StoreFile {
    if (!this.cache) {
      throw new Error('KnownHosts cache not loaded; call load() first')
    }
    return this.cache
  }

  /** Synchronous check for ssh2 hostVerifier (must not await). */
  checkSync(host: string, port: number, fingerprint: string): HostKeyCheck {
    const data = this.ensureCache()
    const previous = data[this.key(host, port)]
    if (!previous) return { status: 'unknown' }
    if (previous === fingerprint) return { status: 'ok' }
    return { status: 'changed', previous }
  }

  async check(host: string, port: number, fingerprint: string): Promise<HostKeyCheck> {
    if (!this.cache) await this.load()
    return this.checkSync(host, port, fingerprint)
  }

  async remember(host: string, port: number, fingerprint: string): Promise<void> {
    if (!this.cache) await this.load()
    const data = this.ensureCache()
    data[this.key(host, port)] = fingerprint
    await writeJsonAtomic(this.filePath, data)
  }

  private async readFromDisk(): Promise<StoreFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as StoreFile
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return {}
      throw err
    }
  }
}
