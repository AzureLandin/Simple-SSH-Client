import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppError, AppSettings, LanguageCode } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = { language: 'zh' }

function configError(code: AppError['code'], message: string): AppError {
  return { code, message }
}

function normalizeLanguage(value: unknown): LanguageCode {
  return value === 'en' || value === 'zh' ? value : 'zh'
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<AppSettings> {
    const data = await this.read()
    return { language: normalizeLanguage(data.language) }
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get()
    const next: AppSettings = {
      language: patch.language !== undefined ? normalizeLanguage(patch.language) : current.language
    }
    await this.write(next)
    return next
  }

  private async read(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      try {
        const parsed = JSON.parse(raw) as Partial<AppSettings>
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('invalid shape')
        }
        return { language: normalizeLanguage(parsed.language) }
      } catch {
        throw configError('CONFIG_READ_FAILED', 'Settings file is corrupt')
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & AppError
      if (e.code === 'CONFIG_READ_FAILED') throw e
      if (e.code === 'ENOENT') return { ...DEFAULT_SETTINGS }
      throw configError('CONFIG_READ_FAILED', e.message ?? 'Failed to read settings file')
    }
  }

  private async write(data: AppSettings): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      const e = err as Error
      throw configError('CONFIG_WRITE_FAILED', e.message)
    }
  }
}
