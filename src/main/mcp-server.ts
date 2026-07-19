import net from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { ConnectionStore } from './connection-store'
import type { CredentialStore } from './credential-store'
import type { KnownHosts } from './known-hosts'
import type { SettingsStore } from './settings-store'
import { McpRuntime } from './mcp-runtime'

function connectMcpSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => resolve(socket))
    socket.once('error', reject)
  })
}

function text(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
  }
}

function toolError(err: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  return {
    content: [{ type: 'text', text: McpRuntime.formatError(err) }],
    isError: true
  }
}

export async function startMcpServer(
  deps: {
    hosts: ConnectionStore
    credentials: CredentialStore
    knownHosts: KnownHosts
    settings: SettingsStore
  },
  options?: { socketPort?: number }
): Promise<void> {
  const runtime = new McpRuntime(deps.hosts, deps.credentials, deps.knownHosts, async () => {
    const s = await deps.settings.get()
    return {
      idleTimeoutMs: s.mcpIdleTimeoutMinutes * 60_000,
      maxSessions: s.mcpMaxSessions
    }
  })
  const server = new McpServer({ name: 'nodeshell', version: '2.0.0' })

  server.tool('list_hosts', 'List saved SSH hosts (no secrets).', async () => {
    try {
      const hosts = await runtime.listHosts()
      return text(
        hosts.map((h) => ({
          id: h.id,
          name: h.name,
          host: h.host,
          port: h.port,
          username: h.username,
          authMethod: h.authMethod,
          credentialsSaved: Boolean(h.credentialsSaved)
        }))
      )
    } catch (err) {
      return toolError(err)
    }
  })

  server.tool(
    'list_sessions',
    'List active MCP SSH sessions opened by this server process.',
    async () => {
      try {
        return text(runtime.listSessions())
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'connect_host',
    'Connect to a saved host and open an SSH session for commands/SFTP.',
    {
      hostId: z.string().describe('Host id from list_hosts'),
      password: z.string().optional().describe('Override password if not saved'),
      acceptHostKey: z
        .boolean()
        .optional()
        .describe(
          'Accept and store a new or changed host key. Default false — set true only after verifying the fingerprint.'
        )
    },
    async ({ hostId, password, acceptHostKey }) => {
      try {
        const result = await runtime.connectHost(hostId, { password, acceptHostKey })
        return text(result)
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'disconnect_session',
    'Disconnect an active MCP SSH session.',
    { sessionId: z.string() },
    async ({ sessionId }) => {
      try {
        runtime.disconnectSession(sessionId)
        return text({ ok: true, sessionId })
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'run_command',
    'Run a non-interactive command on the remote host via SSH exec (not PTY).',
    {
      sessionId: z.string(),
      command: z.string().describe('Shell command to execute'),
      timeoutMs: z.number().int().positive().max(300000).optional()
    },
    async ({ sessionId, command, timeoutMs }) => {
      try {
        const output = await runtime.runCommand(sessionId, command, timeoutMs ?? 60000)
        return text(output)
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'sftp_list',
    'List a remote directory. If path is given, chdir there first for this session.',
    {
      sessionId: z.string(),
      path: z.string().optional().describe('Remote directory path (absolute or relative)')
    },
    async ({ sessionId, path }) => {
      try {
        return text(await runtime.sftpList(sessionId, path))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'sftp_read',
    'Read a remote text file (max 512KB).',
    { sessionId: z.string(), path: z.string() },
    async ({ sessionId, path }) => {
      try {
        return text(await runtime.sftpRead(sessionId, path))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'sftp_write',
    'Write UTF-8 text to a remote file (creates/overwrites).',
    {
      sessionId: z.string(),
      path: z.string(),
      content: z.string()
    },
    async ({ sessionId, path, content }) => {
      try {
        await runtime.sftpWrite(sessionId, path, content)
        return text({ ok: true, path })
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'sftp_upload',
    'Upload a local file under the user home directory to the remote session current directory.',
    {
      sessionId: z.string(),
      localPath: z.string().describe('Absolute local path under the user home directory'),
      remoteName: z.string().optional()
    },
    async ({ sessionId, localPath, remoteName }) => {
      try {
        await runtime.sftpUpload(sessionId, localPath, remoteName)
        return text({ ok: true, localPath, remoteName: remoteName ?? undefined })
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.tool(
    'sftp_download',
    'Download a remote file to a local path under the user home directory.',
    {
      sessionId: z.string(),
      remotePath: z.string(),
      localPath: z.string().describe('Absolute local path under the user home directory')
    },
    async ({ sessionId, remotePath, localPath }) => {
      try {
        await runtime.sftpDownload(sessionId, remotePath, localPath)
        return text({ ok: true, remotePath, localPath })
      } catch (err) {
        return toolError(err)
      }
    }
  )

  let transport: StdioServerTransport
  if (options?.socketPort != null) {
    const socket = await connectMcpSocket(options.socketPort)
    transport = new StdioServerTransport(socket, socket)
  } else {
    transport = new StdioServerTransport()
  }
  await server.connect(transport)

  const shutdown = (): void => {
    runtime.disposeAll()
    void server.close()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
