import { useState, useRef, useEffect } from 'react'
import { Bell, CheckCircle2, XCircle, Info, AlertTriangle, Check, Trash2 } from 'lucide-react'
import { useNotificationStore } from '../stores/notifications'
import type { Notification, NotificationType } from '../stores/notifications'

const typeIcons: Record<NotificationType, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle
}

const typeColors: Record<NotificationType, string> = {
  success: 'text-ok',
  error: 'text-err',
  info: 'text-accent',
  warning: 'text-warn'
}

const typeBg: Record<NotificationType, string> = {
  success: 'bg-ok/8',
  error: 'bg-err/8',
  info: 'bg-accent/8',
  warning: 'bg-warn/8'
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function NotificationItem({ n, onRead }: { n: Notification; onRead: () => void }) {
  const Icon = typeIcons[n.type]

  return (
    <button
      onClick={onRead}
      className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-all hover:bg-elevated/50 ${
        !n.read ? 'bg-elevated/20' : ''
      }`}
    >
      <div className={`mt-0.5 shrink-0 rounded-lg p-1 ${typeBg[n.type]}`}>
        <Icon className={`h-3 w-3 ${typeColors[n.type]}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] leading-relaxed ${n.read ? 'text-muted' : 'text-content'}`}>
          {n.message}
        </p>
        <p className="text-[9px] text-muted/60 mt-0.5">{timeAgo(n.timestamp)}</p>
      </div>
      {!n.read && <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
    </button>
  )
}

export function NotificationCenter(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const notifications = useNotificationStore((s) => s.notifications)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clearAll = useNotificationStore((s) => s.clearAll)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className={`relative rounded-lg p-2 transition-all duration-150 ${
          open ? 'bg-accent/15 text-accent' : 'text-muted hover:text-content hover:bg-elevated'
        }`}
        title="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-1 shadow-md shadow-accent/30 animate-scaleIn">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-full mt-2 w-[320px] rounded-xl border border-edge bg-card shadow-2xl shadow-black/50 overflow-hidden animate-scaleIn z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-edge bg-elevated/20">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-content">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-[9px] font-bold text-accent bg-accent/15 px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="p-1 rounded-md text-muted hover:text-content hover:bg-elevated transition-all"
                  title="Mark all as read"
                >
                  <Check className="h-3 w-3" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="p-1 rounded-md text-muted hover:text-err hover:bg-err/10 transition-all"
                  title="Clear all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-edge/40">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="h-6 w-6 text-muted/30 mx-auto mb-2" />
                <p className="text-xs text-muted/60">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  onRead={() => markRead(n.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
