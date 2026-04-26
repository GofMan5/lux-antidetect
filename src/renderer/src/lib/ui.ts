// Shared UI primitives for the Vault design system.
//
// Conventions:
//   - 36px standard control height (compact-but-readable density)
//   - 6px radius for inputs / buttons (--radius-md), 10px for cards (--radius-lg)
//   - Electric blue (`primary`) on primary actions; ghost / outline elsewhere
//   - Single easing curve (`var(--ease-osmosis)` set in index.css) — all
//     transitions feel the same regardless of which class triggered them
//   - No glow on idle; blue halo on focus only
//   - Borders deliberately near-invisible (rgba(255,255,255,0.07)) so chrome
//     recedes and content carries the weight

const TRANS = 'transition-all duration-150 ease-[var(--ease-osmosis)]'

// ─── Buttons ──────────────────────────────────────────────────────────────

export const BTN_BASE =
  `h-9 px-3.5 rounded-[--radius-md] text-sm font-medium ${TRANS} cursor-pointer select-none ` +
  'inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none'

// Primary — electric blue solid with white text. Subtle inset top highlight,
// settles 0.5px on press.
export const BTN_PRIMARY =
  `${BTN_BASE} bg-primary text-primary-foreground hover:bg-accent-dim active:translate-y-[0.5px] ` +
  'shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_2px_8px_rgba(59,130,246,0.20)]'

// Secondary — neutral with edge border. Hovers to elevated, never pulses.
export const BTN_SECONDARY =
  `${BTN_BASE} bg-elevated/60 text-foreground border border-edge ` +
  'hover:bg-elevated hover:border-edge/80 active:translate-y-[0.5px]'

// Danger — muted red, not screaming.
export const BTN_DANGER =
  `${BTN_BASE} bg-destructive/8 text-destructive border border-destructive/25 ` +
  'hover:bg-destructive/15 hover:border-destructive/40 active:translate-y-[0.5px]'

// Ghost — for tertiary actions (cancel, dismiss, "show more")
export const BTN_GHOST =
  `${BTN_BASE} text-muted-foreground hover:text-foreground hover:bg-elevated/60 active:translate-y-[0.5px]`

// Icon-only button — same treatment as ghost, square footprint
export const BTN_ICON =
  `h-9 w-9 p-0 rounded-[--radius-md] inline-flex items-center justify-center ` +
  `text-muted-foreground hover:text-foreground hover:bg-elevated/60 ${TRANS} ` +
  'cursor-pointer disabled:opacity-40 disabled:pointer-events-none'

// ─── Inputs ───────────────────────────────────────────────────────────────

export const INPUT =
  `h-9 w-full px-3 rounded-[--radius-md] bg-input border border-border ` +
  `text-sm text-foreground placeholder:text-muted-foreground/60 ${TRANS} ` +
  'hover:border-edge/80 focus:outline-none focus:border-primary/60 focus:bg-input/60 ' +
  'focus:ring-[3px] focus:ring-primary/15'

export const SELECT =
  `h-9 w-full px-3 rounded-[--radius-md] bg-input border border-border ` +
  `text-sm text-foreground ${TRANS} ` +
  'hover:border-edge/80 focus:outline-none focus:border-primary/60 focus:bg-input/60 ' +
  'focus:ring-[3px] focus:ring-primary/15 appearance-none cursor-pointer'

export const TEXTAREA =
  `w-full px-3 py-2 rounded-[--radius-md] bg-input border border-border ` +
  `text-sm text-foreground placeholder:text-muted-foreground/60 ${TRANS} ` +
  'hover:border-edge/80 focus:outline-none focus:border-primary/60 focus:bg-input/60 ' +
  'focus:ring-[3px] focus:ring-primary/15 resize-none'

export const CHECKBOX =
  'h-4 w-4 rounded-[--radius-sm] border-edge bg-input accent-primary cursor-pointer'

// ─── Layout / Cards ───────────────────────────────────────────────────────

// Card — graphite surface with near-invisible border. The `surface-lit`
// utility (defined in index.css) adds a 24px-tall white gradient at the
// top edge for a subtle "lit from above" feel.
export const CARD =
  'rounded-[--radius-lg] bg-card border border-border p-5 surface-lit ' +
  'shadow-[var(--shadow-sm)]'

export const CARD_HEADER =
  'flex items-center justify-between mb-4'

// Card variant for elevated dialogs / modals — bigger drop shadow.
export const CARD_FLOATING =
  'rounded-[--radius-lg] bg-card border border-border p-5 surface-lit ' +
  'shadow-[var(--shadow-lg)]'

export const SECTION = 'space-y-4'

export const DIVIDER = 'h-px bg-border'

// ─── Badges ───────────────────────────────────────────────────────────────

export const BADGE =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-none'

export const BADGE_OK = `${BADGE} bg-ok/12 text-ok ring-1 ring-inset ring-ok/15`

export const BADGE_WARN = `${BADGE} bg-warn/12 text-warn ring-1 ring-inset ring-warn/15`

export const BADGE_ERR = `${BADGE} bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/15`

export const BADGE_ACCENT = `${BADGE} bg-primary/12 text-primary ring-1 ring-inset ring-primary/20`

export const BADGE_NEUTRAL = `${BADGE} bg-elevated text-muted-foreground ring-1 ring-inset ring-edge`

// ─── Labels ───────────────────────────────────────────────────────────────

export const LABEL =
  'block text-xs font-medium text-foreground mb-1.5'

export const LABEL_MUTED =
  'block text-xs font-medium text-muted-foreground mb-1.5'

// Section header — small caps style, used to group related fields
export const SECTION_HEADER =
  'text-[10.5px] font-semibold text-muted-foreground/80 uppercase tracking-[0.08em]'

// ─── Misc ─────────────────────────────────────────────────────────────────

export const TOOLTIP =
  'px-2.5 py-1.5 rounded-[--radius-md] bg-popover border border-border ' +
  'text-xs text-popover-foreground shadow-[var(--shadow-md)]'

export const OVERLAY =
  'fixed inset-0 bg-background/70 backdrop-blur-[6px]'

export const FOCUS_RING =
  'focus:outline-none focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15'

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
