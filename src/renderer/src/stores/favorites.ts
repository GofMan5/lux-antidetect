import { create } from 'zustand'

/**
 * Client-local favorites: a Set of profile IDs persisted to localStorage.
 * Intentionally NOT a DB column so starring is instant and doesn't
 * require a migration — losing favorites on reinstall is acceptable.
 */

const STORAGE_KEY = 'lux.profiles.favorites'

function readFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function writeToStorage(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch { /* storage disabled — tolerable */ }
}

interface FavoritesStore {
  ids: Set<string>
  toggle: (profileId: string) => void
  isFavorite: (profileId: string) => boolean
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  ids: readFromStorage(),
  toggle: (profileId) => {
    const current = get().ids
    const next = new Set(current)
    if (next.has(profileId)) next.delete(profileId)
    else next.add(profileId)
    writeToStorage(next)
    set({ ids: next })
  },
  isFavorite: (profileId) => get().ids.has(profileId)
}))
