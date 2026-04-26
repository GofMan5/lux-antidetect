import { useCallback, useEffect, useState } from 'react'

// Per-group expand/collapse state for the Profiles list. We persist a Set of
// COLLAPSED group names in localStorage so groups default to expanded —
// which matches the spec ("Default all expanded"). Storing collapsed-only
// keeps the on-disk footprint tiny when the user has dozens of groups.

const STORAGE_KEY = 'lux.profiles.collapsedGroups'

function readFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function writeToStorage(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)))
  } catch {
    /* storage disabled — tolerable */
  }
}

interface GroupCollapsedState {
  /** True when the named group is currently collapsed. */
  isCollapsed: (group: string) => boolean
  /** Flip collapsed state for a single group. */
  toggle: (group: string) => void
}

export function useGroupCollapsedState(): GroupCollapsedState {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readFromStorage())

  // Persist on every change. Cheap — Set is small.
  useEffect(() => {
    writeToStorage(collapsed)
  }, [collapsed])

  const isCollapsed = useCallback((group: string) => collapsed.has(group), [collapsed])

  const toggle = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  return { isCollapsed, toggle }
}
