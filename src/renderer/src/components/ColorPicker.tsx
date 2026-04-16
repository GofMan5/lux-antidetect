import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type RGBA,
  type HSVA,
  rgbaToHex,
  rgbaToHsva,
  hsvaToRgba,
  parseColor,
  rgbaToString
} from '../lib/themes'
import { cn } from '../lib/utils'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  label?: string
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function useDrag(
  onMove: (x: number, y: number, rect: DOMRect) => void,
  onEnd?: () => void
) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])

  const handle = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const x = clamp(e.clientX - rect.left, 0, rect.width)
      const y = clamp(e.clientY - rect.top, 0, rect.height)
      onMove(x, y, rect)
    },
    [onMove]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      handle(e)
      const move = (ev: MouseEvent) => { if (dragging.current) handle(ev) }
      const up = () => {
        dragging.current = false
        cleanupRef.current = null
        onEnd?.()
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
      cleanupRef.current = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
      }
    },
    [handle, onEnd]
  )

  return { ref, onMouseDown }
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps): React.JSX.Element {
  const rgba = parseColor(value)
  const [hsva, setHsva] = useState<HSVA>(() => rgbaToHsva(rgba))
  const [inputHex, setInputHex] = useState(rgbaToHex(rgba))
  const [inputMode, setInputMode] = useState<'hex' | 'rgba'>('hex')

  // Sync external value changes
  const prevValue = useRef(value)
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value
      const c = parseColor(value)
      setHsva(rgbaToHsva(c))
      setInputHex(rgbaToHex(c))
    }
  }, [value])

  const emitColor = useCallback(
    (h: HSVA) => {
      const c = hsvaToRgba(h)
      const hex = rgbaToHex(c)
      prevValue.current = hex
      setInputHex(hex)
      onChange(hex)
    },
    [onChange]
  )

  const updateHsva = useCallback((partial: Partial<HSVA>) => {
    setHsva(prev => {
      const next = { ...prev, ...partial }
      emitColor(next)
      return next
    })
  }, [emitColor])

  // Saturation-Value palette
  const palette = useDrag(
    useCallback((x, y, rect) => {
      updateHsva({ s: (x / rect.width) * 100, v: 100 - (y / rect.height) * 100 })
    }, [updateHsva])
  )

  // Hue slider
  const hueSlider = useDrag(
    useCallback((x, _y, rect) => {
      updateHsva({ h: (x / rect.width) * 360 })
    }, [updateHsva])
  )

  // Alpha slider
  const alphaSlider = useDrag(
    useCallback((x, _y, rect) => {
      updateHsva({ a: Math.round((x / rect.width) * 100) / 100 })
    }, [updateHsva])
  )

  const currentRgba = hsvaToRgba(hsva)
  const pureHueRgb = hsvaToRgba({ h: hsva.h, s: 100, v: 100, a: 1 })
  const pureHueStr = `rgb(${pureHueRgb.r}, ${pureHueRgb.g}, ${pureHueRgb.b})`

  const handleHexInput = (v: string) => {
    setInputHex(v)
    if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
      const c = parseColor(v)
      const h = rgbaToHsva(c)
      setHsva(h)
      prevValue.current = v
      onChange(v)
    }
  }

  const handleRgbaInput = (key: keyof RGBA, val: string) => {
    const n = parseFloat(val)
    if (isNaN(n)) return
    const clamped = key === 'a' ? clamp(n, 0, 1) : clamp(Math.round(n), 0, 255)
    const newRgba: RGBA = { ...currentRgba, [key]: clamped }
    const h = rgbaToHsva(newRgba)
    setHsva(h)
    emitColor(h)
  }

  const SWATCHES = [
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#6366f1',
    '#09090b', '#1a1a22', '#71717a', '#ececef', '#ffffff'
  ]

  return (
    <div className="w-[272px] rounded-[--radius-lg] border border-edge bg-card shadow-2xl shadow-black/50 overflow-hidden">
      {label && (
        <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted">{label}</div>
      )}

      {/* SV Palette */}
      <div
        ref={palette.ref}
        onMouseDown={palette.onMouseDown}
        className="relative h-[180px] mx-3 mt-2 rounded-[--radius-md] cursor-crosshair overflow-hidden select-none"
        style={{ backgroundColor: pureHueStr }}
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, white, transparent)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent, black)' }} />
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-lg shadow-black/50 -translate-x-1/2 -translate-y-1/2 pointer-events-none ring-1 ring-black/20"
          style={{ left: `${hsva.s}%`, top: `${100 - hsva.v}%`, backgroundColor: rgbaToString(currentRgba) }}
        />
      </div>

      {/* Hue slider */}
      <div className="px-3 mt-3">
        <div
          ref={hueSlider.ref}
          onMouseDown={hueSlider.onMouseDown}
          className="relative h-3 rounded-full cursor-pointer select-none"
          style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        >
          <div
            className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-lg shadow-black/50 -translate-x-1/2 -translate-y-1/2 pointer-events-none ring-1 ring-black/20"
            style={{ left: `${(hsva.h / 360) * 100}%`, backgroundColor: pureHueStr }}
          />
        </div>
      </div>

      {/* Alpha slider */}
      <div className="px-3 mt-2">
        <div
          ref={alphaSlider.ref}
          onMouseDown={alphaSlider.onMouseDown}
          className="relative h-3 rounded-full cursor-pointer select-none"
          style={{
            background: `linear-gradient(to right, transparent, ${rgbaToString({ ...currentRgba, a: 1 })}),
              repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 8px 8px`
          }}
        >
          <div
            className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-lg shadow-black/50 -translate-x-1/2 -translate-y-1/2 pointer-events-none ring-1 ring-black/20"
            style={{ left: `${hsva.a * 100}%`, backgroundColor: rgbaToString(currentRgba) }}
          />
        </div>
      </div>

      {/* Color preview + inputs */}
      <div className="px-3 mt-3 flex items-center gap-2">
        {/* Preview swatch */}
        <div
          className="w-10 h-10 rounded-[--radius-md] border border-edge shrink-0 overflow-hidden"
          style={{
            background: 'repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 8px 8px'
          }}
        >
          <div className="w-full h-full" style={{ backgroundColor: rgbaToString(currentRgba) }} />
        </div>

        <div className="flex-1 min-w-0">
          {inputMode === 'hex' ? (
            <input
              type="text"
              value={inputHex}
              onChange={(e) => handleHexInput(e.target.value)}
              spellCheck={false}
              className="w-full h-8 rounded-[--radius-sm] border border-edge bg-surface px-2 text-xs font-mono text-content focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent/50"
            />
          ) : (
            <div className="flex gap-1">
              {(['r', 'g', 'b', 'a'] as const).map((ch) => (
                <div key={ch} className="flex-1 min-w-0">
                  <input
                    type="number"
                    min={ch === 'a' ? 0 : 0}
                    max={ch === 'a' ? 1 : 255}
                    step={ch === 'a' ? 0.01 : 1}
                    value={ch === 'a' ? currentRgba.a : currentRgba[ch]}
                    onChange={(e) => handleRgbaInput(ch, e.target.value)}
                    className="w-full h-8 rounded-[--radius-sm] border border-edge bg-surface px-1 text-[10px] font-mono text-content text-center focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent/50"
                  />
                  <div className="text-[9px] text-muted text-center mt-0.5">{ch.toUpperCase()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setInputMode(inputMode === 'hex' ? 'rgba' : 'hex')}
          className={cn(
            'text-[9px] font-bold shrink-0 px-1.5 py-1 rounded-[--radius-sm] transition-colors',
            'text-muted hover:text-content hover:bg-elevated'
          )}
          title="Toggle HEX/RGBA"
        >
          {inputMode === 'hex' ? 'RGBA' : 'HEX'}
        </button>
      </div>

      {/* Swatches */}
      <div className="px-3 mt-3 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {SWATCHES.map((sw) => (
            <button
              key={sw}
              onClick={() => {
                const c = parseColor(sw)
                const h = rgbaToHsva(c)
                setHsva(h)
                emitColor(h)
              }}
              className={cn(
                'w-5 h-5 rounded-[--radius-sm] border border-white/10 transition-all',
                'hover:scale-110 hover:border-white/25 active:scale-95'
              )}
              style={{ backgroundColor: sw }}
              title={sw}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
