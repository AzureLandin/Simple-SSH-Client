import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AppSettings,
  type ConnectOptions,
  type ElectronApi,
  type HostInput
} from '../shared/types'

const api: ElectronApi = {
  hosts: {
    list: () => ipcRenderer.invoke(IPC.hostsList),
    create: (input: HostInput) => ipcRenderer.invoke(IPC.hostsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.hostsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.hostsRemove, id)
  },
  sessions: {
    connect: (hostId, options?: ConnectOptions) =>
      ipcRenderer.invoke(IPC.sessionsConnect, hostId, options),
    write: (sessionId, data) => {
      ipcRenderer.send(IPC.sessionsWrite, sessionId, data)
    },
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke(IPC.sessionsResize, sessionId, cols, rows),
    disconnect: (sessionId) => ipcRenderer.invoke(IPC.sessionsDisconnect, sessionId),
    cancelConnect: () => ipcRenderer.invoke(IPC.sessionsCancelConnect),
    onData: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.sessionData, listener)
      return () => ipcRenderer.removeListener(IPC.sessionData, listener)
    },
    onClosed: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.sessionClosed, listener)
      return () => ipcRenderer.removeListener(IPC.sessionClosed, listener)
    },
    onError: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.sessionError, listener)
      return () => ipcRenderer.removeListener(IPC.sessionError, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  fonts: {
    list: () => ipcRenderer.invoke(IPC.fontsList)
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.appGetVersion)
  },
  credentials: {
    isAvailable: () => ipcRenderer.invoke(IPC.credentialsIsAvailable),
    save: (hostId, payload) => ipcRenderer.invoke(IPC.credentialsSave, hostId, payload),
    clear: (hostId) => ipcRenderer.invoke(IPC.credentialsClear, hostId),
    markPrompted: (hostId, saved) =>
      ipcRenderer.invoke(IPC.credentialsMarkPrompted, hostId, saved)
  },
  sftp: {
    list: (sessionId) => ipcRenderer.invoke(IPC.sftpList, sessionId),
    cwd: (sessionId) => ipcRenderer.invoke(IPC.sftpCwd, sessionId),
    chdir: (sessionId, remotePath) => ipcRenderer.invoke(IPC.sftpChdir, sessionId, remotePath),
    mkdir: (sessionId, name) => ipcRenderer.invoke(IPC.sftpMkdir, sessionId, name),
    rename: (sessionId, from, to) => ipcRenderer.invoke(IPC.sftpRename, sessionId, from, to),
    remove: (sessionId, remotePath) => ipcRenderer.invoke(IPC.sftpRemove, sessionId, remotePath),
    upload: (sessionId) => ipcRenderer.invoke(IPC.sftpUpload, sessionId),
    uploadPaths: (sessionId, localPaths) =>
      ipcRenderer.invoke(IPC.sftpUploadPaths, sessionId, localPaths),
    download: (sessionId, remotePath, defaultName) =>
      ipcRenderer.invoke(IPC.sftpDownload, sessionId, remotePath, defaultName),
    onTransferProgress: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) =>
        cb(payload)
      ipcRenderer.on(IPC.sftpTransferProgress, listener)
      return () => ipcRenderer.removeListener(IPC.sftpTransferProgress, listener)
    }
  },
  files: {
    getPathForFile: (file) => webUtils.getPathForFile(file)
  },
  monitor: {
    setActive: (sessionId, title) => ipcRenderer.invoke(IPC.monitorSetActive, sessionId, title),
    onUpdate: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.monitorUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.monitorUpdate, listener)
    }
  },
  mcpRegistration: {
    status: () => ipcRenderer.invoke(IPC.mcpRegistrationStatus),
    register: (target) => ipcRenderer.invoke(IPC.mcpRegistrationRegister, target),
    clipboardSnippet: () => ipcRenderer.invoke(IPC.mcpRegistrationClipboard)
  },
  dialog: {
    openPrivateKeyFile: () => ipcRenderer.invoke(IPC.dialogOpenPrivateKey)
  }
}

contextBridge.exposeInMainWorld('api', api)
