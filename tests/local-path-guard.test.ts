import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { assertLocalPathUnderHome } from '../src/main/local-path-guard'

describe('assertLocalPathUnderHome', () => {
  it('allows paths under the home directory', async () => {
    const dir = mkdtempSync(join(homedir(), 'nodeshell-path-guard-'))
    const file = join(dir, 'ok.txt')
    writeFileSync(file, 'x')
    await expect(assertLocalPathUnderHome(file)).resolves.toBe(resolve(file))
  })

  it('rejects paths outside home', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nodeshell-outside-'))
    const file = join(outside, 'secret.txt')
    writeFileSync(file, 'x')
    // tmpdir is often outside home on Windows/Linux CI
    const home = resolve(homedir())
    if (!resolve(file).startsWith(home)) {
      await expect(assertLocalPathUnderHome(file)).rejects.toMatchObject({
        code: 'UNKNOWN'
      })
    }
  })

  it('allows non-existent files whose parent is under home', async () => {
    const dir = mkdtempSync(join(homedir(), 'nodeshell-path-guard-'))
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'new-file.bin')
    await expect(assertLocalPathUnderHome(target)).resolves.toBe(resolve(target))
  })
})
