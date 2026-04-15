import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProfilesPage } from './pages/ProfilesPage'
import { ProxiesPage } from './pages/ProxiesPage'
import { SettingsPage } from './pages/SettingsPage'
import { useSettingsStore } from './stores/settings'
import { ToastContainer } from './components/Toast'
import { ConfirmDialog } from './components/ConfirmDialog'

export default function App(): React.JSX.Element {
  useEffect(() => {
    useSettingsStore.getState().initSettings()
  }, [])

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/profiles" replace />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/proxies" element={<ProxiesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/profiles" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
      <ConfirmDialog />
    </>
  )
}
