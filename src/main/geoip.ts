import type Database from 'better-sqlite3'
import type { Proxy } from './models'
import { httpGetThroughProxy } from './proxy'

// ---------------------------------------------------------------------------
// Provider (ip-api.com — free, HTTP-only, no key, ~45 req/min per IP)
// ---------------------------------------------------------------------------

const GEO_PROVIDER_HOST = 'ip-api.com'
const GEO_PROVIDER_PORT = 80
const GEO_PROVIDER_PATH =
  '/json/?fields=status,message,country,countryCode,city,timezone,lat,lon,query'
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
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_COUNTRY_LEN = 80
const MAX_CITY_LEN = 80
const MAX_TIMEZONE_LEN = 64
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/

function sanitizeString(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
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

function safeParseIpApiJson(body: string): IpApiResponse | null {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as IpApiResponse
  } catch {
    return null
  }
}

/**
 * Fetch geo info for the proxy's apparent IP by sending the ip-api request
 * *through the proxy itself*. Persists resolved fields on the proxies row.
 * Returns the full bundle on success, null on any failure (no throws).
 */
export async function lookupProxyGeo(
  db: Database.Database,
  proxyId: string
): Promise<ProxyGeoBundle | null> {
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as
    | Proxy
    | undefined
  if (!proxy) return null

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
  const bundle: ProxyGeoBundle = {
    country: sanitizeString(parsed.country, MAX_COUNTRY_LEN),
    country_code: countryCode,
    city: sanitizeString(parsed.city, MAX_CITY_LEN),
    timezone: sanitizeTimezone(parsed.timezone),
    latitude: lat,
    longitude: lon,
    accuracy_radius: hasCoords ? GEO_DEFAULT_ACCURACY_RADIUS_METERS : null,
    locale
  }

  db.prepare(
    `UPDATE proxies
        SET country = ?,
            timezone = ?,
            city = ?,
            latitude = ?,
            longitude = ?,
            accuracy_radius = ?,
            locale = ?
      WHERE id = ?`
  ).run(
    countryCode,
    bundle.timezone,
    bundle.city,
    bundle.latitude,
    bundle.longitude,
    bundle.accuracy_radius,
    bundle.locale,
    proxyId
  )

  return bundle
}
