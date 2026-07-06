import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Download, ShieldCheck, ShieldAlert, Bell, Ban, Copy, LayoutTemplate, ArrowLeft } from 'lucide-react';
import { api } from '../api.js';

const STATUS_STYLE = {
  pending: 'bg-zinc-700/40 text-zinc-400',
  active: 'bg-amber-500/15 text-amber-300',
  signed: 'bg-emerald-500/15 text-emerald-300',
  declined: 'bg-red-500/15 text-red-300',
};

export default function EnvelopeDetail() {
  const { id } = useParams();
  const [env, setEnv] = useState(null);
  const [audit, setAudit] = useState(null);
  const [verify, setVerify] = useState(null);
  const [msg, setMsg] = useState('');
  const nav = useNavigate();

  const load = () => {
    api.getEnvelope(id).then(setEnv);
    api.getAudit(id).then(setAudit);
  };
  useEffect(() => { load(); }, [id]);

  const doVerify = async () => setVerify(await api.verifyEnvelope(id));
  const remind = async () => { const r = await api.remindEnvelope(id); setMsg(r.smtp_configured ? 'Reminders sent.' : 'SMTP not configured — copy the links below manually.'); load(); };
  const doVoid = async () => { if (!confirm('Void this envelope? Signing links will stop working.')) return; await api.voidEnvelope(id); load(); };
  const saveTemplate = async () => {
    const name = prompt('Template name', `${env.title} template`);
    if (!name) return;
    await api.saveAsTemplate(id, name);
    setMsg('Saved as template.');
  };
  const copyLink = (token) => navigator.clipboard.writeText(`${location.origin}/sign/${token}`);

  if (!env) return <div className="p-8 text-zinc-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <button onClick={() => nav('/admin')} className="mb-4 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300"><ArrowLeft size={14} /> All envelopes</button>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{env.title}</h1>
          <p className="text-sm text-zinc-500 capitalize">{env.status} · {env.routing} routing</p>
        </div>
        <div className="flex gap-2">
          {env.status === 'sent' && (
            <button onClick={remind} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"><Bell size={14} /> Remind</button>
          )}
          {['sent', 'draft'].includes(env.status) && (
            <button onClick={doVoid} className="flex items-center gap-1.5 rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/40"><Ban size={14} /> Void</button>
          )}
          <button onClick={saveTemplate} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"><LayoutTemplate size={14} /> Save as template</button>
          {env.status === 'completed' && (
            <a href={`/api/envelopes/${id}/final.pdf`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium hover:bg-indigo-500"><Download size={14} /> Download final PDF</a>
          )}
        </div>
      </div>

      {msg && <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-300">{msg}</div>}

      <section className="mb-8 rounded-xl border border-zinc-800 p-6">
        <h2 className="mb-4 text-sm font-semibold text-zinc-300">Signers</h2>
        <div className="space-y-3">
          {env.signers.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.name} <span className="text-zinc-500">{s.email && `<${s.email}>`}</span></p>
                {s.signed_at && <p className="text-xs text-zinc-500">signed {new Date(s.signed_at).toLocaleString()}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[s.status] || ''}`}>{s.status}</span>
              {(s.status === 'active' || s.status === 'pending') && (
                <button onClick={() => copyLink(s.token)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Copy signing link"><Copy size={14} /></button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Audit trail (hash-chained)</h2>
          <button onClick={doVerify} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800">
            <ShieldCheck size={14} /> Verify chain
          </button>
        </div>
        {verify && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${verify.valid ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
            {verify.valid ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            {verify.valid ? `Valid — ${verify.events} events, unbroken chain.` : `Broken at event #${verify.brokenAt}: ${verify.reason}`}
          </div>
        )}
        {audit === null ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr><th className="py-1 pr-3">#</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Actor</th><th className="py-1 pr-3">When</th><th className="py-1 pr-3">IP</th><th className="py-1">Hash</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {audit.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-1.5 pr-3">{ev.seq}</td>
                    <td className="py-1.5 pr-3">{ev.type}</td>
                    <td className="py-1.5 pr-3">{ev.actor}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(ev.at).toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{ev.ip}</td>
                    <td className="py-1.5 font-mono text-zinc-500">{ev.hash.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
