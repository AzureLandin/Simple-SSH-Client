import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'

function isInsideDir(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Resolve a local path and require it to stay under the user home directory.
 * For paths that do not exist yet (download targets), the parent must exist
 * under home (or home itself).
 */
export async function assertLocalPathUnderHome(localPath: string): Promise<string> {
  if (typeof localPath !== 'string' || !localPath.trim()) {
    throw { code: 'UNKNOWN', message: 'Local path is required' }
  }

  const home = await realpath(homedir())
  const absolute = resolve(localPath)

  try {
    const resolved = await realpath(absolute)
    if (!isInsideDir(home, resolved)) {
      throw { code: 'UNKNOWN', message: 'Local path outside home directory is not allowed' }
    }
    return resolved
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === 'UNKNOWN') {
      throw err
    }
    // Target may not exist yet (downloads / new files).
    const parent = dirname(absolute)
    let resolvedParent: string
    try {
      resolvedParent = await realpath(parent)
    } catch {
      throw { code: 'UNKNOWN', message: `Parent directory does not exist: ${parent}` }
    }
    if (!isInsideDir(home, resolvedParent)) {
      throw { code: 'UNKNOWN', message: 'Local path outside home directory is not allowed' }
    }
    const info = await stat(resolvedParent)
    if (!info.isDirectory()) {
      throw { code: 'UNKNOWN', message: `Parent is not a directory: ${resolvedParent}` }
    }
    return absolute
  }
}
