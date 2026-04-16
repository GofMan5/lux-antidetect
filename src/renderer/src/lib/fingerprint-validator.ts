// Pure, non-blocking consistency checks for a profile fingerprint.
// Run on every form change; UI decides how to present the result.

export type ValidationWarning = {
  field: string
  severity: 'warn' | 'info'
  message: string
}

// Shared profile-health vocabulary. Promoted out of ProfilesPage so the
// editor, the list row, and any future surfaces agree on the same enum.
export type HealthStatus = 'good' | 'warn' | 'bad' | 'unknown'

export interface HealthComputation {
  status: HealthStatus
  /**
   * Human-readable reasons behind the status, ordered warn-before-info
   * (warnings are expected to already be sorted by severity). When a proxy
   * check has failed, `PROXY_UNREACHABLE_REASON` is the first entry.
   * Deduped by message — identical reasons are not repeated.
   */
  reasons: string[]
}

/** Label surfaced to users when `proxyCheckStatus === 'failed'`. */
export const PROXY_UNREACHABLE_REASON = 'Proxy unreachable'

export interface ProfileHealthInput {
  warnings: ValidationWarning[]
  proxyCheckStatus: 'ok' | 'failed' | 'untested' | null | undefined
}

/**
 * Derive a single profile-health verdict from validator warnings and the
 * latest proxy-check status. Pure and synchronous: same inputs → same output.
 *
 * Mapping (preserves the historical ProfilesPage behavior):
 *   - `proxyCheckStatus === 'untested'` AND no warnings → `'unknown'`.
 *   - `proxyCheckStatus === 'failed'` OR any `warn`-severity warning → `'bad'`.
 *   - Any `info`-severity warning (and neither of the above) → `'warn'`.
 *   - Otherwise → `'good'`.
 */
export function computeProfileHealth(input: ProfileHealthInput): HealthComputation {
  const { warnings, proxyCheckStatus } = input
  const proxyFailed = proxyCheckStatus === 'failed'

  if (proxyCheckStatus === 'untested' && warnings.length === 0) {
    return { status: 'unknown', reasons: [] }
  }

  let status: HealthStatus
  if (proxyFailed || warnings.some((w) => w.severity === 'warn')) {
    status = 'bad'
  } else if (warnings.some((w) => w.severity === 'info')) {
    status = 'warn'
  } else {
    status = 'good'
  }

  const reasons: string[] = []
  const seen = new Set<string>()
  const pushReason = (message: string): void => {
    if (seen.has(message)) return
    seen.add(message)
    reasons.push(message)
  }
  if (proxyFailed) pushReason(PROXY_UNREACHABLE_REASON)
  for (const w of warnings) pushReason(w.message)

  return { status, reasons }
}

export interface ProfileValidatorInput {
  user_agent: string
  platform: string
  timezone: string
  /** Comma-separated language tags, as stored in the editor form (e.g. "en-US, en"). */
  languages: string
  /** "WIDTHxHEIGHT" as stored in the editor form (e.g. "1920x1080"). */
  screen: string
  hardware_concurrency: number
  device_memory: number
  webgl_vendor: string
  /** ISO-3166 alpha-2 country code of the attached proxy, if known. */
  proxyCountryCode: string | null
}

// Coarse mapping: ISO-2 → acceptable IANA timezone prefixes.
// An exact match ("Europe/London") or a prefix match ("Europe/") both count.
// Unknown countries are silently skipped.
const COUNTRY_TO_TZ_PREFIX: Record<string, readonly string[]> = {
  US: ['America/', 'Pacific/Honolulu'],
  CA: ['America/'],
  MX: ['America/'],
  BR: ['America/'],
  AR: ['America/'],
  GB: ['Europe/London'],
  DE: ['Europe/'],
  FR: ['Europe/'],
  IT: ['Europe/'],
  ES: ['Europe/'],
  NL: ['Europe/'],
  PL: ['Europe/'],
  SE: ['Europe/'],
  CH: ['Europe/'],
  RU: ['Europe/', 'Asia/'],
  UA: ['Europe/'],
  JP: ['Asia/Tokyo'],
  CN: ['Asia/Shanghai', 'Asia/Urumqi'],
  KR: ['Asia/Seoul'],
  IN: ['Asia/Kolkata'],
  SG: ['Asia/Singapore'],
  AE: ['Asia/Dubai'],
  AU: ['Australia/'],
  NZ: ['Pacific/Auckland'],
  ZA: ['Africa/']
}

