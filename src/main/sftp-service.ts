import { createWriteStream, createReadStream, statSync } from 'fs'
import { mkdir } from 'fs/promises'
import { basename, dirname } from 'path'
import type { BrowserWindow } from 'electron'
import type { Attributes, SFTPWrapper } from 'ssh2'
import { IPC, type SftpTransferProgressEvent } from '../shared/types'
import type { SshClient } from './ssh-client'

export interface SftpEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime: number
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

function modeIsDir(mode: number): boolean {
  return (mode & S_IFMT) === S_IFDIR
}

function modeIsLink(mode: number): boolean {
  return (mode & S_IFMT) === S_IFLNK
}

function entryFromListing(
  resolvedDir: string,
  name: string,
  attrs: Attributes,
  isDirectory: boolean
): SftpEntry {
  return {
    name,
    path: joinRemote(resolvedDir, name),
    isDirectory,
    size: attrs.size ?? 0,
    modifyTime: (attrs.mtime ?? 0) * 1000
  }
}

export function joinRemote(cwd: string, name: string): string {
  if (name.startsWith('/')) return name.replace(/\/+/g, '/')
  const base = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd
  if (name === '..') {
    if (base === '' || base === '/') return '/'
    const idx = base.lastIndexOf('/')
    return idx <= 0 ? '/' : base.slice(0, idx) || '/'
  }
  if (name === '.' || name === '') return base || '/'
  return `${base === '/' ? '' : base}/${name}`.replace(/\/+/g, '/') || '/'
}

export class SftpService {
  private handles = new Map<string, SFTPWrapper>()
  private cwds = new Map<string, string>()

  constructor(
    private readonly getSshClient: (sessionId: string) => SshClient,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  async ensure(sessionId: string): Promise<SFTPWrapper> {
    const existing = this.handles.get(sessionId)
    if (existing) return existing

    const ssh = this.getSshClient(sessionId)
    const raw = ssh.getRawClient()
    if (!raw) throw { code: 'SESSION_NOT_FOUND', message: 'SSH client missing' }

    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      raw.sftp((err, sftpSession) => {
        if (err || !sftpSession) {
          reject({ code: 'UNKNOWN', message: err?.message ?? 'Failed to open SFTP' })
          return
        }
        resolve(sftpSession)
      })
    })

