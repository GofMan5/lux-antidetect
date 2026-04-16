/**
 * Browser Manager — downloads, installs, lists, and removes managed browsers.
 * Uses @puppeteer/browsers under the hood for Chrome/Chromium/Firefox downloads.
 */
import {
  install,
  resolveBuildId,
  computeExecutablePath,
  getInstalledBrowsers,
  uninstall,
  canDownload,
  detectBrowserPlatform,
  Browser,
  Cache,
  type InstalledBrowser,
  type BrowserPlatform
} from '@puppeteer/browsers'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import type { BrowserWindow } from 'electron'
import type { BrowserType } from './models'

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface ManagedBrowser {
  browser: string        // 'chrome' | 'chromium' | 'firefox'
  buildId: string        // version / build id
  platform: string
  executablePath: string
  tags: string[]         // e.g. ['stable'] or ['latest']
}

export interface DownloadProgress {
  browser: string
  buildId: string
  downloadedBytes: number
  totalBytes: number
  percent: number
}

/* -------------------------------------------------------------------------- */
/*  Map our BrowserType to @puppeteer/browsers Browser enum                   */
/* -------------------------------------------------------------------------- */

const BROWSER_TYPE_MAP: Record<BrowserType, Browser> = {
  chromium: Browser.CHROME,    // Download branded Chrome (has full features)
  firefox: Browser.FIREFOX,
  edge: Browser.CHROME         // Edge not available — fallback to Chrome
}


/* -------------------------------------------------------------------------- */
/*  State                                                                     */
/* -------------------------------------------------------------------------- */

let browsersDir = ''
let mainWin: BrowserWindow | null = null
const activeDownloads = new Map<string, { abort: AbortController }>()

export function initBrowserManager(dataPath: string, win: BrowserWindow): void {
  browsersDir = join(dataPath, 'browsers')
  if (!existsSync(browsersDir)) {
    mkdirSync(browsersDir, { recursive: true })
  }
  mainWin = win
}

export function setMainWindow(win: BrowserWindow): void {
  mainWin = win
}

export function getBrowsersDir(): string {
  return browsersDir
}

function getPlatform(): BrowserPlatform {
  const p = detectBrowserPlatform()
  if (!p) throw new Error('Unsupported platform for browser downloads')
  return p
}

/* -------------------------------------------------------------------------- */
/*  Resolve available versions                                                */
/* -------------------------------------------------------------------------- */

export async function resolveLatestVersion(
  browserType: BrowserType,
  channel: string = 'stable'
): Promise<{ browser: Browser; buildId: string; platform: string }> {
  const platform = getPlatform()
  const browser = BROWSER_TYPE_MAP[browserType]

  // For firefox 'stable' tag works; for chrome 'stable' also works
  const tag = channel === 'latest' ? 'latest' : channel
  const buildId = await resolveBuildId(browser, platform, tag)

  return { browser, buildId, platform }
}

/* -------------------------------------------------------------------------- */
/*  Download a browser                                                        */
/* -------------------------------------------------------------------------- */

export async function downloadBrowser(
  browserType: BrowserType,
  channel: string = 'stable'
): Promise<ManagedBrowser> {
  if (!browsersDir) throw new Error('Browser manager not initialized')

  const { browser, buildId, platform } = await resolveLatestVersion(browserType, channel)

  // Check if already installed
  const exePath = computeExecutablePath({ cacheDir: browsersDir, browser, buildId })
  if (existsSync(exePath)) {
    return {
      browser: browser as string,
      buildId,
      platform,
      executablePath: exePath,
      tags: [channel]
    }
  }

  // Check if downloadable
  const available = await canDownload({ cacheDir: browsersDir, browser, buildId })
  if (!available) {
    throw new Error(`Cannot download ${browserType} (${buildId}) for platform ${platform}`)
  }

  const dlKey = `${browser}-${buildId}`
  const abort = new AbortController()
  activeDownloads.set(dlKey, { abort })

  try {
    const installed = await install({
      cacheDir: browsersDir,
      browser,
      buildId,
      downloadProgressCallback: (downloadedBytes: number, totalBytes: number) => {
        const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
        const progress: DownloadProgress = {
          browser: browser as string,
          buildId,
          downloadedBytes,
          totalBytes,
          percent
        }
        mainWin?.webContents.send('browser-download:progress', progress)
      }
    })

    const result: ManagedBrowser = {
      browser: installed.browser as string,
      buildId: installed.buildId,
      platform: installed.platform ?? platform,
      executablePath: installed.executablePath,
      tags: [channel]
    }

    mainWin?.webContents.send('browser-download:complete', result)
    return result
  } catch (err) {
    mainWin?.webContents.send('browser-download:error', {
      browser: browser as string,
      buildId,
      message: err instanceof Error ? err.message : 'Download failed'
    })
    throw err
  } finally {
    activeDownloads.delete(dlKey)
  }
}

