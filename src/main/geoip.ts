import type Database from 'better-sqlite3'
import type { FraudRisk, Proxy } from './models'
import { httpGetThroughProxy, httpsGetThroughProxy, httpGetDirect, httpsGetDirect } from './proxy'

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
//
// Two free providers queried in parallel for every reputation lookup. Each
// independently inspects the apparent IP and reports a subset of signals.
// Cross-checking eliminates false positives from any single provider's
// outdated lists, and sidesteps the plain-HTTP MITM attack on ip-api by
// having ipapi.is corroborate (or contradict) the verdict over TLS.
//
//   ip-api.com   HTTP only on free tier, 45 req/min/IP. Returns geo +
//                proxy / hosting / mobile booleans + ISP / ORG / ASN string.
//   ipapi.is     HTTPS only, ~1k req/day per source IP. Returns
//                is_datacenter / is_vpn / is_proxy / is_tor / is_abuser
//                + abuser_score (0..1) + ASN type ('isp' / 'hosting' / etc).
//
// Both endpoints support two query shapes:
//   tunneled — call from inside the proxy with empty `q`; provider
//              characterizes the proxy's external IP (no Lux-host leak).
//   direct   — call from Lux host with `q=<ip>`; used by the standalone
//              "check any IP" tool. Leaks Lux's host IP to the provider —
//              that's the documented tradeoff for arbitrary-IP investigation.

const IPAPI_HOST = 'ip-api.com'
const IPAPI_PORT = 80
const IPAPI_FIELDS = 'status,message,country,countryCode,city,timezone,lat,lon,query,isp,org,as,asname,proxy,hosting,mobile'

const IPAPI_IS_HOST = 'api.ipapi.is'

const FRAUD_PROBE_TIMEOUT_MS = 10_000
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
  // Fraud reputation block — populated by both providers when available.
  external_ip: string | null
  isp: string | null
  org: string | null
  asn: string | null
  asn_type: string | null
  is_proxy_detected: boolean | null
  is_hosting: boolean | null
  is_datacenter: boolean | null
  is_vpn: boolean | null
  is_tor: boolean | null
  is_abuser: boolean | null
  is_mobile: boolean | null
  abuse_score: number | null
  fraud_score: number
  fraud_risk: FraudRisk
  fraud_providers: string[]
}

