import type Database from 'better-sqlite3'
import type { FraudRisk, Proxy } from './models'
import { httpGetThroughProxy } from './proxy'

// ---------------------------------------------------------------------------
// Provider (ip-api.com — free, HTTP-only, no key, ~45 req/min per IP)
// ---------------------------------------------------------------------------

const GEO_PROVIDER_HOST = 'ip-api.com'
const GEO_PROVIDER_PORT = 80
// Fields requested in one call:
//   geo:    country, countryCode, city, timezone, lat, lon
//   ident:  isp, org, as (ASN string), asname
//   fraud:  proxy (known VPN/proxy IP), hosting (datacenter ASN),
//           mobile (carrier IP — generally clean)
const GEO_PROVIDER_PATH =
  '/json/?fields=status,message,country,countryCode,city,timezone,lat,lon,query,isp,org,as,asname,proxy,hosting,mobile'
const GEO_TIMEOUT_MS = 10_000
const GEO_DEFAULT_ACCURACY_RADIUS_METERS = 25_000
const GEO_FALLBACK_LOCALE = 'en-US'

// Derived from countryCode. ip-api's free tier does not return `languages`.
const COUNTRY_TO_LOCALE: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', DE: 'de-DE', FR: 'fr-FR', JP: 'ja-JP',
  RU: 'ru-RU', CN: 'zh-CN', BR: 'pt-BR', ES: 'es-ES', IT: 'it-IT',
  PL: 'pl-PL', UA: 'uk-UA', NL: 'nl-NL', TR: 'tr-TR', KR: 'ko-KR',
  SE: 'sv-SE', NO: 'nb-NO', FI: 'fi-FI', DK: 'da-DK', CZ: 'cs-CZ',
  AT: 'de-AT', CH: 'de-CH', BE: 'nl-BE', IE: 'en-IE', AU: 'en-AU',
  CA: 'en-CA', NZ: 'en-NZ', IN: 'en-IN', MX: 'es-MX', AR: 'es-AR',
  CL: 'es-CL', PE: 'es-PE', CO: 'es-CO', VN: 'vi-VN', TH: 'th-TH',
  ID: 'id-ID', PH: 'en-PH', MY: 'ms-MY', SG: 'en-SG', HK: 'zh-HK',
  TW: 'zh-TW', IL: 'he-IL', AE: 'ar-AE', SA: 'ar-SA', EG: 'ar-EG',
  ZA: 'en-ZA', NG: 'en-NG', KE: 'en-KE', RO: 'ro-RO', GR: 'el-GR',
  HU: 'hu-HU', BG: 'bg-BG', HR: 'hr-HR', RS: 'sr-RS', LT: 'lt-LT',
  LV: 'lv-LV', EE: 'et-EE', SK: 'sk-SK', SI: 'sl-SI', PT: 'pt-PT',
  IS: 'is-IS', PK: 'ur-PK', BD: 'bn-BD'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxyGeoBundle {
  country: string | null
  country_code: string | null
  city: string | null
  timezone: string | null
  latitude: number | null
  longitude: number | null
  accuracy_radius: number | null
  locale: string | null
  // Fraud reputation block — returned in the same call so a single
  // ip-api request populates both surfaces (rate-limited at 45 req/min).
  isp: string | null
  org: string | null
  asn: string | null
  is_proxy_detected: boolean | null
  is_hosting: boolean | null
  is_mobile: boolean | null
  fraud_risk: FraudRisk
}

interface IpApiResponse {
  status?: string
  message?: string
  country?: string
  countryCode?: string
  city?: string
  timezone?: string
  lat?: number
  lon?: number
  query?: string
  isp?: string
  org?: string
  as?: string
  asname?: string
  proxy?: boolean
  hosting?: boolean
  mobile?: boolean
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_COUNTRY_LEN = 80
const MAX_CITY_LEN = 80
const MAX_TIMEZONE_LEN = 64
const MAX_ISP_LEN = 120
const MAX_ASN_LEN = 64
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/

// Strip Unicode control + format characters (C0/C1 controls and bidi
// overrides like RLO / LRO / RLE / LRE / PDF / RLI / LRI / FSI / PDI).
// A hostile upstream proxy could MITM the plain-HTTP ip-api response
// (HTTPS is paid-tier only) and inject these to flip displayed text or
// wedge log lines. \p{C} with the /u flag covers Cc + Cf + Cs + Cn + Co.
const STRIP_INVISIBLE_RE = /\p{C}/gu

function sanitizeString(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0) return null
  const cleaned = v.replace(STRIP_INVISIBLE_RE, '')
  return cleaned.length > 0 ? cleaned.slice(0, max) : null
}

