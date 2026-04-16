import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import extract from 'extract-zip'

const CRX_MAGIC = Buffer.from('Cr24', 'ascii')
const CRX_V2_MIN_HEADER = 16
const CRX_V3_MIN_HEADER = 12
const MAX_CRX_BYTES = 50 * 1024 * 1024 // 50 MB input
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024 // 200 MB unpacked

async function directorySize(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(full)
    } else if (entry.isFile()) {
      const st = await fs.stat(full)
      total += st.size
      if (total > MAX_UNPACKED_BYTES) return total
    }
  }
  return total
}

export interface InstalledCrx {
  extensionDir: string
  extensionName: string
  extensionId: string | null
}

function readUInt32LESafe(buf: Buffer, offset: number): number {
  if (offset + 4 > buf.length) {
    throw new Error('CRX file truncated')
  }
  return buf.readUInt32LE(offset)
}

function computeZipOffset(buf: Buffer): number {
  const version = readUInt32LESafe(buf, 4)
  if (version === 2) {
    if (buf.length < CRX_V2_MIN_HEADER) throw new Error('CRX v2 header truncated')
    const pubKeyLen = readUInt32LESafe(buf, 8)
    const sigLen = readUInt32LESafe(buf, 12)
    const offset = CRX_V2_MIN_HEADER + pubKeyLen + sigLen
    if (offset > buf.length) throw new Error('CRX v2 offsets exceed file size')
    return offset
  }
  if (version === 3) {
    if (buf.length < CRX_V3_MIN_HEADER) throw new Error('CRX v3 header truncated')
    const headerLen = readUInt32LESafe(buf, 8)
    const offset = CRX_V3_MIN_HEADER + headerLen
    if (offset > buf.length) throw new Error('CRX v3 header length exceeds file size')
    return offset
  }
  throw new Error(`Unsupported CRX version: ${version}`)
}

async function readManifestName(extDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(extDir, 'manifest.json'), 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown }
    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      // Chrome extensions can use __MSG_name__ placeholders. Keep raw string
      // if we can't resolve — caller falls back to filename basename.
      const name = parsed.name.trim()
      if (name.startsWith('__MSG_')) return null
      return name
    }
    return null
  } catch {
    return null
  }
}

export async function installCrxIntoProfile(
  crxFilePath: string,
  profileId: string,
  profilesDir: string
): Promise<InstalledCrx> {
  if (!crxFilePath || typeof crxFilePath !== 'string') {
    throw new Error('Invalid CRX path')
  }
  if (!profileId || typeof profileId !== 'string') {
    throw new Error('Invalid profile ID')
  }

  let buf: Buffer
  try {
    buf = await fs.readFile(crxFilePath)
  } catch (err) {
    throw new Error(`Failed to read CRX file: ${(err as Error).message}`)
  }

  if (buf.length > MAX_CRX_BYTES) {
    throw new Error(`CRX file too large (max ${MAX_CRX_BYTES} bytes)`)
  }

  if (buf.length < 8 || !buf.subarray(0, 4).equals(CRX_MAGIC)) {
    throw new Error('Not a valid CRX file')
  }

  const zipOffset = computeZipOffset(buf)
  const zipBytes = buf.subarray(zipOffset)
  if (zipBytes.length === 0) {
    throw new Error('CRX contains no ZIP payload')
  }

  const tempZipPath = path.join(os.tmpdir(), `lux-crx-${randomUUID()}.zip`)
  const extDirName = `__ext_${randomUUID()}`
  const extensionDir = path.join(profilesDir, profileId, extDirName)

  try {
    await fs.writeFile(tempZipPath, zipBytes)
    try {
      await fs.mkdir(extensionDir, { recursive: true })
      try {
        await extract(tempZipPath, { dir: extensionDir })
      } catch (err) {
        throw new Error(`Failed to unpack CRX archive: ${(err as Error).message}`)
      }
      const unpackedSize = await directorySize(extensionDir)
      if (unpackedSize > MAX_UNPACKED_BYTES) {
        throw new Error(`Unpacked CRX exceeds size limit (max ${MAX_UNPACKED_BYTES} bytes)`)
      }
    } catch (err) {
      await fs.rm(extensionDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  } finally {
    fs.unlink(tempZipPath).catch(() => {})
  }

  const manifestName = await readManifestName(extensionDir)
  const fallbackName = path.basename(crxFilePath, path.extname(crxFilePath))
  const extensionName = manifestName ?? fallbackName

  return {
    extensionDir,
    extensionName,
    extensionId: null
  }
}
