import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import EnvelopesList from './pages/EnvelopesList.jsx';
import Editor from './pages/Editor.jsx';
import EnvelopeDetail from './pages/EnvelopeDetail.jsx';
import Templates from './pages/Templates.jsx';
import SettingsPage from './pages/Settings.jsx';
import SignPage from './pages/SignPage.jsx';
import Layout from './components/Layout.jsx';
import { api } from './api.js';

function AdminGate({ children }) {
  const [state, setState] = useState('checking'); // checking | ok | out
  useEffect(() => {
    api.me().then((m) => setState(m.authed ? 'ok' : 'out')).catch(() => setState('out'));
  }, []);
  if (state === 'checking') return <div className="min-h-screen grid place-items-center text-zinc-500">Loading…</div>;
  if (state === 'out') return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<AdminGate><EnvelopesList /></AdminGate>} />
      <Route path="/admin/envelopes/:id/edit" element={<AdminGate><Editor /></AdminGate>} />
      <Route path="/admin/envelopes/:id" element={<AdminGate><EnvelopeDetail /></AdminGate>} />
      <Route path="/admin/templates" element={<AdminGate><Templates /></AdminGate>} />
      <Route path="/admin/settings" element={<AdminGate><SettingsPage /></AdminGate>} />
      <Route path="/sign/:token" element={<SignPage />} />
      <Route path="*" element={<div className="min-h-screen grid place-items-center text-zinc-500">Not found</div>} />
    </Routes>
  );
}