// Primary language codes typical for each country.
const COUNTRY_TO_LANG: Record<string, readonly string[]> = {
  US: ['en'],
  CA: ['en', 'fr'],
  GB: ['en'],
  AU: ['en'],
  NZ: ['en'],
  IE: ['en'],
  DE: ['de'],
  AT: ['de'],
  CH: ['de', 'fr', 'it'],
  FR: ['fr'],
  IT: ['it'],
  ES: ['es'],
  NL: ['nl'],
  PL: ['pl'],
  SE: ['sv'],
  RU: ['ru'],
  UA: ['uk', 'ru'],
  JP: ['ja'],
  CN: ['zh'],
  KR: ['ko'],
  IN: ['en', 'hi'],
  BR: ['pt'],
  MX: ['es'],
  AR: ['es'],
  ZA: ['en', 'af'],
  AE: ['ar', 'en'],
  SG: ['en', 'zh']
}

const COMMON_RESOLUTIONS: ReadonlySet<string> = new Set([
  '1280x720',
  '1366x768',
  '1440x900',
  '1536x864',
  '1600x900',
  '1680x1050',
  '1920x1080',
  '2560x1440',
  '3840x2160'
])

const MAX_WARNINGS = 5

export function validateProfileFingerprint(
  input: ProfileValidatorInput
): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  const ua = input.user_agent.toLowerCase()
  const plat = input.platform.toLowerCase()
  const cc = input.proxyCountryCode?.toUpperCase() ?? null

  // 1. Platform ↔ User-Agent
  if (ua) {
    if (ua.includes('windows') && !plat.includes('win')) {
      warnings.push({
        field: 'platform',
        severity: 'warn',
        message: 'User-Agent says Windows but platform is not Win32.'
      })
    } else if (
      (ua.includes('macintosh') || ua.includes('mac os')) &&
      !plat.includes('mac')
    ) {
      warnings.push({
        field: 'platform',
        severity: 'warn',
        message: 'User-Agent says macOS but platform is not MacIntel.'
      })
    } else if (
      ua.includes('linux') &&
      !ua.includes('android') &&
      plat &&
      !plat.includes('linux')
    ) {
      warnings.push({
        field: 'platform',
        severity: 'warn',
        message: 'User-Agent says Linux but platform does not match.'
      })
    }
  }

  // 2. Timezone ↔ proxy country
  if (cc && input.timezone) {
    const expected = COUNTRY_TO_TZ_PREFIX[cc]
    if (
      expected &&
      !expected.some(
        (pref) => input.timezone === pref || input.timezone.startsWith(pref)
      )
    ) {
      warnings.push({
        field: 'timezone',
        severity: 'warn',
        message: `Timezone "${input.timezone}" doesn't match proxy country ${cc}.`
      })
    }
  }

  // 3. Languages ↔ proxy country
  const langs = input.languages
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (langs.length === 0) {
    warnings.push({
      field: 'languages',
      severity: 'warn',
      message: 'Languages list is empty.'
    })
  } else if (cc) {
    const expected = COUNTRY_TO_LANG[cc]
    const primary = (langs[0].split('-')[0] || '').toLowerCase()
    if (expected && primary && !expected.includes(primary)) {
      warnings.push({
        field: 'languages',
        severity: 'warn',
        message: `Primary language "${langs[0]}" is unusual for proxy country ${cc}.`
      })
    }
  }

  // 4. Screen resolution sanity
  if (input.screen) {
    const parts = input.screen.split('x').map((n) => Number(n))
    if (parts.length !== 2) {
      // Skip: malformed resolution string.
    } else {
    const [w, h] = parts
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 800 || h < 600) {
      warnings.push({
        field: 'screen',
        severity: 'info',
        message: `Resolution ${input.screen} is unusually small.`
      })
    } else if (!COMMON_RESOLUTIONS.has(`${w}x${h}`)) {
      warnings.push({
        field: 'screen',
        severity: 'info',
        message: `Resolution ${input.screen} is uncommon for real devices.`
      })
    }
    }
  }

  // 5. Hardware realism
  if (input.hardware_concurrency > 32) {
    warnings.push({
      field: 'hardware_concurrency',
      severity: 'warn',
      message: `${input.hardware_concurrency} CPU cores is unrealistic for consumer hardware.`
    })
  }
  if (input.device_memory > 64) {
    warnings.push({
      field: 'device_memory',
      severity: 'warn',
      message: `${input.device_memory} GB RAM is unrealistic for consumer hardware.`
    })
  }

  // 6. WebGL vendor ↔ platform
  if (
    input.webgl_vendor &&
    input.webgl_vendor.toLowerCase().includes('apple') &&
    plat.includes('win')
  ) {
    warnings.push({
      field: 'webgl_vendor',
      severity: 'warn',
      message: 'WebGL vendor is Apple but platform is Windows.'
    })
  }

  // Warn first, info after; then dedupe by field; cap at MAX_WARNINGS.
  const sorted = [...warnings].sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'warn' ? -1 : 1
  })

  const seen = new Set<string>()
  const deduped: ValidationWarning[] = []
  for (const w of sorted) {
    if (seen.has(w.field)) continue
    seen.add(w.field)
    deduped.push(w)
    if (deduped.length >= MAX_WARNINGS) break
  }
  return deduped
}
