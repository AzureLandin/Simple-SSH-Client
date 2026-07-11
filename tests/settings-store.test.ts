import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { SettingsStore } from '../src/main/settings-store'

const defaults = {
  language: 'zh',
  terminalFontFamily: 'Hack',
  terminalFontSize: 14
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

  it('persists language and terminal font settings', async () => {
    await store.set({ language: 'en', terminalFontFamily: 'Cascadia Code', terminalFontSize: 16 })
    await expect(store.get()).resolves.toEqual({
      language: 'en',
      terminalFontFamily: 'Cascadia Code',
      terminalFontSize: 16
    })
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw.language).toBe('en')
    expect(raw.terminalFontFamily).toBe('Cascadia Code')
    expect(raw.terminalFontSize).toBe(16)
  })

  it('falls back to zh for invalid language', async () => {
    writeFileSync(filePath, JSON.stringify({ language: 'fr' }), 'utf8')
    await expect(store.get()).resolves.toMatchObject({ language: 'zh' })
  })

  it('fills terminal defaults when older settings lack font fields', async () => {
    writeFileSync(filePath, JSON.stringify({ language: 'en' }), 'utf8')
    await expect(store.get()).resolves.toEqual({
      language: 'en',
      terminalFontFamily: 'Hack',
      terminalFontSize: 14
    })
  })

  it('clamps font size and empty family', async () => {
    writeFileSync(
      filePath,
      JSON.stringify({ language: 'zh', terminalFontFamily: '  ', terminalFontSize: 8 }),
      'utf8'
    )
    await expect(store.get()).resolves.toEqual({
      language: 'zh',
      terminalFontFamily: 'Hack',
      terminalFontSize: 10
    })

    await store.set({ terminalFontSize: 99 })
    await expect(store.get()).resolves.toMatchObject({ terminalFontSize: 24 })
  })

  it('throws CONFIG_READ_FAILED on corrupt JSON without overwriting', async () => {
    writeFileSync(filePath, '{not-json', 'utf8')
    await expect(store.get()).rejects.toMatchObject({ code: 'CONFIG_READ_FAILED' })
    expect(readFileSync(filePath, 'utf8')).toBe('{not-json')
  })
})