function sanitizeCountryCode(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const upper = v.slice(0, 2).toUpperCase()
  return COUNTRY_CODE_PATTERN.test(upper) ? upper : null
}

function sanitizeTimezone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_TIMEZONE_LEN) return null
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return v
  } catch {
    return null
  }
}

function sanitizeLocale(v: string | null): string | null {
  if (!v) return null
  return LOCALE_PATTERN.test(v) ? v : null
}

function localeForCountry(countryCode: string | null): string {
  if (!countryCode) return GEO_FALLBACK_LOCALE
  return COUNTRY_TO_LOCALE[countryCode.toUpperCase()] ?? GEO_FALLBACK_LOCALE
}

/**
 * Bucket ip-api's boolean signals into a single user-facing risk level.
 *
 * - `hosting=true` (datacenter / cloud / VPS provider ASN) → high. Google
 *   blocks search and login from datacenter IPs aggressively because every
 *   commercial scraper / bot farm rents from the same handful of clouds.
 * - `proxy=true` (IP appears in a known VPN / open-proxy list) → high.
 * - `mobile=true` (carrier IP) → low. Mobile pools rotate across many
 *   real users, are rarely listed as proxies, and Google trusts them.
 * - Otherwise → low (residential / business ISP — clean by default).
 *
 * Note: `low` is the default for "unflagged" rather than "verified clean"
 * because ip-api's free tier is best-effort. The badge in the UI is meant
 * as a coarse warning ("this IP will probably be blocked"), not a guarantee.
 */
function computeFraudRisk(parsed: IpApiResponse): FraudRisk {
  if (parsed.hosting === true || parsed.proxy === true) return 'high'
  // 'low' is reserved for responses where ip-api actually returned the
  // boolean signals. If all three flags are missing (partial response —
  // happens on rate-limit-near-cap or for IPv6 ranges ip-api lacks data
  // for) we report 'unknown' so the UI doesn't claim "verified clean"
  // with no underlying signal.
  if (
    typeof parsed.hosting === 'boolean' ||
    typeof parsed.proxy === 'boolean' ||
    typeof parsed.mobile === 'boolean'
  ) {
    return 'low'
  }
  return 'unknown'
}

function safeParseIpApiJson(body: string): IpApiResponse | null {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as IpApiResponse
  } catch {
    return null
  }
}

function boolFlag(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * Network half: send a single ip-api.com request *through the given proxy*
 * and parse the response into the bundle shape. No DB access.
 *
 * The lookup tunnels through the proxy for two reasons:
 *   1. ip-api returns geo for the *requesting* IP, which is the proxy's
 *      external IP (what we want to characterize) — not Lux's host machine.
 *   2. The Lux process never directly contacts ip-api, so the ip-api logs
 *      can't correlate the user's real machine with the proxies they own.
 *
 * Returns null on any failure (network, HTTP non-200, malformed JSON,
 * status:'fail'). Never throws.
 */
async function fetchProxyMetadata(proxy: Proxy): Promise<ProxyGeoBundle | null> {
  const resp = await httpGetThroughProxy(
    proxy,
    GEO_PROVIDER_HOST,
    GEO_PROVIDER_PORT,
    GEO_PROVIDER_PATH,
    GEO_TIMEOUT_MS
  )
  if (!resp || resp.status !== 200) return null

  const parsed = safeParseIpApiJson(resp.body)
  if (!parsed || parsed.status !== 'success') return null

  const countryCode = sanitizeCountryCode(parsed.countryCode)
  const lat = typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) ? parsed.lat : null
  const lon = typeof parsed.lon === 'number' && Number.isFinite(parsed.lon) ? parsed.lon : null
  const hasCoords = lat !== null && lon !== null
  const locale = sanitizeLocale(localeForCountry(countryCode))
  const asnString =
    sanitizeString(parsed.as, MAX_ASN_LEN) ?? sanitizeString(parsed.asname, MAX_ASN_LEN)

  return {
    country: sanitizeString(parsed.country, MAX_COUNTRY_LEN),
    country_code: countryCode,
    city: sanitizeString(parsed.city, MAX_CITY_LEN),
    timezone: sanitizeTimezone(parsed.timezone),
    latitude: lat,
    longitude: lon,
    accuracy_radius: hasCoords ? GEO_DEFAULT_ACCURACY_RADIUS_METERS : null,
    locale,
    isp: sanitizeString(parsed.isp, MAX_ISP_LEN),
    org: sanitizeString(parsed.org, MAX_ISP_LEN),
    asn: asnString,
    is_proxy_detected: boolFlag(parsed.proxy),
    is_hosting: boolFlag(parsed.hosting),
    is_mobile: boolFlag(parsed.mobile),
    fraud_risk: computeFraudRisk(parsed)
  }
}

