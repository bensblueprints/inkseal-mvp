import { useEffect, useState } from 'react';
import { Save, Mail, KeyRound } from 'lucide-react';
import { api } from '../api.js';

export default function SettingsPage() {
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [license, setLicense] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseMsg, setLicenseMsg] = useState('');

  useEffect(() => {
    api.getSettings().then(setForm);
    api.getLicense().then(setLicense).catch(() => {});
  }, []);

  const activate = async () => {
    setLicenseMsg('');
    try {
      const status = await api.activateLicense(licenseKey.trim());
      setLicense(status);
      setLicenseKey('');
      setLicenseMsg('License activated — unlimited documents unlocked.');
    } catch (err) {
      setLicenseMsg(err.message);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      await api.updateSettings(form);
      setMsg('Saved.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!form) return <div className="p-8 text-zinc-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-1 text-2xl font-semibold">Settings</h1>
      <p className="mb-8 text-sm text-zinc-500">Business identity and outbound email (BYO SMTP).</p>

      {license && (
        <section className="mb-8 space-y-4 rounded-xl border border-zinc-800 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300"><KeyRound size={14} /> License</h2>
          {license.licensed ? (
            <p className="text-sm text-emerald-400">
              Licensed — unlimited documents. Activated {license.activated_at ? new Date(license.activated_at).toLocaleDateString() : ''}.
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Free plan: {Math.min(license.free_used, license.free_limit)} of {license.free_limit} free document used.{' '}
                <a href={license.checkout_url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                  Upgrade — $59 once, unlimited documents forever
                </a>
              </p>
              <div className="flex gap-2">
                <input
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  placeholder="W-XXXXXX-XXXXXXXX-XXXXXXXW"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                />
                <button onClick={activate} disabled={!licenseKey.trim()} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700 disabled:opacity-50">
                  Activate
                </button>
              </div>
            </>
          )}
          {licenseMsg && <p className="text-xs text-zinc-400">{licenseMsg}</p>}
        </section>
      )}

      <section className="mb-8 space-y-4 rounded-xl border border-zinc-800 p-6">
        <h2 className="text-sm font-semibold text-zinc-300">Business</h2>
        <Field label="Business name" value={form.business_name} onChange={set('business_name')} placeholder="Acme Realty" />
        <Field label="Public base URL" value={form.base_url} onChange={set('base_url')} placeholder="https://sign.yourdomain.com (optional)" />
      </section>

      <section className="mb-8 space-y-4 rounded-xl border border-zinc-800 p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300"><Mail size={14} /> SMTP (optional)</h2>
        <p className="text-xs text-zinc-500">Without SMTP configured, signing links are shown in the UI to copy/paste manually — envelopes still complete and download normally.</p>
        <Field label="Host" value={form.smtp_host} onChange={set('smtp_host')} placeholder="smtp.mailgun.org" />
        <Field label="Port" value={form.smtp_port} onChange={set('smtp_port')} placeholder="587" />
        <Field label="Username" value={form.smtp_user} onChange={set('smtp_user')} placeholder="postmaster@..." />
        <Field label="Password" type="password" value={form.smtp_pass} onChange={set('smtp_pass')} placeholder="********" />
        <Field label="From address" value={form.smtp_from} onChange={set('smtp_from')} placeholder="Inkseal <noreply@yourdomain.com>" />
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={!!form.smtp_secure} onChange={set('smtp_secure')} /> Use implicit TLS (port 465)
        </label>
      </section>

      <button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50">
        <Save size={16} /> Save settings
      </button>
      {msg && <span className="ml-3 text-sm text-zinc-400">{msg}</span>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
    </label>
  );
}
