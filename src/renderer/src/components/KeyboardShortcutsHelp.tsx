import { useEffect } from 'react'
import { create } from 'zustand'
import { Modal } from './ui/Modal'
import { Keyboard } from 'lucide-react'

interface KeyboardShortcutsStore {
  open: boolean
  show: () => void
  hide: () => void
  toggle: () => void
}

/** Tiny store so the sidebar hint button and the `?` key can share state
 *  without synthetic keyboard events. */
export const useKeyboardShortcutsStore = create<KeyboardShortcutsStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open }))
}))

interface Shortcut {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

// Centralised registry of keyboard shortcuts. Keep in sync with
// the actual handlers in ProfilesPage.tsx / ProxiesPage.tsx / etc.
const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { keys: ['Ctrl', 'K'], description: 'Open command palette (navigate, launch, search profiles)' },
      { keys: ['?'], description: 'Open this keyboard shortcuts dialog' },
      { keys: ['Esc'], description: 'Close dialogs / editors / clear selection' }
    ]
  },
  {
    title: 'Profiles',
    items: [
      { keys: ['Ctrl', 'N'], description: 'New profile' },
      { keys: ['Ctrl', 'F'], description: 'Focus search' },
      { keys: ['/'], description: 'Focus search (alternate)' },
      { keys: ['Shift', 'Click'], description: 'Range-select profiles in the table' },
      { keys: ['Double-click'], description: 'Launch profile (when idle)' }
    ]
  },
  {
    title: 'Editor',
    items: [
      { keys: ['Esc'], description: 'Close the editor panel (prompts if unsaved)' }
    ]
  }
]

/**
 * Detect whether the user is typing in an editable element so we don't
 * hijack the `?` key while they're writing a proxy URL or a profile name.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export function KeyboardShortcutsHelp(): React.JSX.Element {
  const open = useKeyboardShortcutsStore((s) => s.open)
  const toggle = useKeyboardShortcutsStore((s) => s.toggle)
  const hide = useKeyboardShortcutsStore((s) => s.hide)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Shift+? (the key produced by Shift+Slash on most layouts).
      // Ignore while typing; also ignore when another modal has focus.
      if (e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggle])

  return (
    <Modal
      open={open}
      onClose={hide}
      title="Keyboard shortcuts"
      description="Press ? anywhere outside an input to toggle this dialog."
      size="md"
      elevated
    >
      <div className="space-y-5">
        {SHORTCUTS.map((group) => (
          <div key={group.title}>
            <h3 className="text-[11px] font-semibold text-muted/80 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Keyboard className="h-3.5 w-3.5" />
              {group.title}
            </h3>
            <ul className="divide-y divide-edge/40 rounded-[--radius-md] border border-edge/60 bg-surface/60">
              {group.items.map((s, i) => (
                <li
                  key={`${group.title}-${i}`}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-[13px] text-content leading-snug">{s.description}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {s.keys.map((k, j) => (
                      <kbd
                        key={`${k}-${j}`}
                        className="min-w-[24px] px-1.5 py-0.5 rounded-[--radius-sm] bg-elevated border border-edge text-[11px] font-mono text-content/90 text-center shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
