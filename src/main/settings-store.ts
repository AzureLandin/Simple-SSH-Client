import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppError, AppSettings, LanguageCode } from '../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh',
  terminalFontFamily: 'Hack',
  terminalFontSize: 14
}

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24

function configError(code: AppError['code'], message: string): AppError {
  return { code, message }
}

function normalizeLanguage(value: unknown): LanguageCode {
  return value === 'en' || value === 'zh' ? value : 'zh'
}

export function normalizeTerminalFontFamily(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.terminalFontFamily
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.terminalFontFamily
}

export function normalizeTerminalFontSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.terminalFontSize
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)))
}

function normalizeSettings(data: Partial<AppSettings>): AppSettings {
  return {
    language: normalizeLanguage(data.language),
    terminalFontFamily: normalizeTerminalFontFamily(data.terminalFontFamily),
    terminalFontSize: normalizeTerminalFontSize(data.terminalFontSize)
  }
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<AppSettings> {
    return this.read()
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get()
    const next = normalizeSettings({
      language: patch.language !== undefined ? patch.language : current.language,
      terminalFontFamily:
        patch.terminalFontFamily !== undefined
          ? patch.terminalFontFamily
          : current.terminalFontFamily,
      terminalFontSize:
        patch.terminalFontSize !== undefined ? patch.terminalFontSize : current.terminalFontSize
    })
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
        return normalizeSettings(parsed)
      } catch {
        throw configError('CONFIG_READ_FAILED', 'Settings file is corrupt')
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'CONFIG_READ_FAILED') throw err
      if (code === 'ENOENT') return { ...DEFAULT_SETTINGS }
      throw configError(
        'CONFIG_READ_FAILED',
        err instanceof Error ? err.message : 'Failed to read settings file'
      )
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
