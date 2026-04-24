import { create } from 'zustand'
import type { Profile, ProfileStatus, SessionInfo } from '../lib/types'
import { api, isApiAvailable } from '../lib/api'

interface ProfilesStore {
  profiles: Profile[]
  sessions: SessionInfo[]
  loading: boolean
  /** Per-profile error messages (cleared on next action) */
  profileErrors: Record<string, string>
  /** Editor panel state — persisted across navigations */
  editorMode: 'edit' | 'create' | null
  editorProfileId: string | null
  /**
   * Transient flag set when the profile-list health dot is clicked.
   * The editor reads it on mount (matching id) to auto-expand the
   * fingerprint-consistency banner, then clears it. Not persisted.
   */
  pendingHealthBannerExpand: string | null
  /**
   * IDs of profiles that are scheduled for deletion but not yet deleted —
   * the row is hidden from the UI and a timer will finalize the delete
   * unless `undoDelete` is called first. Enables Undo-toast pattern.
   */
  pendingDeletes: Set<string>
  fetchProfiles: () => Promise<void>
  fetchSessions: () => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  /** Hide a profile locally and finalize the delete after `delayMs`. Returns
   *  an undo callback that cancels the pending delete if called first. */
  scheduleDelete: (id: string, delayMs?: number) => () => void
  launchBrowser: (id: string) => Promise<void>
  stopBrowser: (id: string) => Promise<void>
  duplicateProfile: (id: string) => Promise<void>
  clearProfileError: (id: string) => void
  openEditor: (mode: 'edit' | 'create', profileId?: string | null) => void
  closeEditor: () => void
  setPendingHealthBannerExpand: (id: string | null) => void
}

// Deletion timers kept outside the store state (non-serializable).
const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>()

function setProfileStatus(
  profiles: Profile[],
  profileId: string,
  status: ProfileStatus
): Profile[] {
  return profiles.map((p) => (p.id === profileId ? { ...p, status } : p))
}

// Counter to prevent stale data overwrite from concurrent fetchProfiles calls
let fetchProfilesCounter = 0

