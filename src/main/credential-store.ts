import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppError } from '../shared/types'

export interface CredentialSecrets {
  password?: string
  privateKey?: string
}

interface VaultFile {
  version: 1
  entries: Record<string, { password?: string; privateKey?: string }>
}

export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

function configError(code: AppError['code'], message: string): AppError {
  return { code, message }
}

export class CredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike
  ) {}

  isAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable()
  }

  async get(hostId: string): Promise<CredentialSecrets | undefined> {
    const vault = await this.read()
    const entry = vault.entries[hostId]
    if (!entry) return undefined
    const result: CredentialSecrets = {}
    if (entry.password) {
      result.password = this.safeStorage.decryptString(Buffer.from(entry.password, 'base64'))
    }
    if (entry.privateKey) {
      result.privateKey = this.safeStorage.decryptString(Buffer.from(entry.privateKey, 'base64'))
    }
    return result
  }

  async save(hostId: string, secrets: CredentialSecrets): Promise<void> {
    if (!this.isAvailable()) {
      throw configError('UNKNOWN', 'Secure credential storage is unavailable')
    }
    const vault = await this.read()
    const entry: { password?: string; privateKey?: string } = { ...vault.entries[hostId] }
    if (secrets.password !== undefined) {
      entry.password = this.safeStorage.encryptString(secrets.password).toString('base64')
    }
    if (secrets.privateKey !== undefined) {
      entry.privateKey = this.safeStorage.encryptString(secrets.privateKey).toString('base64')
    }
    vault.entries[hostId] = entry
    await this.write(vault)
  }

  async clear(hostId: string): Promise<void> {
    const vault = await this.read()
    if (!(hostId in vault.entries)) return
    delete vault.entries[hostId]
    await this.write(vault)
  }

  private async read(): Promise<VaultFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as VaultFile
      if (!parsed || parsed.version !== 1 || typeof parsed.entries !== 'object') {
        throw configError('CONFIG_READ_FAILED', 'Credentials file is corrupt')
      }
      return parsed
    } catch (err) {
      const e = err as NodeJS.ErrnoException & AppError
      if (e.code === 'CONFIG_READ_FAILED') throw e
      if (e.code === 'ENOENT') return { version: 1, entries: {} }
      throw configError('CONFIG_READ_FAILED', e.message ?? 'Failed to read credentials')
    }
  }

  private async write(data: VaultFile): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      const e = err as Error
      throw configError('CONFIG_WRITE_FAILED', e.message)
    }
  }
}
