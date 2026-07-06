import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate, Trash2, PlusSquare } from 'lucide-react';
import { api } from '../api.js';

export default function Templates() {
  const [templates, setTemplates] = useState(null);
  const nav = useNavigate();

  const load = () => api.listTemplates().then(setTemplates);
  useEffect(() => { load(); }, []);

  const createFrom = async (tpl) => {
    const roleNames = tpl.roles_json.map((r) => r.role);
    const signers = {};
    for (const role of roleNames) {
      const nameHint = tpl.roles_json.find((r) => r.role === role)?.name_hint || role;
      const name = prompt(`Signer name for role "${nameHint}"`, nameHint);
      if (!name) return;
      const email = prompt(`Signer email for "${name}" (optional)`, '') || '';
      signers[role] = { name, email };
    }
    const env = await api.fromTemplate(tpl.id, { title: tpl.name, signers });
    nav(`/admin/envelopes/${env.id}/edit`);
  };

  const remove = async (id) => {
    if (!confirm('Delete this template?')) return;
    await api.deleteTemplate(id);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-semibold">Templates</h1>
      <p className="mb-8 text-sm text-zinc-500">Save an envelope's field layout once, reuse it for every new deal.</p>

      {templates === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-zinc-500">No templates yet — open an envelope's detail page and choose "Save as template".</p>
      ) : (
        <div className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-4 px-5 py-4">
              <LayoutTemplate className="text-zinc-500" size={20} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-zinc-500">{t.roles_json.length} signer role(s) · {t.fields_json.length} field(s)</p>
              </div>
              <button onClick={() => createFrom(t)} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium hover:bg-indigo-500">
                <PlusSquare size={14} /> New from template
              </button>
              <button onClick={() => remove(t.id)} className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
