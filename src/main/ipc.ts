import { dialog, ipcMain, safeStorage } from 'electron'
import { readFile } from 'fs/promises'
import type { ConnectionStore } from './connection-store'
import type { CredentialStore } from './credential-store'
import type { SessionManager } from './session-manager'
import type { SettingsStore } from './settings-store'
import { IPC, type AppSettings, type ConnectOptions, type HostInput } from '../shared/types'

export function registerIpc(
  store: ConnectionStore,
  sessions: SessionManager,
  settings: SettingsStore,
  credentials: CredentialStore
): void {
  ipcMain.handle(IPC.hostsList, async () => store.list())
  ipcMain.handle(IPC.hostsCreate, async (_e, input: HostInput) => store.create(input))
  ipcMain.handle(IPC.hostsUpdate, async (_e, id: string, patch: Partial<HostInput>) =>
    store.update(id, patch)
  )
  ipcMain.handle(IPC.hostsRemove, async (_e, id: string) => {
    await store.remove(id)
    await credentials.clear(id)
  })

  ipcMain.handle(IPC.sessionsConnect, async (_e, hostId: string, options?: ConnectOptions) =>
    sessions.connect(hostId, options)
  )
  ipcMain.handle(IPC.sessionsWrite, async (_e, sessionId: string, data: string) => {
    sessions.write(sessionId, data)
  })
  ipcMain.handle(IPC.sessionsResize, async (_e, sessionId: string, cols: number, rows: number) => {
    sessions.resize(sessionId, cols, rows)
  })
  ipcMain.handle(IPC.sessionsDisconnect, async (_e, sessionId: string) => {
    sessions.disconnect(sessionId)
  })

  ipcMain.handle(IPC.settingsGet, async () => settings.get())
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<AppSettings>) => settings.set(patch))

  ipcMain.handle(IPC.credentialsIsAvailable, async () => credentials.isAvailable())
  ipcMain.handle(
    IPC.credentialsSave,
    async (
      _e,
      hostId: string,
      payload: { password?: string; privateKeyPath?: string }
    ) => {
      const secrets: { password?: string; privateKey?: string } = {}
      if (payload.password !== undefined) secrets.password = payload.password
      if (payload.privateKeyPath) {
        secrets.privateKey = await readFile(payload.privateKeyPath, 'utf8')
      }
      await credentials.save(hostId, secrets)
      await store.update(hostId, { credentialsPrompted: true, credentialsSaved: true })
    }
  )
  ipcMain.handle(IPC.credentialsClear, async (_e, hostId: string) => {
    await credentials.clear(hostId)
    await store.update(hostId, { credentialsSaved: false })
  })
  ipcMain.handle(
    IPC.credentialsMarkPrompted,
    async (_e, hostId: string, saved: boolean) => {
      await store.update(hostId, {
        credentialsPrompted: true,
        credentialsSaved: saved
      })
    }
  )

  ipcMain.handle(IPC.dialogOpenPrivateKey, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select private key',
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}

export function createCredentialSafeStorage(): {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
} {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted)
  }
}
