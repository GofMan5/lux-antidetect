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

// Default target per BrowserType. We deliberately prefer upstream Chromium
// snapshots over Chrome for Testing: CfT builds carry "Chrome for Testing"
// branding in chrome://version, window title, and occasionally show an
// infobar stating the build is intended for developer/test use. Chromium
// snapshots are clean upstream builds with no such branding.
//
// `downloadBrowser()` still accepts a `browser` override so users can opt
// into Chrome for Testing when they need Widevine / Google services.
const BROWSER_TYPE_MAP: Record<BrowserType, Browser> = {
  chromium: Browser.CHROMIUM,
  firefox: Browser.FIREFOX,
  edge: Browser.CHROMIUM // edge binary itself isn't hosted — fall through to Chromium
}

/** Per-browser channels understood by `resolveBuildId` in @puppeteer/browsers. */
function channelsFor(browser: Browser): string[] {
  if (browser === Browser.CHROME) return ['stable', 'beta', 'dev', 'canary']
  if (browser === Browser.FIREFOX) return ['stable', 'beta', 'nightly', 'esr']
  // Chromium snapshots roll continuously; only a single "latest" tag exists.
  if (browser === Browser.CHROMIUM) return ['latest']
  return ['stable']
}

/** Human-readable label for a browser enum value. */
function browserLabel(browser: Browser): string {
  if (browser === Browser.CHROMIUM) return 'Chromium'
  if (browser === Browser.CHROME) return 'Chrome for Testing'
  if (browser === Browser.FIREFOX) return 'Firefox'
  return String(browser)
}

const REMOVABLE_BROWSERS = new Set<Browser>([Browser.CHROMIUM, Browser.CHROME, Browser.FIREFOX])

function validateRemovableBrowser(rawBrowser: string): Browser {
  if (typeof rawBrowser !== 'string') throw new Error('Unsupported managed browser')
  if (REMOVABLE_BROWSERS.has(rawBrowser as Browser)) return rawBrowser as Browser
  throw new Error('Unsupported managed browser')
}

function validateBuildIdSegment(rawBuildId: string): string {
  if (
    typeof rawBuildId !== 'string' ||
    !rawBuildId ||
    rawBuildId === '.' ||
    rawBuildId === '..' ||
    rawBuildId.includes('/') ||
    rawBuildId.includes('\\') ||
    !/^[A-Za-z0-9._+-]+$/.test(rawBuildId)
  ) {
    throw new Error('Invalid browser buildId')
  }
  return rawBuildId
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
  channel: string = 'stable',
  browserOverride?: string
): Promise<{ browser: Browser; buildId: string; platform: string }> {
  const platform = getPlatform()
  const browser = (browserOverride as Browser | undefined) ?? BROWSER_TYPE_MAP[browserType]
  // Chromium uses "latest" as the only tag; other browsers use channels.
  const tag = browser === Browser.CHROMIUM ? 'latest' : channel
  const buildId = await resolveBuildId(browser, platform, tag)
  return { browser, buildId, platform }
}

/* -------------------------------------------------------------------------- */
/*  Download a browser                                                        */
/* -------------------------------------------------------------------------- */

export async function downloadBrowser(
  browserType: BrowserType,
  channel: string = 'stable',
  browserOverride?: string,
  buildIdOverride?: string
): Promise<ManagedBrowser> {
  if (!browsersDir) throw new Error('Browser manager not initialized')

  let resolved: { browser: Browser; buildId: string; platform: string }
  if (buildIdOverride) {
    const platform = getPlatform()
    const browser = (browserOverride as Browser | undefined) ?? BROWSER_TYPE_MAP[browserType]
    resolved = { browser, buildId: buildIdOverride, platform }
  } else {
    resolved = await resolveLatestVersion(browserType, channel, browserOverride)
  }
  const { browser, buildId, platform } = resolved

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
  const validatedBrowser = validateRemovableBrowser(browser)
  const validatedBuildId = validateBuildIdSegment(buildId)
  await uninstall({
    cacheDir: browsersDir,
    browser: validatedBrowser,
    buildId: validatedBuildId,
    platform: platform as BrowserPlatform
  })
}

/* -------------------------------------------------------------------------- */
/*  Get exe path for a managed browser (if installed)                         */
/* -------------------------------------------------------------------------- */

export function getManagedBrowserPath(browserType: BrowserType): string | null {
  if (!browsersDir) return null

  try {
    const installed = getInstalledBrowsersSync()
    // Chromium-family: accept either upstream Chromium (preferred, no CfT
    // branding) or Chrome for Testing if the user explicitly downloaded it.
    if (browserType === 'chromium' || browserType === 'edge') {
      const chromium = installed.find((b) => b.browser === Browser.CHROMIUM)
      if (chromium) return chromium.executablePath
      const chrome = installed.find((b) => b.browser === Browser.CHROME)
      if (chrome) return chrome.executablePath
      return null
    }
    if (browserType === 'firefox') {
      const firefox = installed.find((b) => b.browser === Browser.FIREFOX)
      if (firefox) return firefox.executablePath
      return null
    }
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
  { browserType: BrowserType; browser: string; channel: string; buildId: string; label: string }[]
> {
  const platform = getPlatform()
  const results: {
    browserType: BrowserType
    browser: string
    channel: string
    buildId: string
    label: string
  }[] = []

  // Build a download list across every (browser, channel) pair we support.
  // Each BrowserType also offers Chrome for Testing alongside its default
  // (Chromium) so users who need full Google Chrome features can choose it.
  const plan: { browserType: BrowserType; browser: Browser }[] = [
    { browserType: 'chromium', browser: Browser.CHROMIUM },
    { browserType: 'chromium', browser: Browser.CHROME },
    { browserType: 'firefox', browser: Browser.FIREFOX }
  ]

  await Promise.all(
    plan.map(async (entry) => {
      for (const channel of channelsFor(entry.browser)) {
        try {
          const buildId = await resolveBuildId(entry.browser, platform, channel)
          results.push({
            browserType: entry.browserType,
            browser: entry.browser as string,
            channel,
            buildId,
            label: browserLabel(entry.browser)
          })
        } catch { /* channel unavailable for this platform */ }
      }
    })
  )

  return results
}
