import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'

// Vault Sonner toaster. Wraps `sonner`'s `<Toaster />` with Vault tokens —
// graphite popover surface, near-invisible border, electric blue success
// accent. The existing `Toast.tsx` stays in place for back-compat; new
// toasts should use `import { toast } from 'sonner'` directly.

const Toaster = ({ ...props }: ToasterProps): React.JSX.Element => {
  return (
    <SonnerToaster
      theme="dark"
      className="toaster group"
      position="top-right"
      richColors={false}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast bg-popover text-popover-foreground border border-border ' +
            'shadow-[var(--shadow-md)] rounded-[--radius-lg]',
          description: 'text-muted-foreground',
          actionButton:
            'bg-primary text-primary-foreground rounded-[--radius-md] px-3 py-1 text-xs font-medium ' +
            'hover:bg-accent-dim transition-colors',
          cancelButton:
            'bg-elevated text-foreground rounded-[--radius-md] px-3 py-1 text-xs font-medium ' +
            'hover:bg-edge transition-colors',
          closeButton:
            'bg-elevated text-muted-foreground border border-border ' +
            'hover:text-foreground hover:bg-edge'
        }
      }}
      style={
        {
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
          '--success-bg': 'var(--color-popover)',
          '--success-text': 'var(--color-ok)',
          '--success-border': 'var(--color-ok)',
          '--error-bg': 'var(--color-popover)',
          '--error-text': 'var(--color-destructive)',
          '--error-border': 'var(--color-destructive)',
          '--info-bg': 'var(--color-popover)',
          '--info-text': 'var(--color-info)',
          '--info-border': 'var(--color-info)',
          '--warning-bg': 'var(--color-popover)',
          '--warning-text': 'var(--color-warn)',
          '--warning-border': 'var(--color-warn)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
