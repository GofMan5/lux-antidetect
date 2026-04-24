import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import {
  Search, LayoutGrid, Globe, Settings, Plus, PlayCircle,
  Keyboard, Download, Upload
} from 'lucide-react'
import { useProfilesStore } from '../stores/profiles'
import { useKeyboardShortcutsStore } from './KeyboardShortcutsHelp'

// ─── Store ────────────────────────────────────────────────────────────────

interface CommandPaletteStore {
  open: boolean
  show: () => void
  hide: () => void
  toggle: () => void
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open }))
}))

// ─── Types ────────────────────────────────────────────────────────────────

type CommandKind = 'navigate' | 'action' | 'profile'

interface Command {
  id: string
  kind: CommandKind
  label: string
  hint?: string
  icon: React.ReactNode
  keywords: string // space-separated search terms; lowercase
  perform: () => void
}

// ─── Search / match ───────────────────────────────────────────────────────

function rank(cmd: Command, query: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const label = cmd.label.toLowerCase()
  // Exact prefix beats substring beats keyword match. Higher = worse.
  if (label.startsWith(q)) return 0
  if (label.includes(q)) return 1
  if (cmd.keywords.includes(q)) return 2
  // All query chars appear in order?
  let i = 0
  for (const ch of label) {
    if (ch === q[i]) i++
    if (i === q.length) break
  }
  if (i === q.length) return 3
  return 99
}

// ─── Component ────────────────────────────────────────────────────────────