/**
 * Lookup + persist for an existing proxy row. Reads the row, fetches via
 * `fetchProxyMetadata`, writes every resolved field back in one UPDATE
 * including `fraud_risk` and `last_fraud_check`.
 */
export async function lookupProxyGeo(
  db: Database.Database,
  proxyId: string
): Promise<ProxyGeoBundle | null> {
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as
    | Proxy
    | undefined
  if (!proxy) return null

  const bundle = await fetchProxyMetadata(proxy)
  if (!bundle) return null

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE proxies
        SET country = ?,
            timezone = ?,
            city = ?,
            latitude = ?,
            longitude = ?,
            accuracy_radius = ?,
            locale = ?,
            isp = ?,
            org = ?,
            asn = ?,
            is_proxy_detected = ?,
            is_hosting = ?,
            is_mobile = ?,
            fraud_risk = ?,
            last_fraud_check = ?
      WHERE id = ?`
  ).run(
    bundle.country_code,
    bundle.timezone,
    bundle.city,
    bundle.latitude,
    bundle.longitude,
    bundle.accuracy_radius,
    bundle.locale,
    bundle.isp,
    bundle.org,
    bundle.asn,
    bundle.is_proxy_detected === null ? null : bundle.is_proxy_detected ? 1 : 0,
    bundle.is_hosting === null ? null : bundle.is_hosting ? 1 : 0,
    bundle.is_mobile === null ? null : bundle.is_mobile ? 1 : 0,
    bundle.fraud_risk,
    now,
    proxyId
  )

  return bundle
}

/**
 * Dry-run reputation lookup — characterize an IP by tunneling through a
 * candidate proxy connection *without* writing the proxy to the DB. Used by
 * the bulk-import filter to skip risky proxies before persisting them.
 *
 * The input is a transient `Proxy`-shaped object (id is a synthetic uuid
 * that never reaches SQLite). All real network behavior is identical to
 * `lookupProxyGeo` — same provider, same timeout, same tunneling path.
 */
export async function dryRunProxyMetadata(input: {
  protocol: Proxy['protocol']
  host: string
  port: number
  username?: string | null
  password?: string | null
}): Promise<ProxyGeoBundle | null> {
  const transient: Proxy = {
    id: 'dry-run',
    name: '',
    protocol: input.protocol,
    host: input.host,
    port: input.port,
    username: input.username ?? null,
    password: input.password ?? null,
    last_check: null,
    check_ok: 0,
    check_latency_ms: null,
    check_error: null,
    country: null,
    group_tag: null,
    timezone: null,
    city: null,
    latitude: null,
    longitude: null,
    accuracy_radius: null,
    locale: null,
    isp: null,
    org: null,
    asn: null,
    is_proxy_detected: null,
    is_hosting: null,
    is_mobile: null,
    fraud_risk: null,
    last_fraud_check: null,
    created_at: ''
  }
  return fetchProxyMetadata(transient)
}
