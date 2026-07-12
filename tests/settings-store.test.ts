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
  mcpMaxSessions: 8
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

  it('persists language, terminal, and MCP settings', async () => {
    await store.set({
      language: 'en',
      terminalFontFamily: 'Cascadia Code',
      terminalFontSize: 16,
      mcpIdleTimeoutMinutes: 30,
      mcpMaxSessions: 4
    })
    await expect(store.get()).resolves.toEqual({
      language: 'en',
      terminalFontFamily: 'Cascadia Code',
      terminalFontSize: 16,
      mcpIdleTimeoutMinutes: 30,
      mcpMaxSessions: 4
    })
  })

  it('fills defaults when older settings lack newer fields', async () => {
    writeFileSync(filePath, JSON.stringify({ language: 'en' }), 'utf8')
    await expect(store.get()).resolves.toEqual({
      language: 'en',
      terminalFontFamily: 'Hack',
      terminalFontSize: 14,
      mcpIdleTimeoutMinutes: 10,
      mcpMaxSessions: 8
    })
  })

  it('throws CONFIG_READ_FAILED on corrupt JSON without overwriting', async () => {
    writeFileSync(filePath, '{not-json', 'utf8')
    await expect(store.get()).rejects.toMatchObject({ code: 'CONFIG_READ_FAILED' })
    expect(readFileSync(filePath, 'utf8')).toBe('{not-json')
  })
})
