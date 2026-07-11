import { describe, expect, it } from 'vitest'
import { McpRuntime } from '../src/main/mcp-runtime'

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