export function CommandPalette(): React.JSX.Element | null {
  const open = useCommandPaletteStore((s) => s.open)
  const toggle = useCommandPaletteStore((s) => s.toggle)
  const hide = useCommandPaletteStore((s) => s.hide)
  const navigate = useNavigate()
  const openEditor = useProfilesStore((s) => s.openEditor)
  const launchBrowser = useProfilesStore((s) => s.launchBrowser)
  const profiles = useProfilesStore((s) => s.profiles)
  const showShortcuts = useKeyboardShortcutsStore((s) => s.show)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Global Ctrl+K / Cmd+K to toggle — works outside inputs too because we
  // own the combination. Escape closes when the palette is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
        return
      }
      if (open && e.key === 'Escape') {
        e.preventDefault()
        hide()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggle, hide, open])

  // Reset state every time we open — fresh query, top item selected.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // Autofocus the input on next tick so the animation doesn't eat it.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Assemble commands for the current app state.
  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: 'nav-profiles',
        kind: 'navigate',
        label: 'Go to Profiles',
        hint: 'Browser profiles table',
        icon: <LayoutGrid className="h-4 w-4" />,
        keywords: 'navigate profiles home browsers list',
        perform: () => navigate('/profiles')
      },
      {
        id: 'nav-proxies',
        kind: 'navigate',
        label: 'Go to Proxies',
        hint: 'Manage proxy list',
        icon: <Globe className="h-4 w-4" />,
        keywords: 'navigate proxies socks http',
        perform: () => navigate('/proxies')
      },
      {
        id: 'nav-settings',
        kind: 'navigate',
        label: 'Go to Settings',
        hint: 'Appearance, browsers, data',
        icon: <Settings className="h-4 w-4" />,
        keywords: 'navigate settings preferences config',
        perform: () => navigate('/settings')
      },
      {
        id: 'act-new-profile',
        kind: 'action',
        label: 'New Profile',
        hint: 'Create a blank browser profile',
        icon: <Plus className="h-4 w-4" />,
        keywords: 'new create profile add',
        perform: () => {
          navigate('/profiles')
          openEditor('create', null)
        }
      },
      {
        id: 'act-show-shortcuts',
        kind: 'action',
        label: 'Keyboard shortcuts',
        hint: 'Show ? help dialog',
        icon: <Keyboard className="h-4 w-4" />,
        keywords: 'help shortcuts keyboard keys',
        perform: showShortcuts
      },
      {
        id: 'act-settings-browsers',
        kind: 'action',
        label: 'Download a browser',
        hint: 'Chromium / Chrome / Firefox',
        icon: <Download className="h-4 w-4" />,
        keywords: 'download browser chrome chromium firefox install',
        perform: () => navigate('/settings')
      },
      {
        id: 'act-settings-data',
        kind: 'action',
        label: 'Export / Import database',
        hint: 'Backup or restore all data',
        icon: <Upload className="h-4 w-4" />,
        keywords: 'backup export import data database restore',
        perform: () => navigate('/settings')
      }
    ]

    // Top profiles by recency so "launch <name>" queries feel fast.
    const recentProfiles = [...profiles]
      .sort((a, b) => {
        const aDate = a.last_used ?? a.updated_at ?? a.created_at
        const bDate = b.last_used ?? b.updated_at ?? b.created_at
        return bDate.localeCompare(aDate)
      })
      .slice(0, 25)

    for (const p of recentProfiles) {
      base.push({
        id: `profile-${p.id}`,
        kind: 'profile',
        label: `Launch ${p.name}`,
        hint: p.status === 'running' ? 'Already running' : p.browser_type,
        icon: <PlayCircle className="h-4 w-4" />,
        keywords: `launch open profile ${p.name.toLowerCase()} ${p.browser_type} ${(p.tags || '').toLowerCase()}`,
        perform: () => {
          if (p.status === 'running' || p.status === 'starting') {
            openEditor('edit', p.id)
          } else {
            void launchBrowser(p.id)
          }
        }
      })
      base.push({
        id: `profile-edit-${p.id}`,
        kind: 'profile',
        label: `Edit ${p.name}`,
        hint: p.browser_type,
        icon: <LayoutGrid className="h-4 w-4" />,
        keywords: `edit profile ${p.name.toLowerCase()}`,
        perform: () => {
          navigate('/profiles')
          openEditor('edit', p.id)
        }
      })
    }

    return base
  }, [navigate, openEditor, launchBrowser, profiles, showShortcuts])

  // Filter + rank. Empty query surfaces the full base set in listed order.
  const results = useMemo<Command[]>(() => {
    if (!query.trim()) return commands
    const scored = commands
      .map((c) => ({ c, score: rank(c, query.trim()) }))
      .filter(({ score }) => score < 99)
      .sort((a, b) => a.score - b.score)
    return scored.map(({ c }) => c)
  }, [commands, query])

  // Clamp selected index whenever results change.
  useEffect(() => {
    if (selected >= results.length) setSelected(Math.max(0, results.length - 1))
  }, [results, selected])

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => (results.length === 0 ? 0 : (i + 1) % results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = results[selected]
      if (cmd) {
        hide()
        // Defer perform so the palette fully closes before a navigation /
        // dialog opens that would otherwise fight for focus with our input.
        setTimeout(() => cmd.perform(), 0)
      }
    }
  }

  if (!open) return null

  const KIND_LABEL: Record<CommandKind, string> = {
    navigate: 'Navigate',
    action: 'Actions',
    profile: 'Profiles'
  }

  // Group adjacent results by kind for visual structure. Preserve ranked
  // ordering across groups when query is active.
  const sections: { kind: CommandKind; items: { cmd: Command; idx: number }[] }[] = []
  results.forEach((cmd, idx) => {
    const last = sections[sections.length - 1]
    if (!last || last.kind !== cmd.kind) {
      sections.push({ kind: cmd.kind, items: [{ cmd, idx }] })
    } else {
      last.items.push({ cmd, idx })
    }
  })

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-start justify-center p-4 pt-[16vh]"
      onClick={(e) => {
        // Click-outside to close (but clicks inside the card bubble up to
        // stopPropagation below, so this only fires for the backdrop).
        if (e.target === e.currentTarget) hide()
      }}
    >
      <div className="absolute inset-0 bg-surface/60 backdrop-blur-sm animate-fadeIn" />
      <div
        role="dialog"
        aria-modal
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-[--radius-xl] bg-card border border-edge shadow-2xl overflow-hidden animate-scaleIn"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-edge/50">
          <Search className="h-4 w-4 text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search profiles…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-[14px] text-content placeholder:text-muted/60 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded-[--radius-sm] border border-edge bg-surface text-[10px] font-mono text-muted">
            Esc
          </kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              No matches for <span className="font-mono text-content/80">&ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            sections.map((section) => (
              <div key={`${section.kind}-${section.items[0].idx}`}>
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                  {KIND_LABEL[section.kind]}
                </div>
                {section.items.map(({ cmd, idx }) => (
                  <button
                    key={cmd.id}
                    data-cmd-idx={idx}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => {
                      hide()
                      setTimeout(() => cmd.perform(), 0)
                    }}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                      idx === selected
                        ? 'bg-accent/12 text-content'
                        : 'text-content hover:bg-elevated'
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-7 w-7 shrink-0 rounded-[--radius-md] flex items-center justify-center',
                        idx === selected ? 'bg-accent/15 text-accent' : 'bg-elevated text-muted'
                      ].join(' ')}
                    >
                      {cmd.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="block text-[11px] text-muted truncate">{cmd.hint}</span>
                      )}
                    </span>
                    {idx === selected && (
                      <kbd className="shrink-0 px-1.5 py-0.5 rounded-[--radius-sm] border border-edge bg-surface text-[10px] font-mono text-muted">
                        ↵
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-edge/50 bg-surface-alt/50 text-[10px] text-muted font-mono">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-edge bg-surface">↑</kbd>
            <kbd className="px-1 py-0.5 rounded border border-edge bg-surface">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-edge bg-surface">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-edge bg-surface">Esc</kbd>
            close
          </span>
          <span className="ml-auto">{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}
