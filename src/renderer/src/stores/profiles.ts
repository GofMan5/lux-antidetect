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

export const useProfilesStore = create<ProfilesStore>((set, get) => ({
  profiles: [],
  sessions: [],
  loading: false,
  profileErrors: {},

  fetchProfiles: async () => {
    if (!isApiAvailable()) return
    set({ loading: true })
    try {
      const profiles = await api.listProfiles()
      set({ profiles })
    } finally {
      set({ loading: false })
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
    // Clear previous error and set optimistic "starting" state
    set((state) => ({
      profileErrors: { ...state.profileErrors, [id]: '' },
      profiles: setProfileStatus(state.profiles, id, 'starting')
    }))
    try {
      await api.launchBrowser(id)
      // session:started event will set "running" reactively
    } catch (err) {
      // session:state 'error' event may have already fired, but set error here too
      const msg = err instanceof Error ? err.message : 'Launch failed'
      set((state) => ({
        profileErrors: { ...state.profileErrors, [id]: msg },
        profiles: setProfileStatus(state.profiles, id, 'error')
      }))
    }
  },

  stopBrowser: async (id) => {
    set((state) => ({
      profiles: setProfileStatus(state.profiles, id, 'stopping')
    }))
    try {
      await api.stopBrowser(id)
      // session:stopped event will set "ready" reactively
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
      return { profileErrors: errors }
    })
  }
}))

// Reactive session event subscriptions — instant UI updates when browsers start/stop
if (typeof window !== 'undefined' && window.api) {
  window.api.onSessionStarted((data) => {
    const info = data as SessionInfo
    useProfilesStore.setState((state) => ({
      profiles: setProfileStatus(state.profiles, info.profile_id, 'running'),
      sessions: [...state.sessions.filter((s) => s.profile_id !== info.profile_id), info]
    }))
  })

  window.api.onSessionStopped((data) => {
    const { profile_id } = data as { profile_id: string; exit_code: number | null }
    useProfilesStore.setState((state) => ({
      profiles: setProfileStatus(state.profiles, profile_id, 'ready'),
      sessions: state.sessions.filter((s) => s.profile_id !== profile_id)
    }))
  })

  window.api.onSessionState((data) => {
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
  })
}