// Standalone-IP-check shape. Same body as ProxyGeoBundle minus the
// proxy-tied geo override fields the renderer doesn't need for an
// ad-hoc IP investigation.
export interface IpFraudReport {
  ip: string
  external_ip: string | null
  country: string | null
  country_code: string | null
  city: string | null
  isp: string | null
  org: string | null
  asn: string | null
  asn_type: string | null
  is_proxy_detected: boolean | null
  is_hosting: boolean | null
  is_datacenter: boolean | null
  is_vpn: boolean | null
  is_tor: boolean | null
  is_abuser: boolean | null
  is_mobile: boolean | null
  abuse_score: number | null
  fraud_score: number
  fraud_risk: FraudRisk
  fraud_providers: string[]
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

// Subset of the ipapi.is response we care about.
interface IpapiIsResponse {
  ip?: string
  is_mobile?: boolean
  is_datacenter?: boolean
  is_tor?: boolean
  is_proxy?: boolean
  is_vpn?: boolean
  is_abuser?: boolean
  is_crawler?: boolean
  company?: {
    name?: string
    domain?: string
    type?: string
    abuser_score?: string
  }
  asn?: {
    asn?: number
    org?: string
    descr?: string
    type?: string
    abuser_score?: string
  }
  location?: {
    country?: string
    country_code?: string
    city?: string
    timezone?: string
    latitude?: number
    longitude?: number
  }
}

interface FraudSignal {
  provider: string
  external_ip: string | null
  country: string | null
  country_code: string | null
  city: string | null
  timezone: string | null
  latitude: number | null
  longitude: number | null
  isp: string | null
  org: string | null
  asn: string | null
  asn_type: string | null
  is_proxy_detected: boolean | null
  is_hosting: boolean | null
  is_datacenter: boolean | null
  is_vpn: boolean | null
  is_tor: boolean | null
  is_abuser: boolean | null
  is_mobile: boolean | null
  abuse_score: number | null
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

function safeParseJson<T>(body: string): T | null {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as T
  } catch {
    return null
  }
}

function boolFlag(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

// ipapi.is reports `abuser_score` as a string like "0.0034 (Very Low)" or
// "0.7651 (High)". Pull the leading float — null when absent or malformed.
function parseAbuserScore(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = s.match(/^([0-9]*\.?[0-9]+)/)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

// ─── Provider parsers ─────────────────────────────────────────────────────

function parseIpApi(body: string): FraudSignal | null {
  const parsed = safeParseJson<IpApiResponse>(body)
  if (!parsed || parsed.status !== 'success') return null
  const lat = typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) ? parsed.lat : null
  const lon = typeof parsed.lon === 'number' && Number.isFinite(parsed.lon) ? parsed.lon : null
  const asn =
    sanitizeString(parsed.as, MAX_ASN_LEN) ?? sanitizeString(parsed.asname, MAX_ASN_LEN)
  return {
    provider: 'ip-api',
    external_ip: sanitizeString(parsed.query, 64),
    country: sanitizeString(parsed.country, MAX_COUNTRY_LEN),
    country_code: sanitizeCountryCode(parsed.countryCode),
    city: sanitizeString(parsed.city, MAX_CITY_LEN),
    timezone: sanitizeTimezone(parsed.timezone),
    latitude: lat,
    longitude: lon,
    isp: sanitizeString(parsed.isp, MAX_ISP_LEN),
    org: sanitizeString(parsed.org, MAX_ISP_LEN),
    asn,
    asn_type: parsed.hosting === true ? 'datacenter' : parsed.mobile === true ? 'mobile' : null,
    is_proxy_detected: boolFlag(parsed.proxy),
    is_hosting: boolFlag(parsed.hosting),
    is_datacenter: boolFlag(parsed.hosting), // ip-api uses 'hosting' as datacenter signal
    is_vpn: null,    // ip-api doesn't differentiate vpn from proxy
    is_tor: null,    // ip-api doesn't expose this
    is_abuser: null, // ip-api doesn't expose this
    is_mobile: boolFlag(parsed.mobile),
    abuse_score: null
  }
}

function parseIpapiIs(body: string): FraudSignal | null {
  const parsed = safeParseJson<IpapiIsResponse>(body)
  if (!parsed || typeof parsed.ip !== 'string') return null
  const loc = parsed.location ?? {}
  const lat = typeof loc.latitude === 'number' && Number.isFinite(loc.latitude) ? loc.latitude : null
  const lon = typeof loc.longitude === 'number' && Number.isFinite(loc.longitude) ? loc.longitude : null
  // Pick the best abuse score across the company + asn entries.
  const companyAbuse = parseAbuserScore(parsed.company?.abuser_score)
  const asnAbuse = parseAbuserScore(parsed.asn?.abuser_score)
  const abuseScore =
    companyAbuse !== null && asnAbuse !== null
      ? Math.max(companyAbuse, asnAbuse)
      : (companyAbuse ?? asnAbuse)
  const asnType = sanitizeString(parsed.asn?.type ?? parsed.company?.type, 32)
  // ipapi.is asn.asn is a number — render as "AS<n>" + descr to keep parity
  // with ip-api's "AS15169 Google LLC" format used elsewhere in the UI.
  let asn: string | null = null
  const asNum = typeof parsed.asn?.asn === 'number' ? parsed.asn.asn : null
  const descr = sanitizeString(parsed.asn?.descr ?? parsed.asn?.org, MAX_ASN_LEN)
  if (asNum !== null) asn = descr ? `AS${asNum} ${descr}` : `AS${asNum}`
  else if (descr) asn = descr
  return {
    provider: 'ipapi.is',
    external_ip: sanitizeString(parsed.ip, 64),
    country: sanitizeString(loc.country, MAX_COUNTRY_LEN),
    country_code: sanitizeCountryCode(loc.country_code),
    city: sanitizeString(loc.city, MAX_CITY_LEN),
    timezone: sanitizeTimezone(loc.timezone),
    latitude: lat,
    longitude: lon,
    isp: sanitizeString(parsed.company?.name, MAX_ISP_LEN),
    org: sanitizeString(parsed.company?.name, MAX_ISP_LEN),
    asn: asn ? asn.slice(0, MAX_ASN_LEN) : null,
    asn_type: asnType,
    is_proxy_detected: boolFlag(parsed.is_proxy),
    is_hosting: boolFlag(parsed.is_datacenter),
    is_datacenter: boolFlag(parsed.is_datacenter),
    is_vpn: boolFlag(parsed.is_vpn),
    is_tor: boolFlag(parsed.is_tor),
    is_abuser: boolFlag(parsed.is_abuser),
    is_mobile: boolFlag(parsed.is_mobile),
    abuse_score: abuseScore
  }
}

// ─── Provider fetchers ────────────────────────────────────────────────────

type Transport =
  | { kind: 'proxy'; proxy: Proxy }
  | { kind: 'direct'; ip: string }

async function fetchIpApi(transport: Transport): Promise<FraudSignal | null> {
  if (transport.kind === 'proxy') {
    const path = `/json/?fields=${IPAPI_FIELDS}`
    const resp = await httpGetThroughProxy(
      transport.proxy,
      IPAPI_HOST,
      IPAPI_PORT,
      path,
      FRAUD_PROBE_TIMEOUT_MS
    )
    if (!resp || resp.status !== 200) return null
    return parseIpApi(resp.body)
  }
  // direct: query about a specific IP
  const path = `/json/${encodeURIComponent(transport.ip)}?fields=${IPAPI_FIELDS}`
  const resp = await httpGetDirect(IPAPI_HOST, IPAPI_PORT, path, FRAUD_PROBE_TIMEOUT_MS)
  if (!resp || resp.status !== 200) return null
  return parseIpApi(resp.body)
}

async function fetchIpapiIs(transport: Transport): Promise<FraudSignal | null> {
  if (transport.kind === 'proxy') {
    // Empty `q` → ipapi.is reports about the requester's IP (the proxy egress).
    const resp = await httpsGetThroughProxy(
      transport.proxy,
      IPAPI_IS_HOST,
      '/?q=',
      FRAUD_PROBE_TIMEOUT_MS
    )
    if (!resp || resp.status !== 200) return null
    return parseIpapiIs(resp.body)
  }
  // direct: query about a specific IP
  const path = `/?q=${encodeURIComponent(transport.ip)}`
  const resp = await httpsGetDirect(IPAPI_IS_HOST, path, FRAUD_PROBE_TIMEOUT_MS)
  if (!resp || resp.status !== 200) return null
  return parseIpapiIs(resp.body)
}

// ─── Ensemble scoring ─────────────────────────────────────────────────────
//
// Take all provider signals and produce one consensus + a 0-100 score.
// Any-flag wins for positive signals (one provider says VPN → consensus VPN);
// all-flag wins for the mobile credit (every provider must agree it's mobile
// before we trust the carrier-IP discount, since one provider mislabeling a
// datacenter as mobile would otherwise zero out the datacenter penalty).
//
// Score weights are tuned so the bucket boundaries land at intuitive points:
//   datacenter alone   ≈ 50  → high
//   vpn alone          ≈ 35  → medium
//   proxy-listed alone ≈ 30  → medium
//   tor                ≈ 80  → critical
//   abuser             ≈ 40  → medium-high
//   abuse_score (0-1)  ≈ ×50 → up to +50
//   mobile (consensus) → -20 floor
const FRAUD_BUCKET_BOUNDS: ReadonlyArray<readonly [number, FraudRisk]> = [
  [15, 'clean'],
  [30, 'low'],
  [55, 'medium'],
  [80, 'high'],
  [100, 'critical']
]

interface FraudVerdict {
  external_ip: string | null
  isp: string | null
  org: string | null
  asn: string | null
  asn_type: string | null
  is_proxy_detected: boolean | null
  is_hosting: boolean | null
  is_datacenter: boolean | null
  is_vpn: boolean | null
  is_tor: boolean | null
  is_abuser: boolean | null
  is_mobile: boolean | null
  abuse_score: number | null
  fraud_score: number
  fraud_risk: FraudRisk
  fraud_providers: string[]
  signals: FraudSignal[]
  // Geo block (best signal across providers) — only populated for proxy-mode.
  country: string | null
  country_code: string | null
  city: string | null
  timezone: string | null
  latitude: number | null
  longitude: number | null
}

function pickFirst<T>(signals: FraudSignal[], key: keyof FraudSignal): T | null {
  for (const s of signals) {
    const v = s[key]
    if (v !== null && v !== undefined) return v as T
  }
  return null
}

function consensusBool(signals: FraudSignal[], key: keyof FraudSignal): boolean | null {
  let any = false
  let saw = false
  for (const s of signals) {
    const v = s[key]
    if (typeof v === 'boolean') {
      saw = true
      if (v) any = true
    }
  }
  return saw ? any : null
}

function consensusAllTrue(signals: FraudSignal[], key: keyof FraudSignal): boolean | null {
  let saw = false
  for (const s of signals) {
    const v = s[key]
    if (typeof v !== 'boolean') return null // not enough info
    saw = true
    if (!v) return false
  }
  return saw ? true : null
}

function bucketForScore(score: number): FraudRisk {
  for (const [bound, bucket] of FRAUD_BUCKET_BOUNDS) {
    if (score <= bound) return bucket
  }
  return 'critical'
}

function combineSignals(signals: FraudSignal[]): FraudVerdict {
  if (signals.length === 0) {
    return {
      external_ip: null, isp: null, org: null, asn: null, asn_type: null,
      is_proxy_detected: null, is_hosting: null, is_datacenter: null,
      is_vpn: null, is_tor: null, is_abuser: null, is_mobile: null,
      abuse_score: null,
      fraud_score: 0,
      fraud_risk: 'unknown',
      fraud_providers: [],
      signals: [],
      country: null, country_code: null, city: null,
      timezone: null, latitude: null, longitude: null
    }
  }

  const isProxy = consensusBool(signals, 'is_proxy_detected')
  const isHosting = consensusBool(signals, 'is_hosting')
  const isDc = consensusBool(signals, 'is_datacenter')
  const isVpn = consensusBool(signals, 'is_vpn')
  const isTor = consensusBool(signals, 'is_tor')
  const isAbuser = consensusBool(signals, 'is_abuser')
  // Mobile is a *credit*, so require all-providers-agree before applying.
  // Otherwise a single provider mistagging a datacenter as mobile would
  // wipe the datacenter penalty.
  const isMobile = consensusAllTrue(signals, 'is_mobile')
  const abuseScores = signals.map((s) => s.abuse_score).filter((x): x is number => x !== null)
  const abuseScore = abuseScores.length > 0 ? Math.max(...abuseScores) : null

  let score = 0
  if (isTor === true) score += 80
  if (isDc === true || isHosting === true) score += 50
  if (isVpn === true) score += 35
  if (isProxy === true) score += 30
  if (isAbuser === true) score += 40
  if (abuseScore !== null) score += abuseScore * 50
  if (isMobile === true) score -= 20

  // Cap and clamp.
  score = Math.max(0, Math.min(100, Math.round(score)))

  // If NO provider returned ANY of the relevant signal fields the verdict is
  // 'unknown' — same shape as zero signals but we keep the geo data.
  const hasAnyRiskSignal = signals.some(
    (s) =>
      typeof s.is_proxy_detected === 'boolean' ||
      typeof s.is_datacenter === 'boolean' ||
      typeof s.is_hosting === 'boolean' ||
      typeof s.is_vpn === 'boolean' ||
      typeof s.is_tor === 'boolean' ||
      typeof s.is_abuser === 'boolean' ||
      typeof s.is_mobile === 'boolean' ||
      s.abuse_score !== null
  )

  return {
    external_ip: pickFirst<string>(signals, 'external_ip'),
    isp: pickFirst<string>(signals, 'isp'),
    org: pickFirst<string>(signals, 'org'),
    asn: pickFirst<string>(signals, 'asn'),
    asn_type: pickFirst<string>(signals, 'asn_type'),
    is_proxy_detected: isProxy,
    is_hosting: isHosting,
    is_datacenter: isDc,
    is_vpn: isVpn,
    is_tor: isTor,
    is_abuser: isAbuser,
    is_mobile: isMobile,
    abuse_score: abuseScore,
    fraud_score: hasAnyRiskSignal ? score : 0,
    fraud_risk: hasAnyRiskSignal ? bucketForScore(score) : 'unknown',
    fraud_providers: signals.map((s) => s.provider),
    signals,
    country: pickFirst<string>(signals, 'country'),
    country_code: pickFirst<string>(signals, 'country_code'),
    city: pickFirst<string>(signals, 'city'),
    timezone: pickFirst<string>(signals, 'timezone'),
    latitude: pickFirst<number>(signals, 'latitude'),
    longitude: pickFirst<number>(signals, 'longitude')
  }
}

async function fetchAllProviders(transport: Transport): Promise<FraudVerdict> {
  const [ipApiResult, ipapiIsResult] = await Promise.allSettled([
    fetchIpApi(transport),
    fetchIpapiIs(transport)
  ])
  const signals: FraudSignal[] = []
  if (ipApiResult.status === 'fulfilled' && ipApiResult.value) signals.push(ipApiResult.value)
  if (ipapiIsResult.status === 'fulfilled' && ipapiIsResult.value) signals.push(ipapiIsResult.value)
  return combineSignals(signals)
}

// ─── Public API ───────────────────────────────────────────────────────────

function verdictToBundle(verdict: FraudVerdict): ProxyGeoBundle | null {
  // No useful data — caller treats as "unknown / try again later".
  if (verdict.fraud_providers.length === 0) return null
  const hasCoords = verdict.latitude !== null && verdict.longitude !== null
  return {
    country: verdict.country,
    country_code: verdict.country_code,
    city: verdict.city,
    timezone: verdict.timezone,
    latitude: verdict.latitude,
    longitude: verdict.longitude,
    accuracy_radius: hasCoords ? GEO_DEFAULT_ACCURACY_RADIUS_METERS : null,
    locale: sanitizeLocale(localeForCountry(verdict.country_code)),
    external_ip: verdict.external_ip,
    isp: verdict.isp,
    org: verdict.org,
    asn: verdict.asn,
    asn_type: verdict.asn_type,
    is_proxy_detected: verdict.is_proxy_detected,
    is_hosting: verdict.is_hosting,
    is_datacenter: verdict.is_datacenter,
    is_vpn: verdict.is_vpn,
    is_tor: verdict.is_tor,
    is_abuser: verdict.is_abuser,
    is_mobile: verdict.is_mobile,
    abuse_score: verdict.abuse_score,
    fraud_score: verdict.fraud_score,
    fraud_risk: verdict.fraud_risk,
    fraud_providers: verdict.fraud_providers
  }
}

function boolToInt(v: boolean | null): number | null {
  return v === null ? null : v ? 1 : 0
}

/**
 * Lookup + persist for an existing proxy row. Reads the row, queries every
 * fraud provider in parallel through the proxy itself, combines the signals
 * into one verdict, writes every resolved field back in one UPDATE.
 */
export async function lookupProxyGeo(
  db: Database.Database,
  proxyId: string
): Promise<ProxyGeoBundle | null> {
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as
    | Proxy
    | undefined
  if (!proxy) return null

  const verdict = await fetchAllProviders({ kind: 'proxy', proxy })
  const bundle = verdictToBundle(verdict)
  if (!bundle) return null

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE proxies
        SET country = ?, timezone = ?, city = ?,
            latitude = ?, longitude = ?, accuracy_radius = ?, locale = ?,
            external_ip = ?, isp = ?, org = ?, asn = ?, asn_type = ?,
            is_proxy_detected = ?, is_hosting = ?, is_datacenter = ?,
            is_vpn = ?, is_tor = ?, is_abuser = ?, is_mobile = ?,
            abuse_score = ?, fraud_score = ?, fraud_risk = ?,
            fraud_providers = ?, last_fraud_check = ?
      WHERE id = ?`
  ).run(
    bundle.country_code,
    bundle.timezone,
    bundle.city,
    bundle.latitude,
    bundle.longitude,
    bundle.accuracy_radius,
    bundle.locale,
    bundle.external_ip,
    bundle.isp,
    bundle.org,
    bundle.asn,
    bundle.asn_type,
    boolToInt(bundle.is_proxy_detected),
    boolToInt(bundle.is_hosting),
    boolToInt(bundle.is_datacenter),
    boolToInt(bundle.is_vpn),
    boolToInt(bundle.is_tor),
    boolToInt(bundle.is_abuser),
    boolToInt(bundle.is_mobile),
    bundle.abuse_score,
    bundle.fraud_score,
    bundle.fraud_risk,
    JSON.stringify(bundle.fraud_providers),
    now,
    proxyId
  )

  return bundle
}

/**
 * Dry-run reputation lookup — characterize a proxy candidate by tunneling
 * through it without writing anything to the DB. Used by the bulk-import
 * filter so risky proxies are skipped before the row is even created.
 */
export async function dryRunProxyMetadata(input: {
  protocol: Proxy['protocol']
  host: string
  port: number
  username?: string | null
  password?: string | null
}): Promise<ProxyGeoBundle | null> {
  const transient: Proxy = {
    id: 'dry-run', name: '',
    protocol: input.protocol, host: input.host, port: input.port,
    username: input.username ?? null, password: input.password ?? null,
    last_check: null, check_ok: 0, check_latency_ms: null, check_error: null,
    country: null, group_tag: null, timezone: null, city: null,
    latitude: null, longitude: null, accuracy_radius: null, locale: null,
    external_ip: null, isp: null, org: null, asn: null, asn_type: null,
    is_proxy_detected: null, is_hosting: null, is_datacenter: null,
    is_vpn: null, is_tor: null, is_abuser: null, is_mobile: null,
    abuse_score: null, fraud_score: null, fraud_risk: null,
    fraud_providers: null, last_fraud_check: null, created_at: ''
  }
  const verdict = await fetchAllProviders({ kind: 'proxy', proxy: transient })
  return verdictToBundle(verdict)
}

/**
 * Standalone IP fraud check — investigate an arbitrary IP without binding
 * to a proxy in the DB. Both providers are queried directly from the Lux
 * host, which means Lux's real IP is visible in their logs alongside the
 * IP under investigation. That's an explicit privacy tradeoff documented
 * in the UI; the "investigate any IP" use-case can't tunnel through a
 * not-yet-configured proxy.
 *
 * Returns null when the input doesn't look like an IP literal (cheap
 * client-side guard against silly typos).
 */
const IPV4_RE = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/
const IPV6_RE = /^[0-9a-fA-F:]+$/

export async function lookupFraudByIp(ip: string): Promise<IpFraudReport | null> {
  const trimmed = ip.trim()
  if (!IPV4_RE.test(trimmed) && !IPV6_RE.test(trimmed)) return null
  const verdict = await fetchAllProviders({ kind: 'direct', ip: trimmed })
  if (verdict.fraud_providers.length === 0) return null
  return {
    ip: trimmed,
    external_ip: verdict.external_ip,
    country: verdict.country,
    country_code: verdict.country_code,
    city: verdict.city,
    isp: verdict.isp,
    org: verdict.org,
    asn: verdict.asn,
    asn_type: verdict.asn_type,
    is_proxy_detected: verdict.is_proxy_detected,
    is_hosting: verdict.is_hosting,
    is_datacenter: verdict.is_datacenter,
    is_vpn: verdict.is_vpn,
    is_tor: verdict.is_tor,
    is_abuser: verdict.is_abuser,
    is_mobile: verdict.is_mobile,
    abuse_score: verdict.abuse_score,
    fraud_score: verdict.fraud_score,
    fraud_risk: verdict.fraud_risk,
    fraud_providers: verdict.fraud_providers
  }
}