/* -------------------------------------------------------------------------- */
/*  List installed managed browsers                                           */
/* -------------------------------------------------------------------------- */

export async function listManagedBrowsers(): Promise<ManagedBrowser[]> {
  if (!browsersDir || !existsSync(browsersDir)) return []

  const installed = await getInstalledBrowsers({ cacheDir: browsersDir })
  return installed.map((b: InstalledBrowser) => ({
    browser: b.browser as string,
    buildId: b.buildId,
    platform: b.platform ?? getPlatform(),
    executablePath: b.executablePath,
    tags: []
  }))
}

/* -------------------------------------------------------------------------- */
/*  Remove an installed managed browser                                       */
/* -------------------------------------------------------------------------- */

export async function removeManagedBrowser(browser: string, buildId: string): Promise<void> {
  if (!browsersDir) throw new Error('Browser manager not initialized')
  const platform = getPlatform()
  await uninstall({
    cacheDir: browsersDir,
    browser: browser as Browser,
    buildId,
    platform: platform as BrowserPlatform
  })
}

/* -------------------------------------------------------------------------- */
/*  Get exe path for a managed browser (if installed)                         */
/* -------------------------------------------------------------------------- */

export function getManagedBrowserPath(browserType: BrowserType): string | null {
  if (!browsersDir) return null

  const browser = BROWSER_TYPE_MAP[browserType]
  try {
    const installed = getInstalledBrowsersSync()
    // Find best match — prefer newer builds (they sort DESC by buildId naturally)
    const match = installed.find(b => b.browser === browser)
    if (match) return match.executablePath
  } catch { /* ignore */ }
  return null
}

/** Synchronous wrapper — reads cache directory */
function getInstalledBrowsersSync(): InstalledBrowser[] {
  if (!browsersDir || !existsSync(browsersDir)) return []
  try {
    const cache = new Cache(browsersDir)
    return cache.getInstalledBrowsers()
  } catch { return [] }
}

/* -------------------------------------------------------------------------- */
/*  Cancel an active download                                                 */
/* -------------------------------------------------------------------------- */

export function cancelDownload(browser: string, buildId: string): boolean {
  const key = `${browser}-${buildId}`
  const dl = activeDownloads.get(key)
  if (dl) {
    dl.abort.abort()
    activeDownloads.delete(key)
    return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*  Detect which browsers we can download                                     */
/* -------------------------------------------------------------------------- */

export async function getAvailableBrowsers(): Promise<
  { browserType: BrowserType; browser: string; channel: string; buildId: string }[]
> {
  const platform = getPlatform()
  const results: { browserType: BrowserType; browser: string; channel: string; buildId: string }[] = []

  for (const [luxType, puppetBrowser] of Object.entries(BROWSER_TYPE_MAP) as [BrowserType, Browser][]) {
    if (luxType === 'edge') continue // Skip edge — maps to chrome anyway
    try {
      const buildId = await resolveBuildId(puppetBrowser, platform, 'stable')
      results.push({
        browserType: luxType,
        browser: puppetBrowser as string,
        channel: 'stable',
        buildId
      })
    } catch { /* unavailable for this platform */ }
  }

  return results
}
