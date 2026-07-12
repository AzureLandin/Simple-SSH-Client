import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { SettingsStore } from '../src/main/settings-store'

const defaults = {
  language: 'zh',
  terminalFontFamily: 'Hack',
  terminalFontSize: 14,
  mcpIdleTimeoutMinutes: 10,
  mcpMaxSessions: 8,
  themePreference: 'system'
} as const

describe('SettingsStore', () => {
  let filePath: string
  let store: SettingsStore

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-settings-'))
    filePath = join(dir, 'settings.json')
    store = new SettingsStore(filePath)
  })

  it('returns defaults when file missing', async () => {
    await expect(store.get()).resolves.toEqual(defaults)
  })

  it('persists language, terminal, MCP, and theme settings', async () => {
    await store.set({
      language: 'en',
      terminalFontFamily: 'Cascadia Code',
      terminalFontSize: 16,
      mcpIdleTimeoutMinutes: 30,
      mcpMaxSessions: 4,
      themePreference: 'light'
    })
    await expect(store.get()).resolves.toEqual({
      language: 'en',
      terminalFontFamily: 'Cascadia Code',
      terminalFontSize: 16,
      mcpIdleTimeoutMinutes: 30,
      mcpMaxSessions: 4,
      themePreference: 'light'
    })
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw.mcpIdleTimeoutMinutes).toBe(30)
    expect(raw.mcpMaxSessions).toBe(4)
    expect(raw.themePreference).toBe('light')
  })

  it('falls back to zh for invalid language', async () => {
    writeFileSync(filePath, JSON.stringify({ language: 'fr' }), 'utf8')
    await expect(store.get()).resolves.toMatchObject({ language: 'zh' })
  })

  it('falls back to system for invalid theme preference', async () => {
    writeFileSync(filePath, JSON.stringify({ themePreference: 'neon' }), 'utf8')
    await expect(store.get()).resolves.toMatchObject({ themePreference: 'system' })
  })

  it('fills defaults when older settings lack newer fields', async () => {
    writeFileSync(filePath, JSON.stringify({ language: 'en' }), 'utf8')
    await expect(store.get()).resolves.toEqual({
      language: 'en',
      terminalFontFamily: 'Hack',
      terminalFontSize: 14,
      mcpIdleTimeoutMinutes: 10,
      mcpMaxSessions: 8,
      themePreference: 'system'
    })
  })

  it('clamps font size, MCP idle timeout, and max sessions', async () => {
    writeFileSync(
      filePath,
      JSON.stringify({
        language: 'zh',
        terminalFontFamily: '  ',
        terminalFontSize: 8,
        mcpIdleTimeoutMinutes: 0,
        mcpMaxSessions: 99
      }),
      'utf8'
    )
    await expect(store.get()).resolves.toEqual({
      language: 'zh',
      terminalFontFamily: 'Hack',
      terminalFontSize: 10,
      mcpIdleTimeoutMinutes: 1,
      mcpMaxSessions: 32,
      themePreference: 'system'
    })

    await store.set({ terminalFontSize: 99, mcpIdleTimeoutMinutes: 200 })
    await expect(store.get()).resolves.toMatchObject({
      terminalFontSize: 24,
      mcpIdleTimeoutMinutes: 120
    })
  })

  it('throws CONFIG_READ_FAILED on corrupt JSON without overwriting', async () => {
    writeFileSync(filePath, '{not-json', 'utf8')
    await expect(store.get()).rejects.toMatchObject({ code: 'CONFIG_READ_FAILED' })
    expect(readFileSync(filePath, 'utf8')).toBe('{not-json')
  })
})
