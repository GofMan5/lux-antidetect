// Tiny relative-time formatter. Pure function so it can be reused outside
// ProfilesPage (e.g. ProxiesPage, command palette previews) without
// dragging the whole table component along.
//
// Edge cases:
//   - null / empty → "Never"
//   - <1 min → "Just now"
//   - <1 h → "<n>m ago"
//   - <24 h → "<n>h ago"
//   - <30 d → "<n>d ago"
//   - older → locale-formatted date

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
