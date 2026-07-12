import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ConnectionStore } from './connection-store'
import { CredentialStore } from './credential-store'
import { KnownHosts } from './known-hosts'
import { MonitorService } from './monitor-service'
import { SessionManager } from './session-manager'
import { SettingsStore } from './settings-store'
import { SftpService } from './sftp-service'
import { createCredentialSafeStorage, registerIpc } from './ipc'

// Unpackaged Electron defaults userData to ".../Electron"; pin to nodeshell so MCP and GUI share hosts.
app.setPath('userData', join(app.getPath('appData'), 'nodeshell'))

const mcpMode = process.argv.includes('--mcp')
const mcpSocketArg = process.argv.find((a) => a.startsWith('--mcp-socket='))
const mcpSocketPort = mcpSocketArg ? Number(mcpSocketArg.slice('--mcp-socket='.length)) : undefined

/** Keep MCP stdio clean — never write logs to stdout in MCP mode. */
function mcpLog(message: string): void {
  if (mcpMode) process.stderr.write(`[nodeshell-mcp] ${message}\n`)
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    title: 'NodeShell',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.nodeshell.app')

  const store = new ConnectionStore(join(app.getPath('userData'), 'hosts.json'))
  const knownHosts = new KnownHosts(join(app.getPath('userData'), 'known_hosts.json'))
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  const credentials = new CredentialStore(
    join(app.getPath('userData'), 'credentials.json'),
    createCredentialSafeStorage()
  )

  if (mcpMode) {
    const via =
      mcpSocketPort != null && Number.isFinite(mcpSocketPort)
        ? `socket :${mcpSocketPort}`
        : 'stdio'
    mcpLog(`starting MCP on ${via} (userData=${app.getPath('userData')})`)
    const { startMcpServer } = await import('./mcp-server')
    await startMcpServer(
      { hosts: store, credentials, knownHosts, settings },
      mcpSocketPort != null && Number.isFinite(mcpSocketPort)
        ? { socketPort: mcpSocketPort }
        : undefined
    )
    mcpLog(`MCP server connected on ${via}`)
    return
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Touch settings store so defaults exist after first GUI launch.
  void settings.get()

  createWindow()

  let sftp!: SftpService
  let monitor!: MonitorService
  const sessions = new SessionManager(
    store,
    knownHosts,
    credentials,
    () => mainWindow,
    (sessionId) => {
      sftp.dispose(sessionId)
      monitor.disposeSession(sessionId)
    }
  )
  sftp = new SftpService((sessionId) => sessions.getClient(sessionId), () => mainWindow)
  monitor = new MonitorService((sessionId) => sessions.getClient(sessionId), () => mainWindow)
  registerIpc(store, sessions, settings, credentials, sftp, monitor)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (mcpMode) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
