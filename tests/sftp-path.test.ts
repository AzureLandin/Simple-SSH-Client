import { describe, expect, it } from 'vitest'
import { joinRemote } from '../src/main/sftp-service'

describe('joinRemote', () => {
  it('joins relative segments', () => {
    expect(joinRemote('/home/user', 'docs')).toBe('/home/user/docs')
    expect(joinRemote('/', 'tmp')).toBe('/tmp')
  })

  it('handles parent directory', () => {
    expect(joinRemote('/home/user', '..')).toBe('/home')
    expect(joinRemote('/home', '..')).toBe('/')
    expect(joinRemote('/', '..')).toBe('/')
  })

  it('keeps absolute paths', () => {
    expect(joinRemote('/home', '/etc')).toBe('/etc')
  })
})
