import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ConnectOptions, type ElectronApi, type HostInput } from '../shared/types'

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
    write: (sessionId, data) => ipcRenderer.invoke(IPC.sessionsWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke(IPC.sessionsResize, sessionId, cols, rows),
    disconnect: (sessionId) => ipcRenderer.invoke(IPC.sessionsDisconnect, sessionId),
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
  dialog: {
    openPrivateKeyFile: () => ipcRenderer.invoke(IPC.dialogOpenPrivateKey)
  }
}

contextBridge.exposeInMainWorld('api', api)
