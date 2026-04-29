import type Database from 'better-sqlite3'
import type {
  Fingerprint,
  Profile,
  ProfileHealthFixResult,
  ProfileHealthIssue,
  ProfileHealthReport,
  ProfileHealthSeverity,
  ProxyResponse
} from './models'
import { getProfile, listProfiles } from './profile'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const COUNTRY_LANGUAGE: Record<string, string> = {
  US: 'en-US',
  GB: 'en-GB',
  CA: 'en-CA',
  AU: 'en-AU',
  DE: 'de-DE',
  FR: 'fr-FR',
  ES: 'es-ES',
  IT: 'it-IT',
  NL: 'nl-NL',
  PL: 'pl-PL',
  RU: 'ru-RU',
  UA: 'uk-UA',
  BR: 'pt-BR',
  PT: 'pt-PT',
  TR: 'tr-TR',
  JP: 'ja-JP',
  KR: 'ko-KR',
  CN: 'zh-CN'
}

function assertUuid(id: string): void {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('Invalid profile ID format')
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function issue(
  issues: ProfileHealthIssue[],
  id: string,
  severity: ProfileHealthSeverity,
  title: string,
  detail: string,
  fixable = false,
  category: ProfileHealthIssue['category'] = 'identity'
): void {
  issues.push({ id, severity, title, detail, fixable, category })
}

function severityPenalty(severity: ProfileHealthSeverity): number {
  if (severity === 'critical') return 22
  if (severity === 'warning') return 10
  return 4
}

function inferUaOs(ua: string): 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'unknown' {
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Windows NT/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac'
  if (/Linux/i.test(ua)) return 'linux'
  return 'unknown'
}

function platformOs(platform: string): 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'unknown' {
  if (/Win/i.test(platform)) return 'windows'
  if (/Mac/i.test(platform)) return 'mac'
  if (/Linux/i.test(platform)) return 'linux'
  if (/Android/i.test(platform)) return 'android'
  if (/iPhone|iPad|iPod/i.test(platform)) return 'ios'
  return 'unknown'
}

function primaryLanguageFromProxy(proxy: ProxyResponse | null): string | null {
  if (!proxy) return null
  if (proxy.locale) return proxy.locale
  const country = proxy.country?.toUpperCase()
  return country ? COUNTRY_LANGUAGE[country] ?? null : null
}

function languageBase(locale: string): string {
  return locale.split('-')[0].toLowerCase()
}

function buildSummary(score: number, issues: ProfileHealthIssue[]): string {
  if (score >= 90) return 'Profile is coherent'
  const critical = issues.filter((item) => item.severity === 'critical').length
  const warnings = issues.filter((item) => item.severity === 'warning').length
  if (critical > 0) return `${critical} critical mismatch${critical === 1 ? '' : 'es'}`
  if (warnings > 0) return `${warnings} warning${warnings === 1 ? '' : 's'}`
  return 'Minor metadata gaps'
}

function buildReport(profileId: string, issues: ProfileHealthIssue[]): ProfileHealthReport {
  const penalty = issues.reduce((sum, item) => sum + severityPenalty(item.severity), 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))
  return {
    profile_id: profileId,
    score,
    status: score >= 85 ? 'good' : score >= 65 ? 'warning' : 'critical',
    summary: buildSummary(score, issues),
    issues,
    fixable_count: issues.filter((item) => item.fixable).length,
    checked_at: new Date().toISOString()
  }
}

