const TAG_MAX_LENGTH = 40
const TAG_MAX_COUNT = 20
const TAG_NOISE_RE = /^[\s[\]/\\'",]+$/

function cleanTag(raw: string): string | null {
  let tag = raw.trim()
  if (!tag) return null

  tag = tag
    .replace(/^[\s[\]"']+/g, '')
    .replace(/[\s[\]"']+$/g, '')
    .trim()

  if (!tag || TAG_NOISE_RE.test(tag)) return null
  return tag.slice(0, TAG_MAX_LENGTH)
}

function collectTags(raw: unknown, out: string[]): void {
  if (out.length >= TAG_MAX_COUNT || raw === null || raw === undefined) return

  if (Array.isArray(raw)) {
    for (const item of raw) collectTags(item, out)
    return
  }

  if (typeof raw !== 'string') return

  const trimmed = raw.trim()
  if (!trimmed || TAG_NOISE_RE.test(trimmed)) return

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      collectTags(parsed, out)
      return
    }
  } catch {
    // Plain comma-separated form value or legacy corrupted string.
  }

  for (const part of trimmed.split(',')) {
    const tag = cleanTag(part)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length >= TAG_MAX_COUNT) return
  }
}

export function parseTags(raw: unknown): string[] {
  const tags: string[] = []
  collectTags(raw, tags)
  return tags
}

export function formatTagsForForm(raw: unknown): string {
  return parseTags(raw).join(', ')
}

export function parseTagsFromForm(value: string): string[] {
  return parseTags(value)
}
