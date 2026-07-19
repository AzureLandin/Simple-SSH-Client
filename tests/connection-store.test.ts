import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { ConnectionStore } from '../src/main/connection-store'
import type { HostInput } from '../src/shared/types'

const sample: HostInput = {
  name: 'lab',
  host: '192.168.1.10',
  port: 22,
  username: 'root',
  authMethod: 'password'
}

describe('ConnectionStore', () => {
  let filePath: string
  let store: ConnectionStore

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-client-'))
    filePath = join(dir, 'hosts.json')
    store = new ConnectionStore(filePath)
  })

  it('lists empty when file missing', async () => {
    await expect(store.list()).resolves.toEqual([])
  })

  it('creates a host with generated id and persists', async () => {
    const host = await store.create(sample)
    expect(host.id).toBeTruthy()
    expect(host.name).toBe('lab')
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw.hosts).toHaveLength(1)
    expect(raw.hosts[0].id).toBe(host.id)
  })

  it('updates and removes hosts', async () => {
    const host = await store.create(sample)
    const updated = await store.update(host.id, { name: 'prod' })
    expect(updated.name).toBe('prod')
    await store.remove(host.id)
    await expect(store.list()).resolves.toEqual([])
  })

  it('serves subsequent reads from memory cache', async () => {
    const host = await store.create(sample)
    const a = await store.getById(host.id)
    const b = await store.getById(host.id)
    expect(a).toEqual(b)
    expect(a?.name).toBe('lab')
  })

  it('does not write password fields (hosts have no password key)', async () => {
    const host = await store.create(sample)
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw.hosts[0]).not.toHaveProperty('password')
    expect(host).not.toHaveProperty('password')
  })

  it('throws CONFIG_READ_FAILED on corrupt JSON without overwriting', async () => {
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, '{not-json', 'utf8')
    await expect(store.list()).rejects.toMatchObject({ code: 'CONFIG_READ_FAILED' })
    expect(readFileSync(filePath, 'utf8')).toBe('{not-json')
  })

  it('getById returns undefined when missing', async () => {
    await expect(store.getById('nope')).resolves.toBeUndefined()
  })
})