    this.handles.set(sessionId, sftp)
    if (!this.cwds.has(sessionId)) {
      const home = await this.realpath(sftp, '.')
      this.cwds.set(sessionId, home)
    }
    return sftp
  }

  dispose(sessionId: string): void {
    const h = this.handles.get(sessionId)
    if (h) {
      try {
        h.end()
      } catch {
        /* ignore */
      }
    }
    this.handles.delete(sessionId)
    this.cwds.delete(sessionId)
  }

  async cwd(sessionId: string): Promise<string> {
    await this.ensure(sessionId)
    return this.cwds.get(sessionId) ?? '/'
  }

  async chdir(sessionId: string, remotePath: string): Promise<string> {
    const sftp = await this.ensure(sessionId)
    const current = this.cwds.get(sessionId) ?? '/'
    const next = joinRemote(current, remotePath)
    const resolved = await this.realpath(sftp, next)
    const attrs = await this.stat(sftp, resolved)
    if (!attrs.isDirectory) {
      throw { code: 'UNKNOWN', message: 'Not a directory' }
    }
    this.cwds.set(sessionId, resolved)
    return resolved
  }

  async list(sessionId: string, remotePath?: string): Promise<SftpEntry[]> {
    const sftp = await this.ensure(sessionId)
    const cwd = this.cwds.get(sessionId) ?? '/'
    const target = remotePath ? joinRemote(cwd, remotePath) : cwd
    // cwd is already absolute after ensure/chdir — skip an extra realpath RTT.
    const resolved =
      !remotePath && target.startsWith('/') ? target : await this.realpath(sftp, target)

    type Listed = { filename: string; attrs: Attributes }
    const listed = await new Promise<Listed[]>((resolve, reject) => {
      sftp.readdir(resolved, (err, list) => {
        if (err) {
          reject({ code: 'UNKNOWN', message: err.message })
          return
        }
        resolve(list.map((i) => ({ filename: i.filename, attrs: i.attrs })))
      })
    })

    const entries: SftpEntry[] = []
    const symlinkNames: string[] = []

    for (const item of listed) {
      const name = item.filename
      if (name === '.' || name === '..') continue
      const mode = item.attrs.mode ?? 0
      if (modeIsLink(mode)) {
        symlinkNames.push(name)
        continue
      }
      entries.push(entryFromListing(resolved, name, item.attrs, modeIsDir(mode)))
    }

    // Only follow symlinks (uncommon); use attrs from readdir for everything else.
    if (symlinkNames.length > 0) {
      const followed = await Promise.all(
        symlinkNames.map(async (name) => {
          const full = joinRemote(resolved, name)
          try {
            const attrs = await this.stat(sftp, full)
            return {
              name,
              path: full,
              isDirectory: attrs.isDirectory,
              size: attrs.size,
              modifyTime: attrs.mtime
            } satisfies SftpEntry
          } catch {
            return {
              name,
              path: full,
              isDirectory: false,
              size: 0,
              modifyTime: 0
            } satisfies SftpEntry
          }
        })
      )
      entries.push(...followed)
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return entries
  }

  async mkdir(sessionId: string, name: string): Promise<void> {
    const sftp = await this.ensure(sessionId)
    const cwd = this.cwds.get(sessionId) ?? '/'
    const path = joinRemote(cwd, name)
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(path, (err) => {
        if (err) reject({ code: 'UNKNOWN', message: err.message })
        else resolve()
      })
    })
  }

  async rename(sessionId: string, fromName: string, toName: string): Promise<void> {
    const sftp = await this.ensure(sessionId)
    const cwd = this.cwds.get(sessionId) ?? '/'
    const from = joinRemote(cwd, fromName)
    const to = joinRemote(cwd, toName)
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (err) => {
        if (err) reject({ code: 'UNKNOWN', message: err.message })
        else resolve()
      })
    })
  }

  async remove(sessionId: string, remotePath: string): Promise<void> {
    const sftp = await this.ensure(sessionId)
    const cwd = this.cwds.get(sessionId) ?? '/'
    const path = joinRemote(cwd, remotePath)
    await this.removePath(sftp, path)
  }

  async upload(sessionId: string, localPath: string, remoteName?: string): Promise<void> {
    const sftp = await this.ensure(sessionId)
    const cwd = this.cwds.get(sessionId) ?? '/'
    const name = remoteName || basename(localPath)
    const remotePath = joinRemote(cwd, name)
    let total = 0
    try {
      total = statSync(localPath).size
    } catch {
      total = 0
    }

    await this.transferStream({
      sessionId,
      direction: 'up',
      name,
      total,
      run: (onChunk) =>
        new Promise<void>((resolve, reject) => {
          const read = createReadStream(localPath)
          const write = sftp.createWriteStream(remotePath)
          read.on('data', (chunk: Buffer | string) => {
            onChunk(typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length)
          })
          read.on('error', (err) => reject({ code: 'UNKNOWN', message: err.message }))
          write.on('error', (err) => reject({ code: 'UNKNOWN', message: err.message }))
          write.on('close', () => resolve())
          read.pipe(write)
        })
    })
  }

  async download(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.ensure(sessionId)
    const cwd = this.cwds.get(sessionId) ?? '/'
    const remote = joinRemote(cwd, remotePath)
    await mkdir(dirname(localPath), { recursive: true })
    const attrs = await this.stat(sftp, remote)
    const name = basename(remote)

    await this.transferStream({
      sessionId,
      direction: 'down',
      name,
      total: attrs.size,
      run: (onChunk) =>
        new Promise<void>((resolve, reject) => {
          const read = sftp.createReadStream(remote)
          const write = createWriteStream(localPath)
          read.on('data', (chunk: Buffer | string) => {
            onChunk(typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length)
          })
          read.on('error', (err) => reject({ code: 'UNKNOWN', message: err.message }))
          write.on('error', (err) => reject({ code: 'UNKNOWN', message: err.message }))
          write.on('close', () => resolve())
          read.pipe(write)
        })
    })
  }

  private async transferStream(opts: {
    sessionId: string
    direction: 'up' | 'down'
    name: string
    total: number
    run: (onChunk: (bytes: number) => void) => Promise<void>
  }): Promise<void> {
    let transferred = 0
    let lastEmit = 0
    const emit = (done: boolean): void => {
      const now = Date.now()
      if (!done && now - lastEmit < 80) return
      lastEmit = now
      this.pushProgress({
        sessionId: opts.sessionId,
        direction: opts.direction,
        name: opts.name,
        transferred,
        total: opts.total,
        done
      })
    }

    emit(false)
    try {
      await opts.run((bytes) => {
        transferred += bytes
        emit(false)
      })
      transferred = opts.total > 0 ? Math.max(transferred, opts.total) : transferred
      emit(true)
    } catch (err) {
      emit(true)
      throw err
    }
  }

  private pushProgress(event: SftpTransferProgressEvent): void {
    const win = this.getWindow()
    win?.webContents.send(IPC.sftpTransferProgress, event)
  }

  private async removePath(sftp: SFTPWrapper, path: string): Promise<void> {
    const attrs = await this.stat(sftp, path)
    if (!attrs.isDirectory) {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(path, (err) => {
          if (err) reject({ code: 'UNKNOWN', message: err.message })
          else resolve()
        })
      })
      return
    }

    const names = await new Promise<string[]>((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) reject({ code: 'UNKNOWN', message: err.message })
        else resolve(list.map((i) => i.filename).filter((n) => n !== '.' && n !== '..'))
      })
    })
    for (const name of names) {
      await this.removePath(sftp, joinRemote(path, name))
    }
    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(path, (err) => {
        if (err) reject({ code: 'UNKNOWN', message: err.message })
        else resolve()
      })
    })
  }

  private realpath(sftp: SFTPWrapper, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      sftp.realpath(path, (err, abs) => {
        if (err || !abs) reject({ code: 'UNKNOWN', message: err?.message ?? 'realpath failed' })
        else resolve(abs)
      })
    })
  }

  private stat(
    sftp: SFTPWrapper,
    path: string
  ): Promise<{ isDirectory: boolean; size: number; mtime: number }> {
    return new Promise((resolve, reject) => {
      sftp.stat(path, (err, attrs) => {
        if (err || !attrs) {
          reject({ code: 'UNKNOWN', message: err?.message ?? 'stat failed' })
          return
        }
        resolve({
          isDirectory: attrs.isDirectory(),
          size: attrs.size,
          mtime: attrs.mtime * 1000
        })
      })
    })
  }
}
