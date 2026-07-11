import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { SettingsStore } from '../src/main/settings-store'

describe('SettingsStore', () => {
  let filePath: string
  let store: SettingsStore

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-settings-'))
    filePath = join(dir, 'settings.json')
    store = new SettingsStore(filePath)
  })

  it('returns zh default when file missing', async () => {
    await expect(store.get()).resolves.toEqual({ language: 'zh' })
  })

  it('persists language', async () => {
    await store.set({ language: 'en' })
    await expect(store.get()).resolves.toEqual({ language: 'en' })
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw.language).toBe('en')
  })

  it('falls back to zh for invalid language', async () => {
    writeFileSync(filePath, JSON.stringify({ language: 'fr' }), 'utf8')
    await expect(store.get()).resolves.toEqual({ language: 'zh' })
  })

  it('throws CONFIG_READ_FAILED on corrupt JSON without overwriting', async () => {
    writeFileSync(filePath, '{not-json', 'utf8')
    await expect(store.get()).rejects.toMatchObject({ code: 'CONFIG_READ_FAILED' })
    expect(readFileSync(filePath, 'utf8')).toBe('{not-json')
  })
})
