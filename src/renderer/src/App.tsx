import { Component, useEffect, lazy, Suspense, type ReactNode, type ErrorInfo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Layout } from './components/Layout'
import { useSettingsStore } from './stores/settings'
import { ToastContainer } from './components/Toast'
import { ConfirmDialog } from './components/ConfirmDialog'
import { initDebugCapture } from './stores/debug'

// Pages are route-split so the first paint only loads the shell + the
// initial route (Profiles). Settings pulls in heavy dependencies (color
// pickers, theme editor, full debug view) we don't need until the user
// actually navigates there.
const ProfilesPage = lazy(() =>
  import('./pages/ProfilesPage').then((m) => ({ default: m.ProfilesPage }))
)
const ProxiesPage = lazy(() =>
  import('./pages/ProxiesPage').then((m) => ({ default: m.ProxiesPage }))
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)

// Init debug capture once
initDebugCapture()

function PageFallback(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
}

/**
 * Catches failures in lazy chunks (missing file, JSON parse error, etc.)
 * so a bad bundle / disk corruption doesn't leave the user on a blank
 * screen with no way back.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary]', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-err/10 text-err">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-content">This page failed to load</h2>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">
            {this.state.error.message || 'An unexpected error occurred while loading this page.'}
          </p>
          <button
            onClick={() => {
              this.reset()
              window.location.reload()
            }}
            className="mt-5 inline-flex items-center gap-2 rounded-[--radius-md] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Reload
          </button>
        </div>
      </div>
    )
  }
}

function LazyRoute({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}

export default function App(): React.JSX.Element {
  useEffect(() => {
    useSettingsStore.getState().initSettings()
  }, [])

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/profiles" replace />} />
          <Route path="/profiles" element={<LazyRoute><ProfilesPage /></LazyRoute>} />
          <Route path="/proxies" element={<LazyRoute><ProxiesPage /></LazyRoute>} />
          <Route path="/settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
          <Route path="*" element={<Navigate to="/profiles" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
      <ConfirmDialog />
    </>
  )
}
