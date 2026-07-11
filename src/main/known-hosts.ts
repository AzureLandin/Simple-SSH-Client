import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'

export type HostKeyCheck =
  | { status: 'ok' }
  | { status: 'unknown' }
  | { status: 'changed'; previous: string }

type StoreFile = Record<string, string>

export class KnownHosts {
  constructor(private readonly filePath: string) {}

  private key(host: string, port: number): string {
    return `${host}:${port}`
  }

  async check(host: string, port: number, fingerprint: string): Promise<HostKeyCheck> {
    const data = await this.read()
    const previous = data[this.key(host, port)]
    if (!previous) return { status: 'unknown' }
    if (previous === fingerprint) return { status: 'ok' }
    return { status: 'changed', previous }
  }

  async remember(host: string, port: number, fingerprint: string): Promise<void> {
    const data = await this.read()
    data[this.key(host, port)] = fingerprint
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  private async read(): Promise<StoreFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as StoreFile
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return {}
      throw err
    }
  }
}
