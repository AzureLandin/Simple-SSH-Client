import { mkdir, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'

/** Write JSON via temp file + rename to avoid truncating on crash. */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, filePath)
}
