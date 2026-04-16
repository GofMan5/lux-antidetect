import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Copy, ClipboardPaste, RotateCcw, ChevronDown, ChevronRight, Save, Pencil } from 'lucide-react'
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
import { BTN_PRIMARY, BTN_SECONDARY } from '../lib/ui'
import { useSettingsStore } from '../stores/settings'
import { useToastStore } from './Toast'

const DEFAULT_CUSTOM_COLORS: ThemeColors = { ...THEME_PRESETS[0].colors }

interface ThemeEditorProps {
  editingTheme?: Theme | null
  onClose: () => void
}

export function ThemeEditor({ editingTheme, onClose }: ThemeEditorProps): React.JSX.Element {
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(COLOR_GROUPS.map(g => g.label)))
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Store original theme to restore on cancel
  const originalThemeRef = useRef(activeThemeId)
  useEffect(() => {
    originalThemeRef.current = activeThemeId
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview — apply colors as they change; restore on unmount
  useEffect(() => {
    const previewTheme: Theme = { id: '__preview__', name: 'Preview', colors }
    applyTheme(previewTheme)
    return () => {
      // Restore original theme when component unmounts (e.g. navigation away)
      const real = findTheme(originalThemeRef.current, customThemes) ?? getDefaultTheme()
      applyTheme(real)
    }
  }, [colors]) // eslint-disable-line react-hooks/exhaustive-deps

  // On close/cancel — restore the real active theme
  const handleCancel = useCallback(() => {
    const real = findTheme(originalThemeRef.current, customThemes) ?? getDefaultTheme()
    applyTheme(real)
    onClose()
  }, [customThemes, onClose])

  const handleSave = () => {
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
    onClose()
  }

  const setColor = (key: keyof ThemeColors, value: string) => {
    setColors(prev => ({ ...prev, [key]: value }))
  }

  const handleExport = () => {
    const data = JSON.stringify({ name, colors }, null, 2)
    navigator.clipboard.writeText(data)
    addToast('Theme copied to clipboard', 'success')
  }

  const handleImport = async () => {
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

  const openPicker = (key: keyof ThemeColors) => {
    if (activeColor === key) { setActiveColor(null); return }
    const btn = triggerRefs.current.get(key)
    if (btn) {
      const rect = btn.getBoundingClientRect()
      const pickerH = 380
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow < pickerH ? Math.max(8, rect.top - pickerH - 4) : rect.bottom + 4
      setPickerPos({ top, left: rect.left })
    }
    setActiveColor(key)
  }

  const handleResetGroup = (keys: (keyof ThemeColors)[]) => {
    const base = editingTheme?.colors ?? DEFAULT_CUSTOM_COLORS
    setColors(prev => {
      const next = { ...prev }
      for (const k of keys) next[k] = base[k]
      return next
    })
  }

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setActiveColor(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="rounded-xl border border-edge bg-card overflow-hidden animate-scaleIn">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-elevated/30">
        <div className="flex items-center gap-2">
          {isEditing ? <Pencil className="h-4 w-4 text-accent" /> : <Save className="h-4 w-4 text-accent" />}
          <h3 className="text-sm font-semibold text-content">
            {isEditing ? 'Edit Theme' : 'Create Theme'}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleExport} className="p-1.5 rounded-lg text-muted hover:text-content hover:bg-elevated transition-all" title="Copy theme JSON">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleImport} className="p-1.5 rounded-lg text-muted hover:text-content hover:bg-elevated transition-all" title="Paste theme JSON">
            <ClipboardPaste className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleCancel} className="p-1.5 rounded-lg text-muted hover:text-err hover:bg-err/10 transition-all" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-0 divide-x divide-edge">
        {/* Left: color editor */}
        <div className="flex-1 p-4 space-y-3 max-h-[480px] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-medium text-muted mb-1">Theme Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Theme"
              className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Base theme selector */}
          <div>
            <label className="block text-[11px] font-medium text-muted mb-1">Start from preset</label>
            <div className="flex gap-1.5 flex-wrap">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setColors({ ...preset.colors })}
                  className="flex items-center gap-1.5 rounded-lg border border-edge hover:border-accent/40 px-2 py-1 text-[10px] text-muted hover:text-content transition-all"
                >
                  <div className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: preset.colors.accent }} />
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Grouped color editors */}
          {COLOR_GROUPS.map((group) => (
            <div key={group.label} className="rounded-lg border border-edge/60 overflow-hidden">
              <button
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center justify-between px-3 py-2 bg-elevated/20 hover:bg-elevated/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {expandedGroups.has(group.label) ? (
                    <ChevronDown className="h-3 w-3 text-muted" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted" />
                  )}
                  <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">{group.label}</span>
                </div>
                <div className="flex gap-1">
                  {group.keys.map((k) => (
                    <div key={k} className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: colors[k] }} />
                  ))}
                </div>
              </button>

              {expandedGroups.has(group.label) && (
                <div className="px-3 py-2 space-y-1.5">
                  {group.keys.map((key) => (
                    <div key={key}>
                      <button
                        ref={(el) => { if (el) triggerRefs.current.set(key, el); else triggerRefs.current.delete(key) }}
                        onClick={() => openPicker(key)}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                          activeColor === key ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-elevated/40'
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-md border border-white/10 shrink-0 shadow-sm"
                          style={{ backgroundColor: colors[key] }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-content">{COLOR_LABELS[key]}</div>
                          <div className="text-[10px] font-mono text-muted">{colors[key]}</div>
                        </div>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => handleResetGroup(group.keys)}
                    className="flex items-center gap-1 text-[10px] text-muted hover:text-content transition-colors mt-1 px-2"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Reset group
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: live preview */}
        <div className="w-[260px] shrink-0 p-4 flex flex-col gap-3 bg-surface/50">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">Preview</div>

          {/* Mini app preview */}
          <div
            className="rounded-xl border overflow-hidden shadow-lg text-[10px]"
            style={{ borderColor: colors.edge, backgroundColor: colors.surface }}
          >
            {/* Mini sidebar + content */}
            <div className="flex h-[260px]">
              {/* Sidebar */}
              <div className="w-[52px] shrink-0 flex flex-col border-r" style={{ backgroundColor: colors.surfaceAlt, borderColor: colors.edge }}>
                <div className="h-6 flex items-center justify-center border-b" style={{ borderColor: colors.edge }}>
                  <div className="w-4 h-4 rounded-md flex items-center justify-center" style={{ backgroundColor: colors.accent + '26' }}>
                    <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.accent }} />
                  </div>
                </div>
                <div className="flex flex-col gap-1 p-1.5 flex-1">
                  <div className="rounded-md px-1.5 py-1 flex items-center gap-1" style={{ backgroundColor: colors.accent + '26' }}>
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors.accent }} />
                    <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: colors.accent, opacity: 0.7 }} />
                  </div>
                  {[1, 2].map((i) => (
                    <div key={i} className="rounded-md px-1.5 py-1 flex items-center gap-1">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors.muted }} />
                      <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: colors.muted, opacity: 0.3 }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Main content area */}
              <div className="flex-1 p-2 overflow-hidden min-w-0">
                {/* Header row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: colors.content }} />
                  <div className="h-4 px-2 rounded-md flex items-center" style={{ backgroundColor: colors.accent }}>
                    <span className="text-[7px] font-bold" style={{ color: '#fff' }}>Button</span>
                  </div>
                </div>

                {/* Cards */}
                <div className="space-y-1.5">
                  {[
                    { status: colors.ok, label: 'Running' },
                    { status: colors.warn, label: 'Pending' },
                    { status: colors.err, label: 'Error' }
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="rounded-lg border p-1.5 flex items-center gap-1.5"
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

                {/* Input preview */}
                <div className="mt-2 space-y-1">
                  <div
                    className="rounded-md border px-1.5 py-1 flex items-center"
                    style={{ backgroundColor: colors.surface, borderColor: colors.edge }}
                  >
                    <span className="text-[7px]" style={{ color: colors.muted }}>Search...</span>
                  </div>
                  <div className="flex gap-1">
                    <div className="h-3 flex-1 rounded-md" style={{ backgroundColor: colors.elevated }} />
                    <div className="h-3 flex-1 rounded-md" style={{ backgroundColor: colors.elevated }} />
                  </div>
                </div>

                {/* Accent badges */}
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

          {/* Color palette overview */}
          <div className="grid grid-cols-6 gap-1">
            {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((key) => (
              <button
                key={key}
                onClick={() => openPicker(key)}
                className={`w-full aspect-square rounded-lg border transition-all ${
                  activeColor === key ? 'ring-2 ring-accent scale-110 z-10' : 'border-white/10 hover:scale-105'
                }`}
                style={{ backgroundColor: colors[key] }}
                title={COLOR_LABELS[key]}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge bg-elevated/20">
        <button onClick={handleCancel} className={BTN_SECONDARY + ' text-xs'}>Cancel</button>
        <button onClick={handleSave} className={BTN_PRIMARY + ' text-xs'}>
          {isEditing ? 'Save Changes' : 'Create Theme'}
        </button>
      </div>

      {/* ColorPicker portal — renders above everything */}
      {activeColor && createPortal(
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
    </div>
  )
}
