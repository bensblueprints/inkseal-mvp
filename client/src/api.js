async function request(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401 && !path.startsWith('/api/login')) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = new Error((isJson && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (password) => request('/api/login', { method: 'POST', body: { password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),

  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', { method: 'PUT', body: data }),

  listEnvelopes: () => request('/api/envelopes'),
  getEnvelope: (id) => request(`/api/envelopes/${id}`),
  createEnvelope: (formData) => request('/api/envelopes', { method: 'POST', body: formData }),
  updateEnvelope: (id, data) => request(`/api/envelopes/${id}`, { method: 'PUT', body: data }),
  deleteEnvelope: (id) => request(`/api/envelopes/${id}`, { method: 'DELETE' }),
  saveFields: (id, data) => request(`/api/envelopes/${id}/fields`, { method: 'PUT', body: data }),
  sendEnvelope: (id) => request(`/api/envelopes/${id}/send`, { method: 'POST' }),
  remindEnvelope: (id) => request(`/api/envelopes/${id}/remind`, { method: 'POST' }),
  voidEnvelope: (id) => request(`/api/envelopes/${id}/void`, { method: 'POST' }),
  getAudit: (id) => request(`/api/envelopes/${id}/audit`),
  verifyEnvelope: (id) => request(`/api/envelopes/${id}/verify`),
  saveAsTemplate: (id, name) => request(`/api/envelopes/${id}/save-as-template`, { method: 'POST', body: { name } }),

  listTemplates: () => request('/api/templates'),
  deleteTemplate: (id) => request(`/api/templates/${id}`, { method: 'DELETE' }),
  fromTemplate: (id, data) => request(`/api/envelopes/from-template/${id}`, { method: 'POST', body: data }),

  // public signing
  getSignSession: (token) => request(`/api/sign/${token}`),
  consent: (token) => request(`/api/sign/${token}/consent`, { method: 'POST' }),
  submitField: (token, fieldId, body) => request(`/api/sign/${token}/fields/${fieldId}`, { method: 'POST', body }),
  completeSigning: (token) => request(`/api/sign/${token}/complete`, { method: 'POST' }),
  declineSigning: (token, reason) => request(`/api/sign/${token}/decline`, { method: 'POST', body: { reason } }),
};

export const FIELD_TYPES = [
  { type: 'signature', label: 'Signature' },
  { type: 'initials', label: 'Initials' },
  { type: 'date', label: 'Date signed' },
  { type: 'text', label: 'Text' },
];

export const SIGNER_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#a855f7', '#14b8a6'];

export const uid = () => 'local_' + Math.random().toString(36).slice(2, 10);
