import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { KnownHosts } from '../src/main/known-hosts'

describe('KnownHosts', () => {
  let filePath: string
  let store: KnownHosts

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-kh-'))
    filePath = join(dir, 'known_hosts.json')
    store = new KnownHosts(filePath)
    await store.load()
  })

  it('returns unknown for new host', async () => {
    await expect(store.check('h', 22, 'fp1')).resolves.toEqual({ status: 'unknown' })
  })

  it('checkSync matches async check after load', async () => {
    expect(store.checkSync('h', 22, 'fp1')).toEqual({ status: 'unknown' })
    await store.remember('h', 22, 'fp1')
    expect(store.checkSync('h', 22, 'fp1')).toEqual({ status: 'ok' })
    expect(store.checkSync('h', 22, 'fp2')).toEqual({ status: 'changed', previous: 'fp1' })
  })

  it('returns ok when fingerprint matches', async () => {
    await store.remember('h', 22, 'fp1')
    await expect(store.check('h', 22, 'fp1')).resolves.toEqual({ status: 'ok' })
  })

  it('returns changed when fingerprint differs', async () => {
    await store.remember('h', 22, 'fp1')
    await expect(store.check('h', 22, 'fp2')).resolves.toEqual({
      status: 'changed',
      previous: 'fp1'
    })
  })

  it('persists to disk', async () => {
    await store.remember('h', 22, 'fp1')
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw['h:22']).toBe('fp1')
  })
})
