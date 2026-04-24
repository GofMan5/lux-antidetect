import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
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

export default function App(): React.JSX.Element {
  useEffect(() => {
    useSettingsStore.getState().initSettings()
  }, [])

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/profiles" replace />} />
          <Route
            path="/profiles"
            element={
              <Suspense fallback={<PageFallback />}>
                <ProfilesPage />
              </Suspense>
            }
          />
          <Route
            path="/proxies"
            element={
              <Suspense fallback={<PageFallback />}>
                <ProxiesPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<PageFallback />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/profiles" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
      <ConfirmDialog />
    </>
  )
}
