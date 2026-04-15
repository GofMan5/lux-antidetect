import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProfilesPage } from "./pages/ProfilesPage";
import { ProfileEditorPage } from "./pages/ProfileEditorPage";
import { ProxiesPage } from "./pages/ProxiesPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/profiles" replace />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/profiles/new" element={<ProfileEditorPage />} />
        <Route path="/profiles/:id" element={<ProfileEditorPage />} />
        <Route path="/proxies" element={<ProxiesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
