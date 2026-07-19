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

  it('normalizes embedded .. segments', () => {
    expect(joinRemote('/home/user', 'docs/../../etc/passwd')).toBe('/home/etc/passwd')
    expect(joinRemote('/home/user', 'a/b/../c')).toBe('/home/user/a/c')
    expect(joinRemote('/home/user', '../../../etc')).toBe('/etc')
  })

  it('keeps absolute paths', () => {
    expect(joinRemote('/home', '/etc')).toBe('/etc')
    expect(joinRemote('/home', '/etc/../tmp')).toBe('/tmp')
  })
})
