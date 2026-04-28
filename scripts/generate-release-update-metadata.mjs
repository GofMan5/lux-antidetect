/* eslint-disable @typescript-eslint/explicit-function-return-type */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'release-artifacts')
const version = (process.env.GITHUB_REF_NAME ?? '').replace(/^v/, '')
if (!version) {
  throw new Error('GITHUB_REF_NAME is required to generate updater metadata')
}

const product = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function walkFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else files.push(full)
  }
  return files
}

const allFiles = walkFiles(root)

function findOne(pattern, label) {
  const matches = allFiles.filter((file) => pattern.test(path.basename(file)))
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${matches.length}: ${matches.join(', ')}`)
  }
  return matches[0]
}

function fileInfo(file) {
  const bytes = fs.readFileSync(file)
  return {
    url: path.basename(file),
    sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
    size: bytes.length
  }
}

function writeYaml(fileName, files) {
  const primary = files[0]
  const lines = [
    `version: ${version}`,
    'files:',
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    ]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ]
  fs.writeFileSync(path.join(root, fileName), lines.join('\n'))
  console.log(`Generated ${fileName}: ${files.map((file) => file.url).join(', ')}`)
}

const escapedProduct = escapeRegExp(product)
const escapedVersion = escapeRegExp(version)

function artifact(archAliases, ext, label) {
  const aliases = Array.isArray(archAliases) ? archAliases : [archAliases]
  const escapedAliases = aliases.map(escapeRegExp).join('|')
  const escapedExt = escapeRegExp(ext)
  return fileInfo(
    findOne(
      new RegExp(`^${escapedProduct}-${escapedVersion}-(${escapedAliases})\\.${escapedExt}$`),
      label ?? `${aliases.join('/')} ${ext}`
    )
  )
}

writeYaml('latest.yml', [
  fileInfo(findOne(new RegExp(`^${escapedProduct}-${escapedVersion}-x64-setup\\.exe$`), 'Windows x64 installer')),
  fileInfo(findOne(new RegExp(`^${escapedProduct}-${escapedVersion}-arm64-setup\\.exe$`), 'Windows arm64 installer'))
])

writeYaml('latest-mac.yml', [
  artifact('x64', 'zip', 'macOS x64 ZIP'),
  artifact('arm64', 'zip', 'macOS arm64 ZIP')
])

writeYaml('latest-linux.yml', [
  artifact(['x64', 'x86_64'], 'AppImage', 'Linux x64 AppImage'),
  artifact(['x64', 'amd64'], 'deb', 'Linux x64 deb'),
  artifact(['x64', 'x86_64'], 'rpm', 'Linux x64 rpm'),
  artifact('x64', 'tar.gz', 'Linux x64 tarball')
])

writeYaml('latest-linux-arm64.yml', [
  artifact('arm64', 'AppImage', 'Linux arm64 AppImage'),
  artifact('arm64', 'deb', 'Linux arm64 deb'),
  artifact(['arm64', 'aarch64'], 'rpm', 'Linux arm64 rpm'),
  artifact('arm64', 'tar.gz', 'Linux arm64 tarball')
])
