import { app, shell } from 'electron'
import { existsSync } from 'fs'
import { dirname, join } from 'path'

export interface McpServerInfo {
  available: boolean
  command: string
  args: string[]
  serverPath: string
  packagePath: string
  readmePath: string
  installHint: string
}

function firstExisting(paths: string[]): string {
  return paths.find((p) => existsSync(p)) ?? paths[0]
}

function getMcpRootCandidates(): string[] {
  if (app.isPackaged) {
    return [join(process.resourcesPath, 'mcp-server')]
  }

  const appPath = app.getAppPath()
  return [
    join(appPath, 'mcp-server'),
    join(process.cwd(), 'mcp-server'),
    join(__dirname, '../../mcp-server')
  ]
}

export function getMcpServerInfo(): McpServerInfo {
  const root = firstExisting(getMcpRootCandidates())
  const serverPath = join(root, 'dist', 'index.js')
  const packagePath = join(root, 'package.json')
  const readmePath = join(root, 'README.md')

  return {
    available: existsSync(serverPath),
    command: 'node',
    args: [serverPath],
    serverPath,
    packagePath,
    readmePath,
    installHint: 'Run npm run build. The app build compiles and packages the MCP bridge.'
  }
}

export function revealMcpServer(): void {
  const info = getMcpServerInfo()
  if (existsSync(info.serverPath)) {
    shell.showItemInFolder(info.serverPath)
    return
  }

  const fallbackDir = existsSync(dirname(info.serverPath)) ? dirname(info.serverPath) : dirname(dirname(info.serverPath))
  void shell.openPath(fallbackDir)
}
