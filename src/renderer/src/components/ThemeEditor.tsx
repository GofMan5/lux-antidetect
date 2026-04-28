import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Copy, ClipboardPaste, RotateCcw } from 'lucide-react'
import { ColorPicker } from './ColorPicker'
import {
  type Theme,
  type ThemeColors,
  COLOR_LABELS,
  COLOR_GROUPS,
  THEME_PRESETS,
  applyTheme,
  getDefaultTheme,
  findTheme
} from '../lib/themes'
import { useSettingsStore } from '../stores/settings'
import { useToastStore } from './Toast'
import { cn } from '../lib/utils'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const DEFAULT_CUSTOM_COLORS: ThemeColors = { ...THEME_PRESETS[0].colors }

interface ThemeEditorProps {
  open: boolean
  editingTheme?: Theme | null
  onClose: () => void
}

export function ThemeEditor({ open, editingTheme, onClose }: ThemeEditorProps): React.JSX.Element {
  const addCustomTheme = useSettingsStore((s) => s.addCustomTheme)
  const updateCustomTheme = useSettingsStore((s) => s.updateCustomTheme)
  const setActiveTheme = useSettingsStore((s) => s.setActiveTheme)
  const activeThemeId = useSettingsStore((s) => s.activeThemeId)
  const customThemes = useSettingsStore((s) => s.customThemes)
  const addToast = useToastStore((s) => s.addToast)

  const isEditing = !!editingTheme
  const [name, setName] = useState(editingTheme?.name ?? '')
  const [colors, setColors] = useState<ThemeColors>(editingTheme?.colors ? { ...editingTheme.colors } : { ...DEFAULT_CUSTOM_COLORS })
  const [activeColor, setActiveColor] = useState<keyof ThemeColors | null>(null)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Reset state when opening with a different theme
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      setName(editingTheme?.name ?? '')
      setColors(editingTheme?.colors ? { ...editingTheme.colors } : { ...DEFAULT_CUSTOM_COLORS })
      setActiveColor(null)
    })
    return () => cancelAnimationFrame(id)
  }, [open, editingTheme])

  // Store original theme to restore on cancel
  const originalThemeRef = useRef(activeThemeId)
  useEffect(() => {
    if (open) originalThemeRef.current = activeThemeId
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether the user explicitly saved (skip restore on cleanup)
  const savedRef = useRef(false)

  // Live preview — apply colors as they change; restore on unmount
  useEffect(() => {
    if (!open) return
    const previewTheme: Theme = { id: '__preview__', name: 'Preview', colors }
    applyTheme(previewTheme)
    return () => {
      if (savedRef.current) { savedRef.current = false; return }
      const latestCustomThemes = useSettingsStore.getState().customThemes
      const real = findTheme(originalThemeRef.current, latestCustomThemes) ?? getDefaultTheme()
      applyTheme(real)
    }
  }, [colors, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = useCallback(() => {
    const real = findTheme(originalThemeRef.current, customThemes) ?? getDefaultTheme()
    applyTheme(real)
    onClose()
  }, [customThemes, onClose])

  const handleSave = (): void => {
    if (!name.trim()) {
      addToast('Theme name is required', 'error')
      return
    }
    if (isEditing && editingTheme) {
      const updated: Theme = { ...editingTheme, name: name.trim(), colors: { ...colors } }
      updateCustomTheme(updated)
      addToast('Theme updated', 'success')
    } else {
      const theme: Theme = {
        id: `custom-${Date.now()}`,
        name: name.trim(),
        colors: { ...colors },
        isCustom: true
      }
      addCustomTheme(theme)
      setActiveTheme(theme.id)
      addToast('Theme created', 'success')
    }
    savedRef.current = true
    onClose()
  }

  const setColor = (key: keyof ThemeColors, value: string): void => {
    setColors(prev => ({ ...prev, [key]: value }))
  }

  const handleExport = (): void => {
    const data = JSON.stringify({ name, colors }, null, 2)
    navigator.clipboard.writeText(data)
    addToast('Theme copied to clipboard', 'success')
  }

  const handleImport = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      const data = JSON.parse(text) as { name?: string; colors?: Partial<ThemeColors> }
      if (data.colors) {
        setColors(prev => ({ ...prev, ...data.colors }))
        if (data.name) setName(data.name)
        addToast('Theme imported from clipboard', 'success')
      }
    } catch {
      addToast('Invalid theme data in clipboard', 'error')
    }
  }

  const openPicker = (key: keyof ThemeColors): void => {
    if (activeColor === key) { setActiveColor(null); return }
    const btn = triggerRefs.current.get(key)
    if (btn) {
      const rect = btn.getBoundingClientRect()
      const pickerH = 420
      const pickerW = 290
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow < pickerH ? Math.max(8, rect.top - pickerH - 4) : rect.bottom + 4
      const left = Math.min(rect.left, window.innerWidth - pickerW - 8)
      setPickerPos({ top, left })
    }
    setActiveColor(key)
  }

  const handleResetGroup = (keys: (keyof ThemeColors)[]): void => {
    const base = editingTheme?.colors ?? DEFAULT_CUSTOM_COLORS
    setColors(prev => {
      const next = { ...prev }
      for (const k of keys) next[k] = base[k]
      return next
    })
  }

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setActiveColor(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <>
      <Modal
        open={open}
        onClose={handleCancel}
        title={isEditing ? 'Edit Theme' : 'Create Theme'}
        description="Customize colors for your theme. Changes preview live."
        size="lg"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleExport} icon={<Copy className="h-3.5 w-3.5" />}>
              Export
            </Button>
            <Button variant="ghost" size="sm" onClick={handleImport} icon={<ClipboardPaste className="h-3.5 w-3.5" />}>
              Import
            </Button>
            <div className="w-px h-5 bg-edge" />
            <Button variant="secondary" size="sm" onClick={handleCancel}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave}>
              {isEditing ? 'Save Changes' : 'Create Theme'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Theme name */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Theme Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Theme"
              className="max-w-xs"
            />
          </div>

          {/* Base theme selector */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Start from preset</label>
            <div className="flex gap-1.5 flex-wrap">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setColors({ ...preset.colors })}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[--radius-md] border px-2.5 py-1.5 text-[11px] transition-all',
                    'border-edge hover:border-accent/40 text-muted hover:text-content'
                  )}
                >
                  <div className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: preset.colors.accent }} />
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Color editor grid + preview */}
          <div className="flex gap-5">
            {/* Left: color grid */}
            <div className="flex-1 space-y-4">
              {COLOR_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">{group.label}</span>
                    <button
                      onClick={() => handleResetGroup(group.keys)}
                      className="flex items-center gap-1 text-[10px] text-muted hover:text-content transition-colors"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Reset
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.keys.map((key) => (
                      <button
                        key={key}
                        ref={(el) => { if (el) triggerRefs.current.set(key, el); else triggerRefs.current.delete(key) }}
                        onClick={() => openPicker(key)}
                        className={cn(
                          'flex items-center gap-2.5 rounded-[--radius-md] px-2.5 py-2 text-left transition-all border',
                          activeColor === key
                            ? 'border-accent/40 bg-accent/5 ring-1 ring-accent/20'
                            : 'border-edge/60 hover:border-edge hover:bg-elevated/30'
                        )}
                      >
                        <div
                          className="w-7 h-7 rounded-[--radius-sm] border border-white/10 shrink-0 shadow-sm"
                          style={{ backgroundColor: colors[key] }}
                        />
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-content">{COLOR_LABELS[key]}</div>
                          <div className="text-[10px] font-mono text-muted">{colors[key]}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Right: live preview */}
            <div className="w-[240px] shrink-0 space-y-3">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">Preview</div>

              <div
                className="rounded-[--radius-lg] border overflow-hidden shadow-lg text-[10px]"
                style={{ borderColor: colors.edge, backgroundColor: colors.surface }}
              >
                <div className="flex h-[240px]">
                  {/* Sidebar */}
                  <div className="w-[48px] shrink-0 flex flex-col border-r" style={{ backgroundColor: colors.surfaceAlt, borderColor: colors.edge }}>
                    <div className="h-6 flex items-center justify-center border-b" style={{ borderColor: colors.edge }}>
                      <div className="w-4 h-4 rounded-[--radius-sm] flex items-center justify-center" style={{ backgroundColor: colors.accent + '26' }}>
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.accent }} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 p-1.5 flex-1">
                      <div className="rounded-[--radius-sm] px-1.5 py-1 flex items-center gap-1" style={{ backgroundColor: colors.accent + '26' }}>
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors.accent }} />
                        <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: colors.accent, opacity: 0.7 }} />
                      </div>
                      {[1, 2].map((i) => (
                        <div key={i} className="rounded-[--radius-sm] px-1.5 py-1 flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors.muted }} />
                          <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: colors.muted, opacity: 0.3 }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-2 overflow-hidden min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: colors.content }} />
                      <div className="h-4 px-2 rounded-[--radius-sm] flex items-center" style={{ backgroundColor: colors.accent }}>
                        <span className="text-[7px] font-bold" style={{ color: '#fff' }}>Button</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {[
                        { status: colors.ok, label: 'Running' },
                        { status: colors.warn, label: 'Pending' },
                        { status: colors.err, label: 'Error' }
                      ].map((item, i) => (
                        <div
                          key={i}
                          className="rounded-[--radius-sm] border p-1.5 flex items-center gap-1.5"
                          style={{ backgroundColor: colors.card, borderColor: colors.edge }}
                        >
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: item.status }} />
                          <div className="flex-1 min-w-0">
                            <div className="h-1 w-14 rounded-full mb-0.5" style={{ backgroundColor: colors.content, opacity: 0.8 }} />
                            <div className="h-1 w-8 rounded-full" style={{ backgroundColor: colors.muted, opacity: 0.5 }} />
                          </div>
                          <span className="text-[7px] font-medium px-1 py-0.5 rounded" style={{ color: item.status, backgroundColor: item.status + '1a' }}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 space-y-1">
                      <div
                        className="rounded-[--radius-sm] border px-1.5 py-1 flex items-center"
                        style={{ backgroundColor: colors.surface, borderColor: colors.edge }}
                      >
                        <span className="text-[7px]" style={{ color: colors.muted }}>Search...</span>
                      </div>
                      <div className="flex gap-1">
                        <div className="h-3 flex-1 rounded-[--radius-sm]" style={{ backgroundColor: colors.elevated }} />
                        <div className="h-3 flex-1 rounded-[--radius-sm]" style={{ backgroundColor: colors.elevated }} />
                      </div>
                    </div>

                    <div className="flex gap-1 mt-2">
                      <div className="px-1.5 py-0.5 rounded-full text-[7px] font-medium" style={{ backgroundColor: colors.accent + '26', color: colors.accent }}>
                        Profile 1
                      </div>
                      <div className="px-1.5 py-0.5 rounded-full text-[7px] font-medium" style={{ backgroundColor: colors.accentDim + '26', color: colors.accentDim }}>
                        Profile 2
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Color palette grid overview */}
              <div className="grid grid-cols-6 gap-1.5">
                {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => openPicker(key)}
                    className={cn(
                      'w-full aspect-square rounded-[--radius-sm] border transition-all',
                      activeColor === key ? 'ring-2 ring-accent scale-110 z-10' : 'border-white/10 hover:scale-105'
                    )}
                    style={{ backgroundColor: colors[key] }}
                    title={COLOR_LABELS[key]}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ColorPicker portal */}
      {activeColor && open && createPortal(
        <div
          ref={pickerRef}
          className="fixed animate-fadeIn"
          style={{ top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}
        >
          <ColorPicker
            value={colors[activeColor]}
            onChange={(v) => setColor(activeColor, v)}
          />
        </div>,
        document.body
      )}
    </>
  )
}
