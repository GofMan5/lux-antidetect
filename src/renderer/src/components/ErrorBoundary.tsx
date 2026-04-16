import { Component } from 'react'
import { AlertOctagon, RotateCcw } from 'lucide-react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-surface">
          <div className="flex flex-col items-center text-center max-w-md px-6">
            <div className="h-16 w-16 rounded-full bg-err/10 flex items-center justify-center mb-6">
              <AlertOctagon className="h-8 w-8 text-err" />
            </div>
            <h1 className="text-lg font-semibold text-content mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-muted mb-5">
              An unexpected error occurred. You can try reloading the app.
            </p>
            <div className="w-full rounded-[--radius-md] bg-card border border-edge px-4 py-3 mb-6 overflow-x-auto">
              <code className="text-xs text-err/80 font-mono break-all leading-relaxed">
                {this.state.error?.message || 'Unknown error'}
              </code>
            </div>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.hash = '#/profiles'
                window.location.reload()
              }}
              className="inline-flex items-center gap-2 rounded-[--radius-md] bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim active:scale-[0.97] transition-all duration-200 shadow-[0_0_20px_var(--color-accent-glow)]"
            >
              <RotateCcw className="h-4 w-4" />
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
