import { describe, expect, it, vi, afterEach } from 'vitest'
import { McpRuntime } from '../src/main/mcp-runtime'
import {
  normalizeMcpIdleTimeoutMinutes,
  normalizeMcpMaxSessions,
  DEFAULT_SETTINGS
} from '../src/main/settings-store'

function fakeClient(): { dispose: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  return { dispose: vi.fn(), onClose: vi.fn() }
}

describe('McpRuntime.formatError', () => {
  it('includes app error code when present', () => {
    expect(McpRuntime.formatError({ code: 'AUTH_FAILED', message: 'bad password' })).toBe(
      'AUTH_FAILED: bad password'
    )
  })

  it('falls back to Error message', () => {
    expect(McpRuntime.formatError(new Error('boom'))).toBe('boom')
  })
})

describe('MCP session policy normals', () => {
  it('defaults and clamps idle timeout minutes', () => {
    expect(normalizeMcpIdleTimeoutMinutes(undefined)).toBe(DEFAULT_SETTINGS.mcpIdleTimeoutMinutes)
    expect(normalizeMcpIdleTimeoutMinutes(0)).toBe(1)
    expect(normalizeMcpIdleTimeoutMinutes(10)).toBe(10)
    expect(normalizeMcpIdleTimeoutMinutes(999)).toBe(120)
  })

  it('defaults and clamps max sessions', () => {
    expect(normalizeMcpMaxSessions(undefined)).toBe(DEFAULT_SETTINGS.mcpMaxSessions)
    expect(normalizeMcpMaxSessions(0)).toBe(1)
    expect(normalizeMcpMaxSessions(8)).toBe(8)
    expect(normalizeMcpMaxSessions(100)).toBe(32)
  })
})

describe('McpRuntime session limits', () => {
  const hosts = { list: vi.fn(), getById: vi.fn() }
  const credentials = { get: vi.fn() }
  const knownHosts = {}
  let runtime: McpRuntime

  afterEach(() => {
    runtime?.disposeAll()
  })

  it('reaps sessions past idle timeout', async () => {
    runtime = new McpRuntime(
      hosts as never,
      credentials as never,
      knownHosts as never,
      async () => ({ idleTimeoutMs: 1_000, maxSessions: 8 })
    )
    runtime.addSessionForTest({
      id: 'old',
      hostId: 'h1',
      title: 'u@h',
      client: fakeClient() as never,
      lastActiveAt: Date.now() - 5_000
    })
    runtime.addSessionForTest({
      id: 'fresh',
      hostId: 'h1',
      title: 'u@h',
      client: fakeClient() as never,
      lastActiveAt: Date.now()
    })

    const closed = await runtime.reapIdleSessions()
    expect(closed).toEqual(['old'])
    expect(runtime.listSessions().map((s) => s.sessionId)).toEqual(['fresh'])
  })

  it('rejects connect when at max sessions', async () => {
    runtime = new McpRuntime(
      hosts as never,
      credentials as never,
      knownHosts as never,
      async () => ({ idleTimeoutMs: 600_000, maxSessions: 2 })
    )
    runtime.addSessionForTest({
      id: 'a',
      hostId: 'h',
      title: 't',
      client: fakeClient() as never
    })
    runtime.addSessionForTest({
      id: 'b',
      hostId: 'h',
      title: 't',
      client: fakeClient() as never
    })

    await expect(runtime.connectHost('h')).rejects.toMatchObject({ code: 'MCP_SESSION_LIMIT' })
    expect(hosts.getById).not.toHaveBeenCalled()
  })
})
