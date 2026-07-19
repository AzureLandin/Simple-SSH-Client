import { dialog, ipcMain, safeStorage, app } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename, dirname } from 'path'
import type { ConnectionStore } from './connection-store'
import type { CredentialStore } from './credential-store'
import { assertLocalPathUnderHome } from './local-path-guard'
import { McpRegistrationService } from './mcp-registration'
import type { MonitorService } from './monitor-service'
import type { SessionManager } from './session-manager'
import type { SettingsStore } from './settings-store'
import type { SftpService } from './sftp-service'
import {
  IPC,
  type AppSettings,
  type ConnectOptions,
  type HostInput,
  type McpRegistrationTarget
} from '../shared/types'
import { withIpcErrors } from '../shared/ipc-error'

export function registerIpc(
  store: ConnectionStore,
  sessions: SessionManager,
  settings: SettingsStore,
  credentials: CredentialStore,
  sftp: SftpService,
  monitor: MonitorService
): void {
  const mcpRegistration = new McpRegistrationService(() => ({
    appRoot: app.isPackaged ? dirname(app.getPath('exe')) : process.cwd() || app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  }))

  ipcMain.handle(IPC.hostsList, async () => withIpcErrors(() => store.list()))
  ipcMain.handle(IPC.hostsCreate, async (_e, input: HostInput) =>
    withIpcErrors(() => store.create(input))
  )
  ipcMain.handle(IPC.hostsUpdate, async (_e, id: string, patch: Partial<HostInput>) =>
    withIpcErrors(() => store.update(id, patch))
  )
  ipcMain.handle(IPC.hostsRemove, async (_e, id: string) =>
    withIpcErrors(async () => {
      await store.remove(id)
      await credentials.clear(id)
    })
  )

  ipcMain.handle(IPC.sessionsConnect, async (_e, hostId: string, options?: ConnectOptions) =>
    withIpcErrors(async () => {
      const result = await sessions.connect(hostId, options)
      void sftp.ensure(result.sessionId).catch(() => {})
      return result
    })
  )
  ipcMain.handle(IPC.sessionsWrite, async (_e, sessionId: string, data: string) =>
    withIpcErrors(async () => {
      sessions.write(sessionId, data)
    })
  )
  ipcMain.handle(IPC.sessionsResize, async (_e, sessionId: string, cols: number, rows: number) =>
    withIpcErrors(async () => {
      const c = Math.min(500, Math.max(1, Number(cols) || 80))
      const r = Math.min(200, Math.max(1, Number(rows) || 24))
      sessions.resize(sessionId, c, r)
    })
  )
  ipcMain.handle(IPC.sessionsDisconnect, async (_e, sessionId: string) =>
    withIpcErrors(async () => {
      sessions.disconnect(sessionId)
    })
  )

  ipcMain.handle(IPC.settingsGet, async () => withIpcErrors(() => settings.get()))
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<AppSettings>) =>
    withIpcErrors(() => settings.set(patch))
  )

  ipcMain.handle(IPC.fontsList, async () =>
    withIpcErrors(async () => {
      try {
        const { getFonts } = await import('font-list')
        const fonts = await getFonts({ disableQuoting: true })
        return [...new Set(fonts.map((f) => f.trim()).filter(Boolean))].sort((a, b) =>
          a.localeCompare(b)
        )
      } catch {
        return []
      }
    })
  )

  ipcMain.handle(IPC.appGetVersion, async () => withIpcErrors(async () => app.getVersion()))

  ipcMain.handle(IPC.credentialsIsAvailable, async () =>
    withIpcErrors(async () => credentials.isAvailable())
  )
  ipcMain.handle(
    IPC.credentialsSave,
    async (_e, hostId: string, payload: { password?: string; privateKeyPath?: string }) =>
      withIpcErrors(async () => {
        const secrets: { password?: string; privateKey?: string } = {}
        if (payload.password !== undefined) secrets.password = payload.password
        if (payload.privateKeyPath) {
          const safePath = await assertLocalPathUnderHome(payload.privateKeyPath)
          secrets.privateKey = await readFile(safePath, 'utf8')
        }
        await credentials.save(hostId, secrets)
        await store.update(hostId, { credentialsPrompted: true, credentialsSaved: true })
      })
  )
  ipcMain.handle(IPC.credentialsClear, async (_e, hostId: string) =>
    withIpcErrors(async () => {
      await credentials.clear(hostId)
      await store.update(hostId, { credentialsSaved: false })
    })
  )
  ipcMain.handle(
    IPC.credentialsMarkPrompted,
    async (_e, hostId: string, saved: boolean) =>
      withIpcErrors(async () => {
        await store.update(hostId, {
          credentialsPrompted: true,
          credentialsSaved: Boolean(saved)
        })
      })
  )

  ipcMain.handle(IPC.sftpList, async (_e, sessionId: string) =>
    withIpcErrors(() => sftp.list(sessionId))
  )
  ipcMain.handle(IPC.sftpCwd, async (_e, sessionId: string) =>
    withIpcErrors(() => sftp.cwd(sessionId))
  )
  ipcMain.handle(IPC.sftpChdir, async (_e, sessionId: string, remotePath: string) =>
    withIpcErrors(() => sftp.chdir(sessionId, remotePath))
  )
  ipcMain.handle(IPC.sftpMkdir, async (_e, sessionId: string, name: string) =>
    withIpcErrors(() => sftp.mkdir(sessionId, name))
  )
  ipcMain.handle(IPC.sftpRename, async (_e, sessionId: string, from: string, to: string) =>
    withIpcErrors(() => sftp.rename(sessionId, from, to))
  )
  ipcMain.handle(IPC.sftpRemove, async (_e, sessionId: string, remotePath: string) =>
    withIpcErrors(() => sftp.remove(sessionId, remotePath))
  )
  ipcMain.handle(IPC.sftpUpload, async (_e, sessionId: string) =>
    withIpcErrors(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Upload files',
        properties: ['openFile', 'multiSelections']
      })
      if (result.canceled || result.filePaths.length === 0) return
      for (const localPath of result.filePaths) {
        await sftp.upload(sessionId, localPath)
      }
    })
  )
  ipcMain.handle(IPC.sftpUploadPaths, async (_e, sessionId: string, localPaths: string[]) =>
    withIpcErrors(async () => {
      if (!Array.isArray(localPaths) || localPaths.length === 0) return
      for (const localPath of localPaths) {
        if (typeof localPath !== 'string' || !localPath.trim()) continue
        try {
          const safe = await assertLocalPathUnderHome(localPath)
          const info = await stat(safe)
          if (!info.isFile()) continue
          await sftp.upload(sessionId, safe)
        } catch {
          continue
        }
      }
    })
  )
  ipcMain.handle(
    IPC.sftpDownload,
    async (_e, sessionId: string, remotePath: string, defaultName: string) =>
      withIpcErrors(async () => {
        const result = await dialog.showSaveDialog({
          title: 'Save file',
          defaultPath: defaultName || basename(remotePath)
        })
        if (result.canceled || !result.filePath) return
        await sftp.download(sessionId, remotePath, result.filePath)
      })
  )

  ipcMain.handle(IPC.monitorSetActive, async (_e, sessionId: string | null, title?: string) =>
    withIpcErrors(async () => {
      monitor.setActive(sessionId, title ?? '')
    })
  )

  ipcMain.handle(IPC.mcpRegistrationStatus, async () =>
    withIpcErrors(() => mcpRegistration.status())
  )
  ipcMain.handle(
    IPC.mcpRegistrationRegister,
    async (_e, target: McpRegistrationTarget | 'all') =>
      withIpcErrors(() => mcpRegistration.register(target))
  )
  ipcMain.handle(IPC.mcpRegistrationClipboard, async () =>
    withIpcErrors(() => mcpRegistration.clipboardSnippet())
  )

  ipcMain.handle(IPC.dialogOpenPrivateKey, async () =>
    withIpcErrors(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select private key',
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
  )
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
