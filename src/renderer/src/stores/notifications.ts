import { create } from 'zustand'

export type NotificationType = 'success' | 'error' | 'info' | 'warning'

export interface Notification {
  id: number
  message: string
  type: NotificationType
  timestamp: number
  read: boolean
}

interface NotificationStore {
  notifications: Notification[]
  unreadCount: number

  addNotification: (message: string, type?: NotificationType) => void
  markRead: (id: number) => void
  markAllRead: () => void
  clearAll: () => void
}

let nid = 0

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (message, type = 'info') => {
    const notification: Notification = {
      id: ++nid,
      message,
      type,
      timestamp: Date.now(),
      read: false
    }
    set((s) => ({
      notifications: [notification, ...s.notifications].slice(0, 200),
      unreadCount: s.unreadCount + 1
    }))
  },

  markRead: (id) => {
    const n = get().notifications.find((n) => n.id === id)
    if (n && !n.read) {
      set((s) => ({
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, s.unreadCount - 1)
      }))
    }
  },

  markAllRead: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0
    }))
  },

  clearAll: () => {
    set({ notifications: [], unreadCount: 0 })
  }
}))
