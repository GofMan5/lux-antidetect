// Shared builder for the fingerprint-preset dropdown menu. Used by both the
// profile list page ("New from preset") and the profile editor page ("Preset
// ▾" inside the Fingerprint tab). Extracted so the group ordering, labels,
// and the PresetBrowser → BrowserType mapping live in exactly one place —
// previously the two callers drifted (ios-emu was labelled "iOS-Emu" on the
// list and "iOS" in the editor).

import type { DropdownMenuItem } from '../components/ui'
import type { BrowserType } from './types'
import type { PresetDescriptor } from '../../../preload/api-contract'

// Use indexed-access types rather than importing PresetOsFamily / PresetBrowser
// from the main-process module — keeps the renderer's compile dependency graph
// bounded to what's already re-exported through api-contract.
type OsFamily = PresetDescriptor['os_family']
type PresetBrowser = PresetDescriptor['browser']

/**
 * Canonical grouping + label for the preset dropdown. Order is the order the
 * groups appear in the menu; the `label` is the section heading text.
 */
export const PRESET_GROUP_ORDER: ReadonlyArray<{
  family: OsFamily
  label: string
}> = [
  { family: 'windows', label: 'Windows' },
  { family: 'macos', label: 'macOS' },
  { family: 'linux', label: 'Linux' },
  { family: 'android', label: 'Android' },
  { family: 'ios-emu', label: 'iOS-Emu' }
] as const

/**
 * Maps a preset's browser field to the profile form's `browser_type`. Edge
 * presets don't exist today; extend this map if that changes.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Shared preset metadata is imported by multiple renderer screens.
export const PRESET_BROWSER_MAP: Record<PresetBrowser, BrowserType> = {
  chrome: 'chromium',
  firefox: 'firefox'
}

/**
 * Build grouped DropdownMenu items for the preset picker.
 *
 * - `presets === null` → loading state (single disabled row).
 * - `presets.length === 0` → empty state (single disabled row).
 * - Otherwise → heading + entry per group in `PRESET_GROUP_ORDER`.
 *
 * Groups with zero matching presets are skipped entirely (no empty headings).
 */
// eslint-disable-next-line react-refresh/only-export-components -- Shared menu builder is intentionally exported from this renderer helper.
export function buildPresetMenuItems(
  presets: PresetDescriptor[] | null,
  onPick: (preset: PresetDescriptor) => void
): DropdownMenuItem[] {
  if (!presets) {
    return [{ label: 'Loading presets…', disabled: true, onClick: () => {} }]
  }
  if (presets.length === 0) {
    return [{ label: 'No presets available', disabled: true, onClick: () => {} }]
  }
  const items: DropdownMenuItem[] = []
  for (const group of PRESET_GROUP_ORDER) {
    const inGroup = presets.filter((p) => p.os_family === group.family)
    if (inGroup.length === 0) continue
    items.push({ label: group.label, kind: 'heading', onClick: () => {} })
    for (const p of inGroup) {
      items.push({
        label: p.label,
        onClick: () => onPick(p)
      })
    }
  }
  return items
}
