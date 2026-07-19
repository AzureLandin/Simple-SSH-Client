import { describe, expect, it } from 'vitest'
import { MAX_EXEC_BYTES, SSH_HARD_TIMEOUT_MS, SSH_READY_TIMEOUT_MS } from '../src/main/ssh-client'
import { MAX_MCP_FILE_BYTES } from '../src/main/mcp-runtime'

describe('performance caps', () => {
  it('defines a finite exec output ceiling', () => {
    expect(MAX_EXEC_BYTES).toBe(2 * 1024 * 1024)
  })

  it('defines a finite MCP file ceiling', () => {
    expect(MAX_MCP_FILE_BYTES).toBe(512 * 1024)
  })

  it('uses a 10s connect readyTimeout with a slightly higher hard abort', () => {
    expect(SSH_READY_TIMEOUT_MS).toBe(10_000)
    expect(SSH_HARD_TIMEOUT_MS).toBeGreaterThan(SSH_READY_TIMEOUT_MS)
  })
})
