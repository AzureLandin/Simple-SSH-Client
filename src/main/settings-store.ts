import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppError, AppSettings, LanguageCode, ThemePreference } from '../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh',
  terminalFontFamily: 'Hack',
  terminalFontSize: 14,
  mcpIdleTimeoutMinutes: 10,
  mcpMaxSessions: 8,
  themePreference: 'system'
}

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24
export const MCP_IDLE_TIMEOUT_MIN = 1
export const MCP_IDLE_TIMEOUT_MAX = 120
export const MCP_MAX_SESSIONS_MIN = 1
export const MCP_MAX_SESSIONS_MAX = 32

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

export function normalizeMcpIdleTimeoutMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.mcpIdleTimeoutMinutes
  return Math.min(MCP_IDLE_TIMEOUT_MAX, Math.max(MCP_IDLE_TIMEOUT_MIN, Math.round(n)))
}

export function normalizeMcpMaxSessions(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.mcpMaxSessions
  return Math.min(MCP_MAX_SESSIONS_MAX, Math.max(MCP_MAX_SESSIONS_MIN, Math.round(n)))
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
    ? value
    : DEFAULT_SETTINGS.themePreference
}

function normalizeSettings(data: Partial<AppSettings>): AppSettings {
  return {
    language: normalizeLanguage(data.language),
    terminalFontFamily: normalizeTerminalFontFamily(data.terminalFontFamily),
    terminalFontSize: normalizeTerminalFontSize(data.terminalFontSize),
    mcpIdleTimeoutMinutes: normalizeMcpIdleTimeoutMinutes(data.mcpIdleTimeoutMinutes),
    mcpMaxSessions: normalizeMcpMaxSessions(data.mcpMaxSessions),
    themePreference: normalizeThemePreference(data.themePreference)
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
        patch.terminalFontSize !== undefined ? patch.terminalFontSize : current.terminalFontSize,
      mcpIdleTimeoutMinutes:
        patch.mcpIdleTimeoutMinutes !== undefined
          ? patch.mcpIdleTimeoutMinutes
          : current.mcpIdleTimeoutMinutes,
      mcpMaxSessions:
        patch.mcpMaxSessions !== undefined ? patch.mcpMaxSessions : current.mcpMaxSessions,
      themePreference:
        patch.themePreference !== undefined ? patch.themePreference : current.themePreference
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
    } catch {
      /* ignore */
    }
    try {
      await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      const e = err as Error
      throw configError('CONFIG_WRITE_FAILED', e.message)
    }
  }
}
