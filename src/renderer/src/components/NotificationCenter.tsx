import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCircle2, XCircle, Info, AlertTriangle, Check, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
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
  success: 'bg-ok/10',
  error: 'bg-err/10',
  info: 'bg-accent/10',
  warning: 'bg-warn/10'
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
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-200',
        'hover:bg-elevated/40',
        !n.read && 'bg-elevated/15'
      )}
    >
      <div className={cn('mt-0.5 shrink-0 rounded-[--radius-sm] p-1.5', typeBg[n.type])}>
        <Icon className={cn('h-3.5 w-3.5', typeColors[n.type])} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[12px] leading-relaxed', n.read ? 'text-muted' : 'text-content')}>
          {n.message}
        </p>
        <p className="text-[10px] text-muted/50 mt-1">{timeAgo(n.timestamp)}</p>
      </div>
      {!n.read && <div className="mt-2 w-2 h-2 rounded-full bg-accent shrink-0 shadow-[0_0_6px_var(--color-accent-glow)]" />}
    </button>
  )
}

export function NotificationCenter(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const notifications = useNotificationStore((s) => s.notifications)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clearAll = useNotificationStore((s) => s.clearAll)

  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  const updatePos = useCallback(() => {
    if (!bellRef.current) return
    const rect = bellRef.current.getBoundingClientRect()
    setPos({
      left: Math.min(rect.left, window.innerWidth - 376),
      bottom: Math.min(window.innerHeight - rect.top + 8, window.innerHeight - 16)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('resize', updatePos)
    return () => window.removeEventListener('resize', updatePos)
  }, [open, updatePos])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (bellRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <>
      {/* Bell button */}
      <button
        ref={bellRef}
        onClick={() => setOpen(!open)}
        className={cn(
          'relative rounded-[--radius-md] p-2.5 transition-all duration-200',
          open
            ? 'bg-accent/12 text-accent'
            : 'text-muted hover:text-content hover:bg-elevated/50'
        )}
        title="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-1 shadow-[0_0_8px_var(--color-accent-glow)] animate-scaleIn">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel — portal to body so it never clips */}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="w-[360px] rounded-[--radius-xl] border border-edge/60 bg-card/95 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden animate-scaleIn"
          style={{
            position: 'fixed',
            left: pos.left,
            bottom: pos.bottom,
            zIndex: 300
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-edge/40">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-content">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold text-accent bg-accent/12 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="rounded-[--radius-sm] p-1.5 text-muted hover:text-content hover:bg-elevated/50 transition-all duration-200"
                  title="Mark all as read"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="rounded-[--radius-sm] p-1.5 text-muted hover:text-err hover:bg-err/10 transition-all duration-200"
                  title="Clear all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-edge/30">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="h-10 w-10 rounded-full bg-elevated/50 flex items-center justify-center mx-auto mb-3">
                  <Bell className="h-5 w-5 text-muted/30" />
                </div>
                <p className="text-xs text-muted/50">No notifications</p>
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
        </div>,
        document.body
      )}
    </>
  )
}
