// Buttons
export const BTN_BASE =
  'h-9 px-4 rounded-[--radius-md] text-sm font-medium transition-all duration-200 cursor-pointer select-none inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none'

export const BTN_PRIMARY =
  `${BTN_BASE} bg-accent text-white hover:bg-accent-dim active:scale-[0.97] shadow-[0_0_20px_var(--color-accent-glow)]`

export const BTN_SECONDARY =
  `${BTN_BASE} bg-elevated text-content border border-edge hover:bg-card hover:border-muted/30`

export const BTN_DANGER =
  `${BTN_BASE} bg-err/10 text-err border border-err/20 hover:bg-err/20`

export const BTN_GHOST =
  `${BTN_BASE} text-muted hover:text-content hover:bg-elevated`

export const BTN_ICON =
  'h-9 w-9 p-0 rounded-[--radius-md] inline-flex items-center justify-center text-muted hover:text-content hover:bg-elevated transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none'

// Inputs
export const INPUT =
  'h-9 w-full px-3 rounded-[--radius-md] bg-surface border border-edge text-sm text-content placeholder:text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all'

export const SELECT =
  'h-9 w-full px-3 rounded-[--radius-md] bg-surface border border-edge text-sm text-content focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all appearance-none cursor-pointer'

export const TEXTAREA =
  'w-full px-3 py-2 rounded-[--radius-md] bg-surface border border-edge text-sm text-content placeholder:text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all resize-none'

export const CHECKBOX =
  'h-4 w-4 rounded-[--radius-sm] border-edge bg-surface accent-accent cursor-pointer'

// Layout
export const CARD =
  'rounded-[--radius-lg] bg-card border border-edge p-5'

export const CARD_HEADER =
  'flex items-center justify-between mb-4'

export const SECTION =
  'space-y-4'

export const DIVIDER =
  'h-px bg-edge'

// Badges
export const BADGE =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium'

export const BADGE_OK =
  `${BADGE} bg-ok/10 text-ok`

export const BADGE_WARN =
  `${BADGE} bg-warn/10 text-warn`

export const BADGE_ERR =
  `${BADGE} bg-err/10 text-err`

// Labels
export const LABEL =
  'block text-xs font-medium text-content mb-1.5'

export const LABEL_MUTED =
  'block text-xs font-medium text-muted mb-1.5'

// Misc
export const TOOLTIP =
  'px-2.5 py-1.5 rounded-[--radius-md] bg-elevated border border-edge text-xs text-content shadow-lg'

export const OVERLAY =
  'fixed inset-0 bg-surface/60 backdrop-blur-sm'

export const FOCUS_RING =
  'focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20'

// Backward-compatibility aliases (deprecated — use new names)
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
/** @deprecated Use LABEL_MUTED with uppercase tracking */
export const SECTION_HEADER = 'text-[11px] font-semibold text-muted/80 uppercase tracking-wider'
