import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { CredentialStore, type SafeStorageLike } from '../src/main/credential-store'

function mockSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('bad cipher')
      return s.slice(4)
    }
  }
}

describe('CredentialStore', () => {
  let store: CredentialStore

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-creds-'))
    store = new CredentialStore(join(dir, 'credentials.json'), mockSafeStorage())
  })

  it('returns undefined for missing host', async () => {
    await expect(store.get('x')).resolves.toBeUndefined()
  })

  it('round-trips password and private key', async () => {
    await store.save('h1', { password: 'secret', privateKey: 'KEYDATA' })
    await expect(store.get('h1')).resolves.toEqual({ password: 'secret', privateKey: 'KEYDATA' })
  })

  it('clears entry', async () => {
    await store.save('h1', { password: 'x' })
    await store.clear('h1')
    await expect(store.get('h1')).resolves.toBeUndefined()
  })

  it('throws when encryption unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-creds-'))
    const unavailable: SafeStorageLike = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ''
    }
    const s = new CredentialStore(join(dir, 'c.json'), unavailable)
    await expect(s.save('h', { password: 'x' })).rejects.toMatchObject({ code: 'UNKNOWN' })
  })
})
