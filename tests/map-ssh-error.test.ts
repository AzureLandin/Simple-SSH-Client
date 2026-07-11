import { describe, expect, it } from 'vitest'
import { mapSshError } from '../src/shared/map-ssh-error'

describe('mapSshError', () => {
  it('maps ECONNREFUSED', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    expect(mapSshError(err)).toEqual({
      code: 'CONNECTION_REFUSED',
      message: 'Connection refused'
    })
  })

  it('maps ETIMEDOUT', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    expect(mapSshError(err).code).toBe('TIMEOUT')
  })

  it('maps ENOTFOUND / EHOSTUNREACH to HOST_UNREACHABLE', () => {
    expect(mapSshError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).code).toBe(
      'HOST_UNREACHABLE'
    )
    expect(mapSshError(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' })).code).toBe(
      'HOST_UNREACHABLE'
    )
  })

  it('maps auth failure messages to AUTH_FAILED', () => {
    expect(mapSshError(new Error('All configured authentication methods failed')).code).toBe(
      'AUTH_FAILED'
    )
  })

  it('maps unknown errors', () => {
    expect(mapSshError(new Error('weird')).code).toBe('UNKNOWN')
  })
})