function evaluate(detail: { profile: Profile; fingerprint: Fingerprint; proxy: ProxyResponse | null }): ProfileHealthReport {
  const { profile, fingerprint, proxy } = detail
  const issues: ProfileHealthIssue[] = []
  const ua = fingerprint.user_agent || ''
  const uaOs = inferUaOs(ua)
  const fpOs = platformOs(fingerprint.platform || '')
  const languages = parseStringArray(fingerprint.languages)
  const primaryProxyLanguage = primaryLanguageFromProxy(proxy)

  if (!profile.proxy_id) {
    issue(issues, 'proxy.missing', 'warning', 'No proxy assigned', 'Profile traffic uses the host network.', false, 'proxy')
  } else if (!proxy) {
    issue(issues, 'proxy.deleted', 'critical', 'Proxy record is missing', 'The profile points to a proxy id that no longer exists.', false, 'proxy')
  } else {
    if (!proxy.last_check) {
      issue(issues, 'proxy.not_checked', 'warning', 'Proxy was not tested', 'Run proxy check before using this profile.', false, 'proxy')
    } else if (!proxy.check_ok) {
      issue(issues, 'proxy.failed', 'critical', 'Proxy check failed', proxy.check_error || 'Last proxy check did not pass.', false, 'proxy')
    }

    if (!proxy.timezone || !proxy.locale) {
      issue(issues, 'proxy.geo_missing', 'warning', 'Proxy geo metadata is incomplete', 'Refresh proxy geo to align timezone and language.', false, 'geo')
    }

    if (proxy.timezone && fingerprint.timezone !== proxy.timezone) {
      issue(
        issues,
        'geo.timezone_mismatch',
        'critical',
        'Timezone does not match proxy',
        `Fingerprint uses ${fingerprint.timezone || 'empty'}, proxy resolves to ${proxy.timezone}.`,
        true,
        'geo'
      )
    }

    if (primaryProxyLanguage && languages.length > 0) {
      const expectedBase = languageBase(primaryProxyLanguage)
      const hasMatchingLanguage = languages.some((language) => languageBase(language) === expectedBase)
      if (!hasMatchingLanguage) {
        issue(
          issues,
          'geo.language_mismatch',
          'warning',
          'Language does not match proxy region',
          `Navigator languages are ${languages.join(', ') || 'empty'}, proxy suggests ${primaryProxyLanguage}.`,
          true,
          'geo'
        )
      }
    }

    if (fingerprint.webrtc_policy !== 'disable_non_proxied_udp') {
      issue(
        issues,
        'network.webrtc_policy',
        'warning',
        'WebRTC policy can expose host network',
        'Use disable_non_proxied_udp for proxied profiles.',
        true,
        'network'
      )
    }

    if (proxy.fraud_risk === 'critical' || proxy.is_tor === true || proxy.is_abuser === true) {
      issue(issues, 'proxy.reputation_critical', 'critical', 'Proxy reputation is critical', 'Provider metadata marks this IP as high risk.', false, 'proxy')
    } else if (proxy.fraud_risk === 'high' || proxy.is_datacenter === true || proxy.is_hosting === true) {
      issue(issues, 'proxy.reputation_high', 'warning', 'Proxy reputation is weak', 'Hosting/datacenter or high-risk metadata was detected.', false, 'proxy')
    }
  }

  if (!fingerprint.timezone) {
    issue(issues, 'identity.timezone_empty', 'critical', 'Timezone is empty', 'Fingerprint timezone must be set.', true, 'identity')
  }
  if (languages.length === 0) {
    issue(issues, 'identity.languages_empty', 'critical', 'Languages are empty', 'Navigator languages must contain at least one locale.', true, 'identity')
  }

  if (uaOs !== 'unknown' && fpOs !== 'unknown' && uaOs !== fpOs) {
    issue(
      issues,
      'browser.ua_platform_mismatch',
      'critical',
      'User-Agent and platform disagree',
      `User-Agent looks like ${uaOs}, navigator.platform looks like ${fingerprint.platform}.`,
      false,
      'browser'
    )
  }

  const isMobileUa = uaOs === 'android' || uaOs === 'ios' || /Mobile/i.test(ua)
  if (isMobileUa && fingerprint.device_type !== 'mobile') {
    issue(issues, 'hardware.mobile_ua_desktop_device', 'warning', 'Mobile UA with desktop device type', 'Set device_type to mobile or regenerate the fingerprint.', false, 'hardware')
  }
  if (!isMobileUa && fingerprint.device_type === 'mobile') {
    issue(issues, 'hardware.desktop_ua_mobile_device', 'warning', 'Desktop UA with mobile device type', 'Set device_type to desktop or regenerate the fingerprint.', false, 'hardware')
  }
  if (fingerprint.device_type === 'mobile' && fingerprint.screen_width > 1200) {
    issue(issues, 'hardware.mobile_screen_large', 'warning', 'Mobile profile has desktop-sized screen', 'Mobile screens should use a smaller viewport.', false, 'hardware')
  }
  if (fingerprint.device_type === 'desktop' && fingerprint.screen_width < 900) {
    issue(issues, 'hardware.desktop_screen_small', 'warning', 'Desktop profile has narrow screen', 'Desktop screens below 900px look inconsistent.', false, 'hardware')
  }
  if (fingerprint.pixel_ratio < 0.5 || fingerprint.pixel_ratio > 4) {
    issue(issues, 'hardware.pixel_ratio_range', 'warning', 'Pixel ratio is unusual', 'Keep pixel_ratio between 0.5 and 4.', false, 'hardware')
  }

  const vendor = fingerprint.webgl_vendor || ''
  const renderer = fingerprint.webgl_renderer || ''
  if (uaOs === 'mac' && /Direct3D/i.test(renderer)) {
    issue(issues, 'hardware.mac_direct3d', 'critical', 'Mac profile exposes Direct3D renderer', 'Direct3D renderer belongs to Windows.', false, 'hardware')
  }
  if (uaOs === 'windows' && /Apple/i.test(vendor)) {
    issue(issues, 'hardware.windows_apple_gpu', 'critical', 'Windows profile exposes Apple GPU vendor', 'Apple GPU vendor does not match Windows.', false, 'hardware')
  }
  if (uaOs === 'mac' && /NVIDIA/i.test(vendor + ' ' + renderer)) {
    issue(issues, 'hardware.mac_nvidia', 'warning', 'Mac profile exposes NVIDIA GPU', 'Modern macOS fingerprints rarely pair with NVIDIA GPUs.', false, 'hardware')
  }

  return buildReport(profile.id, issues)
}

