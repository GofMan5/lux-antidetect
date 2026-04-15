import { create } from 'zustand'
import type { ProxyResponse } from '../lib/types'
import { api, isApiAvailable } from '../lib/api'

interface ProxiesStore {
  proxies: ProxyResponse[]
  loading: boolean
  fetchProxies: () => Promise<void>
  deleteProxy: (id: string) => Promise<void>
  testProxy: (id: string) => Promise<boolean>
}

export const useProxiesStore = create<ProxiesStore>((set, get) => ({
  proxies: [],
  loading: false,

  fetchProxies: async () => {
    if (!isApiAvailable()) return
    set({ loading: true })
    try {
      const proxies = await api.listProxies()
      set({ proxies })
    } finally {
      set({ loading: false })
    }
  },

  deleteProxy: async (id) => {
    await api.deleteProxy(id)
    await get().fetchProxies()
  },

  testProxy: async (id) => {
    const result = await api.testProxy(id)
    await get().fetchProxies()
    return result
  }
}))
