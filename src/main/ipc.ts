import { dialog, ipcMain, safeStorage, app } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import type { ConnectionStore } from './connection-store'
import type { CredentialStore } from './credential-store'
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

export function registerIpc(
  store: ConnectionStore,
  sessions: SessionManager,
  settings: SettingsStore,
  credentials: CredentialStore,
  sftp: SftpService,
  monitor: MonitorService
): void {
  const mcpRegistration = new McpRegistrationService(() => {
    // Prefer cwd in electron-vite dev; fall back to app path.
    return process.cwd() || app.getAppPath()
  })

  ipcMain.handle(IPC.hostsList, async () => store.list())
  ipcMain.handle(IPC.hostsCreate, async (_e, input: HostInput) => store.create(input))
  ipcMain.handle(IPC.hostsUpdate, async (_e, id: string, patch: Partial<HostInput>) =>
    store.update(id, patch)
  )
  ipcMain.handle(IPC.hostsRemove, async (_e, id: string) => {
    await store.remove(id)
    await credentials.clear(id)
  })

  ipcMain.handle(IPC.sessionsConnect, async (_e, hostId: string, options?: ConnectOptions) => {
    const result = await sessions.connect(hostId, options)
    // Warm SFTP channel in background so the first panel open is faster.
    void sftp.ensure(result.sessionId).catch(() => {})
    return result
  })
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

  ipcMain.handle(IPC.fontsList, async () => {
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

  ipcMain.handle(IPC.sftpList, async (_e, sessionId: string) => sftp.list(sessionId))
  ipcMain.handle(IPC.sftpCwd, async (_e, sessionId: string) => sftp.cwd(sessionId))
  ipcMain.handle(IPC.sftpChdir, async (_e, sessionId: string, remotePath: string) =>
    sftp.chdir(sessionId, remotePath)
  )
  ipcMain.handle(IPC.sftpMkdir, async (_e, sessionId: string, name: string) =>
    sftp.mkdir(sessionId, name)
  )
  ipcMain.handle(IPC.sftpRename, async (_e, sessionId: string, from: string, to: string) =>
    sftp.rename(sessionId, from, to)
  )
  ipcMain.handle(IPC.sftpRemove, async (_e, sessionId: string, remotePath: string) =>
    sftp.remove(sessionId, remotePath)
  )
  ipcMain.handle(IPC.sftpUpload, async (_e, sessionId: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Upload files',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return
    for (const localPath of result.filePaths) {
      await sftp.upload(sessionId, localPath)
    }
  })
  ipcMain.handle(IPC.sftpUploadPaths, async (_e, sessionId: string, localPaths: string[]) => {
    if (!Array.isArray(localPaths) || localPaths.length === 0) return
    for (const localPath of localPaths) {
      if (typeof localPath !== 'string' || !localPath.trim()) continue
      try {
        const info = await stat(localPath)
        if (!info.isFile()) continue
      } catch {
        continue
      }
      await sftp.upload(sessionId, localPath)
    }
  })
  ipcMain.handle(
    IPC.sftpDownload,
    async (_e, sessionId: string, remotePath: string, defaultName: string) => {
      const result = await dialog.showSaveDialog({
        title: 'Save file',
        defaultPath: defaultName || basename(remotePath)
      })
      if (result.canceled || !result.filePath) return
      await sftp.download(sessionId, remotePath, result.filePath)
    }
  )

  ipcMain.handle(IPC.monitorSetActive, async (_e, sessionId: string | null, title?: string) => {
    monitor.setActive(sessionId, title ?? '')
  })

  ipcMain.handle(IPC.mcpRegistrationStatus, async () => mcpRegistration.status())
  ipcMain.handle(
    IPC.mcpRegistrationRegister,
    async (_e, target: McpRegistrationTarget | 'all') => mcpRegistration.register(target)
  )
  ipcMain.handle(IPC.mcpRegistrationClipboard, async () => mcpRegistration.clipboardSnippet())

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