export function getProfileHealth(db: Database.Database, profileId: string): ProfileHealthReport {
  assertUuid(profileId)
  return evaluate(getProfile(db, profileId))
}

export function listProfileHealth(db: Database.Database): ProfileHealthReport[] {
  return listProfiles(db).map((profile) => getProfileHealth(db, profile.id))
}

export function autofixProfileHealth(db: Database.Database, profileId: string): ProfileHealthFixResult {
  assertUuid(profileId)
  const detail = getProfile(db, profileId)
  const before = evaluate(detail)
  const applied: string[] = []
  const patch: { timezone?: string; languages?: string; webrtc_policy?: string } = {}
  const proxy = detail.proxy

  if (proxy?.timezone && before.issues.some((item) => item.id === 'geo.timezone_mismatch' || item.id === 'identity.timezone_empty')) {
    patch.timezone = proxy.timezone
    applied.push(`Timezone -> ${proxy.timezone}`)
  } else if (!detail.fingerprint.timezone) {
    patch.timezone = 'UTC'
    applied.push('Timezone -> UTC')
  }

  const proxyLanguage = primaryLanguageFromProxy(proxy)
  const currentLanguages = parseStringArray(detail.fingerprint.languages)
  if (before.issues.some((item) => item.id === 'geo.language_mismatch' || item.id === 'identity.languages_empty')) {
    const primary = proxyLanguage ?? currentLanguages[0] ?? 'en-US'
    const base = languageBase(primary)
    patch.languages = JSON.stringify([primary, base])
    applied.push(`Languages -> ${primary}, ${base}`)
  }

  if (before.issues.some((item) => item.id === 'network.webrtc_policy')) {
    patch.webrtc_policy = 'disable_non_proxied_udp'
    applied.push('WebRTC policy -> disable_non_proxied_udp')
  }

  if (Object.keys(patch).length > 0) {
    db.prepare(
      `UPDATE fingerprints
          SET timezone = COALESCE(?, timezone),
              languages = COALESCE(?, languages),
              webrtc_policy = COALESCE(?, webrtc_policy)
        WHERE profile_id = ?`
    ).run(patch.timezone ?? null, patch.languages ?? null, patch.webrtc_policy ?? null, profileId)
  }

  return { report: getProfileHealth(db, profileId), applied }
}
