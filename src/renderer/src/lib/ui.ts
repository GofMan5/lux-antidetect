// Shared UI primitives for the Champagne Noir design system.
//
// Conventions:
//   - 36px standard control height (compact-but-readable density)
//   - 8px radius for inputs / buttons, 12px for cards (--radius-lg)
//   - Gold accent on primary actions; ghost / outline elsewhere
//   - Single easing curve (`var(--ease-osmosis)` set in index.css) — all
//     transitions feel the same regardless of which class triggered them
//   - No glow on idle; gold halo on focus only

const TRANS = 'transition-all duration-150 ease-[var(--ease-osmosis)]'

// ─── Buttons ──────────────────────────────────────────────────────────────

export const BTN_BASE =
  `h-9 px-3.5 rounded-[--radius-md] text-sm font-medium ${TRANS} cursor-pointer select-none ` +
  'inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none'

// Primary — champagne gold solid with dark text. Premium feel via inset
// top highlight; press state subtly settles.
export const BTN_PRIMARY =
  `${BTN_BASE} bg-accent text-[#1a1612] hover:bg-accent-dim active:translate-y-[0.5px] ` +
  'shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_2px_8px_rgba(212,176,117,0.18)]'

// Secondary — neutral with edge border. Hovers to elevated, never pulses.
export const BTN_SECONDARY =
  `${BTN_BASE} bg-elevated/60 text-content border border-edge ` +
  'hover:bg-elevated hover:border-edge/80 active:translate-y-[0.5px]'

// Danger — muted dusty rose, not screaming red.
export const BTN_DANGER =
  `${BTN_BASE} bg-err/8 text-err border border-err/25 ` +
  'hover:bg-err/15 hover:border-err/40 active:translate-y-[0.5px]'

// Ghost — for tertiary actions (cancel, dismiss, "show more")
export const BTN_GHOST =
  `${BTN_BASE} text-muted hover:text-content hover:bg-elevated/60 active:translate-y-[0.5px]`

// Icon-only button — same treatment as ghost, square footprint
export const BTN_ICON =
  `h-9 w-9 p-0 rounded-[--radius-md] inline-flex items-center justify-center ` +
  `text-muted hover:text-content hover:bg-elevated/60 ${TRANS} ` +
  'cursor-pointer disabled:opacity-40 disabled:pointer-events-none'

// ─── Inputs ───────────────────────────────────────────────────────────────

export const INPUT =
  `h-9 w-full px-3 rounded-[--radius-md] bg-surface/60 border border-edge ` +
  `text-sm text-content placeholder:text-muted/60 ${TRANS} ` +
  'hover:border-edge/80 focus:outline-none focus:border-accent/60 focus:bg-surface ' +
  'focus:ring-[3px] focus:ring-accent/15'

export const SELECT =
  `h-9 w-full px-3 rounded-[--radius-md] bg-surface/60 border border-edge ` +
  `text-sm text-content ${TRANS} ` +
  'hover:border-edge/80 focus:outline-none focus:border-accent/60 focus:bg-surface ' +
  'focus:ring-[3px] focus:ring-accent/15 appearance-none cursor-pointer'

export const TEXTAREA =
  `w-full px-3 py-2 rounded-[--radius-md] bg-surface/60 border border-edge ` +
  `text-sm text-content placeholder:text-muted/60 ${TRANS} ` +
  'hover:border-edge/80 focus:outline-none focus:border-accent/60 focus:bg-surface ' +
  'focus:ring-[3px] focus:ring-accent/15 resize-none'

export const CHECKBOX =
  'h-4 w-4 rounded-[--radius-sm] border-edge bg-surface/60 accent-accent cursor-pointer'

// ─── Layout / Cards ───────────────────────────────────────────────────────

// Card with the "lit from above" surface treatment + soft drop. The
// `surface-lit` utility (defined in index.css) adds a 24px-tall white
// gradient at the very top of the card — gives it the felt sense of
// being a real layered object, not a flat colored rectangle.
export const CARD =
  'rounded-[--radius-lg] bg-card border border-edge/80 p-5 surface-lit ' +
  'shadow-[var(--shadow-sm)]'

export const CARD_HEADER =
  'flex items-center justify-between mb-4'

// Card variant for elevated dialogs / modals — bigger drop shadow.
export const CARD_FLOATING =
  'rounded-[--radius-lg] bg-card border border-edge p-5 surface-lit ' +
  'shadow-[var(--shadow-lg)]'

export const SECTION = 'space-y-4'

export const DIVIDER = 'h-px bg-edge'

// ─── Badges ───────────────────────────────────────────────────────────────

export const BADGE =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-none'

export const BADGE_OK = `${BADGE} bg-ok/12 text-ok ring-1 ring-inset ring-ok/15`

export const BADGE_WARN = `${BADGE} bg-warn/12 text-warn ring-1 ring-inset ring-warn/15`

export const BADGE_ERR = `${BADGE} bg-err/12 text-err ring-1 ring-inset ring-err/15`

export const BADGE_ACCENT = `${BADGE} bg-accent/10 text-accent ring-1 ring-inset ring-accent/20`

export const BADGE_NEUTRAL = `${BADGE} bg-elevated text-muted ring-1 ring-inset ring-edge`

// ─── Labels ───────────────────────────────────────────────────────────────

export const LABEL =
  'block text-xs font-medium text-content mb-1.5'

export const LABEL_MUTED =
  'block text-xs font-medium text-muted mb-1.5'

// Section header — small caps style, used to group related fields
export const SECTION_HEADER =
  'text-[10.5px] font-semibold text-muted/80 uppercase tracking-[0.08em]'

// ─── Misc ─────────────────────────────────────────────────────────────────

export const TOOLTIP =
  'px-2.5 py-1.5 rounded-[--radius-md] bg-elevated border border-edge/80 ' +
  'text-xs text-content shadow-[var(--shadow-md)]'

export const OVERLAY =
  'fixed inset-0 bg-surface/70 backdrop-blur-[6px]'

export const FOCUS_RING =
  'focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15'

// ─── Backward-compat aliases (do not use in new code) ─────────────────────

/** @deprecated Use INPUT */
export const INPUT_CLASS = INPUT
/** @deprecated Use SELECT */
export const SELECT_CLASS = SELECT
/** @deprecated Use CHECKBOX */
export const CHECKBOX_CLASS = CHECKBOX
/** @deprecated Use LABEL */
export const LABEL_CLASS = LABEL
/** @deprecated Use TEXTAREA */
export const TEXTAREA_CLASS = TEXTAREA
/** @deprecated Use CARD */
export const CARD_CLASS = CARD