export const useProfilesStore = create<ProfilesStore>((set, get) => ({
  profiles: [],
  sessions: [],
  loading: false,
  profileErrors: {},
  editorMode: null,
  editorProfileId: null,
  pendingHealthBannerExpand: null,
  pendingDeletes: new Set<string>(),

  fetchProfiles: async () => {
    if (!isApiAvailable()) return
    const requestId = ++fetchProfilesCounter
    set({ loading: true })
    try {
      const profiles = await api.listProfiles()
      // Only apply if this is still the latest request (avoid stale data overwrite)
      if (requestId === fetchProfilesCounter) {
        set({ profiles })
      }
    } finally {
      if (requestId === fetchProfilesCounter) {
        set({ loading: false })
      }
    }
  },

  fetchSessions: async () => {
    if (!isApiAvailable()) return
    const sessions = await api.getRunningSessions()
    set({ sessions })
  },

  deleteProfile: async (id) => {
    // Cancel any pending delete for this id so we don't double-fire.
    const timer = deleteTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      deleteTimers.delete(id)
    }
    set((s) => {
      if (!s.pendingDeletes.has(id)) return {}
      const next = new Set(s.pendingDeletes)
      next.delete(id)
      return { pendingDeletes: next }
    })
    await api.deleteProfile(id)
    await get().fetchProfiles()
  },

  scheduleDelete: (id, delayMs = 5500) => {
    // Add to pending set so the UI filters it out immediately.
    set((s) => {
      if (s.pendingDeletes.has(id)) return {}
      const next = new Set(s.pendingDeletes)
      next.add(id)
      return { pendingDeletes: next }
    })
    // Replace any prior timer for this id — most recent schedule wins.
    const prior = deleteTimers.get(id)
    if (prior) clearTimeout(prior)
    const timer = setTimeout(() => {
      deleteTimers.delete(id)
      // Finalize via the same API path as a straight delete so any server-
      // side cleanup (fingerprint rows, extensions, lock files) is uniform.
      api
        .deleteProfile(id)
        .catch(() => {
          // On failure, put the profile back in the visible list so the
          // user isn't left with a silently stuck "deleted" row.
          set((s) => {
            const next = new Set(s.pendingDeletes)
            next.delete(id)
            return { pendingDeletes: next }
          })
        })
        .finally(() => {
          set((s) => {
            if (!s.pendingDeletes.has(id)) return {}
            const next = new Set(s.pendingDeletes)
            next.delete(id)
            return { pendingDeletes: next }
          })
          void get().fetchProfiles()
        })
    }, delayMs)
    deleteTimers.set(id, timer)

    // Return an undo handler that cancels the finalize timer.
    return (): void => {
      const t = deleteTimers.get(id)
      if (t) {
        clearTimeout(t)
        deleteTimers.delete(id)
      }
      set((s) => {
        if (!s.pendingDeletes.has(id)) return {}
        const next = new Set(s.pendingDeletes)
        next.delete(id)
        return { pendingDeletes: next }
      })
    }
  },

  launchBrowser: async (id) => {
    // Prevent double-launch: only 'ready' or 'error' profiles can be launched
    const profile = get().profiles.find((p) => p.id === id)
    if (profile && profile.status !== 'ready' && profile.status !== 'error') {
      return
    }

    // Check max concurrent sessions limit
    const maxConcurrent = await api.getSetting('max_concurrent_sessions') as number | null
    if (maxConcurrent && maxConcurrent > 0) {
      const running = get().profiles.filter(p => p.status === 'running' || p.status === 'starting').length
      if (running >= maxConcurrent) {
        set((state) => ({
          profileErrors: { ...state.profileErrors, [id]: `Max concurrent sessions (${maxConcurrent}) reached` },
          profiles: setProfileStatus(state.profiles, id, 'error')
        }))
        return
      }
    }

    // Clear previous error and set optimistic "starting" state
    set((state) => ({
      profileErrors: { ...state.profileErrors, [id]: '' },
      profiles: setProfileStatus(state.profiles, id, 'starting')
    }))
    try {
      await api.launchBrowser(id)
      // IPC call succeeded — browser is launching. Set 'running' immediately as fallback.
      // The session:started event will also fire, but this guarantees the UI updates
      // even if event listeners aren't subscribed yet.
      set((state) => ({
        profiles: setProfileStatus(state.profiles, id, 'running')
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Launch failed'
      set((state) => ({
        profileErrors: { ...state.profileErrors, [id]: msg },
        profiles: setProfileStatus(state.profiles, id, 'error')
      }))
    }
  },

  stopBrowser: async (id) => {
    // Prevent double-stop: only 'running' profiles can be stopped
    const profile = get().profiles.find((p) => p.id === id)
    if (profile && profile.status !== 'running') {
      return
    }

    set((state) => ({
      profiles: setProfileStatus(state.profiles, id, 'stopping')
    }))
    try {
      await api.stopBrowser(id)
      // The child process 'exit' event fires async and will send session:stopped.
      // As a safety net, refetch profiles after a short delay to guarantee we
      // pick up the 'ready' status even if the event is missed.
      setTimeout(() => {
        get().fetchProfiles()
      }, 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stop failed'
      set((state) => ({
        profileErrors: { ...state.profileErrors, [id]: msg }
      }))
      // Refetch to get real state
      await get().fetchProfiles()
    }
  },

  duplicateProfile: async (id) => {
    await api.duplicateProfile(id)
    await get().fetchProfiles()
  },

  clearProfileError: (id) => {
    set((state) => {
      const errors = { ...state.profileErrors }
      delete errors[id]
      return {
        profileErrors: errors,
        profiles: setProfileStatus(state.profiles, id, 'ready')
      }
    })
  },

  openEditor: (mode, profileId = null) => set({ editorMode: mode, editorProfileId: profileId }),
  // Clearing `pendingHealthBannerExpand` alongside editor state ensures the
  // auto-expand flag cannot survive a close-before-mount (e.g. user clicks the
  // health dot, then dismisses the panel, then opens an unrelated profile).
  closeEditor: () => set({ editorMode: null, editorProfileId: null, pendingHealthBannerExpand: null }),
  setPendingHealthBannerExpand: (id) => set({ pendingHealthBannerExpand: id })
}))

// Reactive session event subscriptions — instant UI updates when browsers start/stop.
// Use a retry loop because contextBridge may not have exposed window.api yet
// when this module is first evaluated.
const MAX_INIT_RETRIES = 100 // 5 seconds max (100 * 50ms)
let initRetries = 0
let listenersRegistered = false
// Store cleanup fns for HMR
let cleanupFns: (() => void)[] = []

function initEventListeners(): void {
  if (typeof window === 'undefined') return

  if (!window.api) {
    if (initRetries++ < MAX_INIT_RETRIES) {
      setTimeout(initEventListeners, 50)
    }
    return
  }

  // Guard against duplicate registration (HMR)
  if (listenersRegistered) return
  listenersRegistered = true

  // Clean up any stale listeners from previous HMR cycle
  for (const fn of cleanupFns) fn()
  cleanupFns = []

  cleanupFns.push(window.api.onSessionStarted((data) => {
    const info = data as SessionInfo
    useProfilesStore.setState((state) => ({
      profiles: setProfileStatus(state.profiles, info.profile_id, 'running'),
      sessions: [...state.sessions.filter((s) => s.profile_id !== info.profile_id), info]
    }))
  }))

  cleanupFns.push(window.api.onSessionStopped((data) => {
    const { profile_id } = data as { profile_id: string; exit_code: number | null }
    useProfilesStore.setState((state) => ({
      profiles: setProfileStatus(state.profiles, profile_id, 'ready'),
      sessions: state.sessions.filter((s) => s.profile_id !== profile_id)
    }))
  }))

  cleanupFns.push(window.api.onSessionState((data) => {
    const { profile_id, status, error } = data as {
      profile_id: string
      status: ProfileStatus
      error?: string
    }
    useProfilesStore.setState((state) => ({
      profiles: setProfileStatus(state.profiles, profile_id, status),
      ...(error
        ? { profileErrors: { ...state.profileErrors, [profile_id]: error } }
        : {})
    }))
  }))
}

initEventListeners()
