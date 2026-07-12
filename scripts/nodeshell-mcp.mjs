#!/usr/bin/env node
/**
 * Windows-safe MCP launcher: OpenCode talks to this Node process over stdio.
 * Electron's stdin closes ~150ms after start on Windows, so we relay via a
 * localhost TCP socket instead.
 */
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const outMainIndex = join(repoRoot, 'out', 'main', 'index.js')

const electronWin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const electronUnix = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron')
const electronLaunch =
  process.platform === 'win32' && existsSync(electronWin)
    ? electronWin
    : existsSync(electronUnix)
      ? electronUnix
      : join(repoRoot, 'node_modules', 'electron', 'cli.js')

if (!existsSync(outMainIndex)) {
  process.stderr.write(`[nodeshell-mcp] missing ${outMainIndex} — run npm run build first\n`)
  process.exit(1)
}

if (!existsSync(electronLaunch)) {
  process.stderr.write(`[nodeshell-mcp] missing Electron binary at ${electronLaunch}\n`)
  process.exit(1)
}

let electronChild = null
let relaySocket = null
let connected = false
/** Buffer stdin until Electron connects — do not resume() early or bytes are discarded. */
const stdinChunks = []
let stdinEnded = false

function killElectron() {
  if (electronChild && !electronChild.killed) {
    try {
      electronChild.kill()
    } catch {
      /* ignore */
    }
  }
}

function cleanupAndExit(code = 0) {
  if (relaySocket) {
    try {
      relaySocket.destroy()
    } catch {
      /* ignore */
    }
    relaySocket = null
  }
  killElectron()
  process.exit(code)
}

process.stdin.on('data', (chunk) => {
  if (relaySocket) {
    relaySocket.write(chunk)
  } else {
    stdinChunks.push(chunk)
  }
})
process.stdin.on('end', () => {
  stdinEnded = true
  if (relaySocket) {
    try {
      relaySocket.end()
    } catch {
      /* ignore */
    }
    killElectron()
  }
})
process.stdin.on('close', () => {
  if (relaySocket) {
    try {
      relaySocket.destroy()
    } catch {
      /* ignore */
    }
    killElectron()
  }
})
process.stdin.on('error', (err) => {
  process.stderr.write(`[nodeshell-mcp] stdin error: ${err.message}\n`)
})
process.stdout.on('error', (err) => {
  process.stderr.write(`[nodeshell-mcp] stdout error: ${err.message}\n`)
})

const server = createServer((socket) => {
  if (connected) {
    socket.destroy()
    return
  }
  connected = true
  relaySocket = socket
  server.close()

  socket.on('error', (err) => {
    process.stderr.write(`[nodeshell-mcp] socket error: ${err.message}\n`)
  })

  // Flush any stdin that arrived before Electron connected, then keep relaying.
  for (const chunk of stdinChunks) {
    socket.write(chunk)
  }
  stdinChunks.length = 0
  if (stdinEnded) {
    socket.end()
  }

  // Electron → OpenCode
  socket.pipe(process.stdout)

  socket.on('close', () => {
    killElectron()
  })
})

server.on('error', (err) => {
  process.stderr.write(`[nodeshell-mcp] TCP server error: ${err.message}\n`)
  cleanupAndExit(1)
})

server.listen(0, '127.0.0.1', () => {
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    process.stderr.write('[nodeshell-mcp] failed to bind TCP port\n')
    cleanupAndExit(1)
    return
  }
  const port = addr.port

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(electronLaunch, [outMainIndex, '--mcp', `--mcp-socket=${port}`], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
    windowsHide: true
  })
  electronChild = child

  child.on('error', (err) => {
    process.stderr.write(`[nodeshell-mcp] failed to spawn Electron: ${err.message}\n`)
    cleanupAndExit(1)
  })

  child.on('exit', (code, signal) => {
    if (!connected) {
      process.stderr.write(
        `[nodeshell-mcp] Electron exited before MCP socket connect (code=${code}, signal=${signal})\n`
      )
      cleanupAndExit(code ?? 1)
      return
    }
    if (relaySocket) {
      try {
        relaySocket.destroy()
      } catch {
        /* ignore */
      }
    }
    process.exit(code ?? (signal ? 1 : 0))
  })
})
