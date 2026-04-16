import { create } from 'zustand'
import type { Profile, ProfileStatus, SessionInfo } from '../lib/types'
import { api, isApiAvailable } from '../lib/api'

interface ProfilesStore {
  profiles: Profile[]
  sessions: SessionInfo[]
  loading: boolean
  /** Per-profile error messages (cleared on next action) */
  profileErrors: Record<string, string>
  fetchProfiles: () => Promise<void>
  fetchSessions: () => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  launchBrowser: (id: string) => Promise<void>
  stopBrowser: (id: string) => Promise<void>
  duplicateProfile: (id: string) => Promise<void>
  clearProfileError: (id: string) => void
}

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
    await api.deleteProfile(id)
    await get().fetchProfiles()
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
  }
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
