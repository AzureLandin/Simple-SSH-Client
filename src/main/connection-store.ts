import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import type { AppError, HostConfig, HostInput } from '../shared/types'
import { writeJsonAtomic } from './atomic-write'

interface HostsFile {
  hosts: HostConfig[]
}

function configError(code: AppError['code'], message: string): AppError {
  return { code, message }
}

export class ConnectionStore {
  /** In-memory hosts list — avoids disk read + JSON.parse on every connect. */
  private cache: HostsFile | null = null

  constructor(private readonly filePath: string) {}

  async list(): Promise<HostConfig[]> {
    const data = await this.read()
    return data.hosts
  }

  async getById(id: string): Promise<HostConfig | undefined> {
    const data = await this.read()
    return data.hosts.find((h) => h.id === id)
  }

  async create(input: HostInput): Promise<HostConfig> {
    const data = await this.read()
    const host: HostConfig = { ...input, id: randomUUID() }
    data.hosts.push(host)
    await this.write(data)
    return host
  }

  async update(id: string, patch: Partial<HostInput>): Promise<HostConfig> {
    const data = await this.read()
    const index = data.hosts.findIndex((h) => h.id === id)
    if (index < 0) {
      throw configError('UNKNOWN', `Host not found: ${id}`)
    }
    const updated: HostConfig = { ...data.hosts[index], ...patch, id }
    data.hosts[index] = updated
    await this.write(data)
    return updated
  }

  async remove(id: string): Promise<void> {
    const data = await this.read()
    data.hosts = data.hosts.filter((h) => h.id !== id)
    await this.write(data)
  }

  private async read(): Promise<HostsFile> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.filePath, 'utf8')
      try {
        const parsed = JSON.parse(raw) as HostsFile
        if (!parsed || !Array.isArray(parsed.hosts)) {
          throw new Error('invalid shape')
        }
        this.cache = parsed
        return this.cache
      } catch {
        throw configError('CONFIG_READ_FAILED', 'Hosts file is corrupt')
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'CONFIG_READ_FAILED') throw err
      if (code === 'ENOENT') {
        this.cache = { hosts: [] }
        return this.cache
      }
      throw configError(
        'CONFIG_READ_FAILED',
        err instanceof Error ? err.message : 'Failed to read hosts file'
      )
    }
  }

  private async write(data: HostsFile): Promise<void> {
    this.cache = data
    try {
      await writeJsonAtomic(this.filePath, data)
    } catch (err) {
      const e = err as Error
      throw configError('CONFIG_WRITE_FAILED', e.message)
    }
  }
}
