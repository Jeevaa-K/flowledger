// The session is an httpOnly cookie set by the server, so JavaScript never
// sees (or stores) the auth token. The app must be served by the backend.
const BASE = '/api';

const API = {
  headers() {
    return { 'Content-Type': 'application/json' };
  },

  // Session expired or missing: drop the cached profile and show the login screen.
  handleUnauthorized() {
    localStorage.removeItem('fl_user');
    window.location.reload();
  },

  // Credential-verification endpoints may legitimately reject wrong passwords
  // without meaning the user's session cookie has expired.
  isCredentialRoute(path) {
    return /^\/auth\/(login|register|password|account)(\?|$)/.test(path);
  },

  async request(method, path, body) {
    const opts = { method, headers: this.headers() };
    if (body) opts.body = JSON.stringify(body);
    let r;
    try {
      r = await fetch(BASE + path, opts);
    } catch {
      // fetch() throws (not a rejected HTTP status) when there's no network at all
      throw new Error("You're offline — check your connection and try again.");
    }
    if (r.status === 401 && !this.isCredentialRoute(path)) {
      this.handleUnauthorized();
      return;
    }
    if (!r.ok) {
      let msg;
      try { const j = await r.json(); msg = j.error || JSON.stringify(j); }
      catch { msg = await r.text(); }
      throw new Error(`${r.status}: ${msg}`);
    }
    return r.json();
  },

  get(path)        { return this.request('GET',    path); },
  post(path, body) { return this.request('POST',   path, body); },
  put(path, body)  { return this.request('PUT',    path, body); },
  del(path, body)  { return this.request('DELETE', path, body); },

  // Same as get(), but also returns the X-Total-Count header — used only
  // by the paginated transactions list, so request()'s return shape
  // (plain parsed JSON) stays unchanged for every other call site.
  async getWithCount(path) {
    const r = await fetch(BASE + path, { headers: this.headers() });
    if (r.status === 401) {
      this.handleUnauthorized();
      return { data: [], total: 0 };
    }
    if (!r.ok) {
      let msg;
      try { const j = await r.json(); msg = j.error || JSON.stringify(j); }
      catch { msg = await r.text(); }
      throw new Error(`${r.status}: ${msg}`);
    }
    const data = await r.json();
    const total = parseInt(r.headers.get('X-Total-Count')) || data.length;
    return { data, total };
  },

  parseNaturalLanguage(text) {
    return this.post('/ai/parse-text', { text });
  },

  parseBankSms(sms, save = false) {
    return this.post('/ai/parse-sms', { sms, save });
  },

  scanReceipt(image) {
    return this.post('/ai/scan-receipt', { image });
  },

  createSplitTransaction(data) {
    return this.post('/transactions/split', data);
  },

  getSplitGroup(splitId) {
    return this.get(`/transactions/split/${splitId}`);
  },

  deleteSplitGroup(splitId) {
    return this.del(`/transactions/split/${splitId}`);
  },

  getGroups()                         { return this.get('/groups'); },
  createGroup(data)                  { return this.post('/groups', data); },
  getGroupDetails(id)                { return this.get(`/groups/${id}`); },
  addGroupExpense(groupId, data)     { return this.post(`/groups/${groupId}/expenses`, data); },
  settleGroup(groupId, data)         { return this.post(`/groups/${groupId}/settle`, data); },
  deleteGroupExpense(groupId, expId) { return this.del(`/groups/${groupId}/expenses/${expId}`); },
  deleteGroup(id)                    { return this.del(`/groups/${id}`); },

  async exportCSV() {
    try {
      // The session cookie authenticates the download; nothing sensitive in the URL.
      const res = await fetch(BASE + '/export/csv', { headers: this.headers() });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'expenses.csv';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e) { alert('CSV export failed: ' + e.message); }
  }
};

// ── Centralized SVG Icon Helper ───────────────────────────────
const Icons = {
  svg(paths, size = 15, cls = '') {
    return `<svg class="fl-icon${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  },
  check(s = 15)    { return this.svg('<polyline points="20 6 9 17 4 12"/>', s); },
  x(s = 15)        { return this.svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', s); },
  alert(s = 15)    { return this.svg('<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', s); },
  sparkles(s = 15) { return this.svg('<path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>', s); },
  scissors(s = 15) { return this.svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>', s); },
  search(s = 15)   { return this.svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', s); },
  edit(s = 14)     { return this.svg('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>', s); },
  trash(s = 14)    { return this.svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>', s); },
  pause(s = 14)    { return this.svg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>', s); },
  play(s = 14)     { return this.svg('<polygon points="5 3 19 12 5 21 5 3"/>', s); },
  refresh(s = 15)  { return this.svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>', s); },
  clock(s = 15)    { return this.svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', s); },
  calendar(s = 15) { return this.svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', s); },
  bank(s = 15)     { return this.svg('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>', s); },
  card(s = 15)     { return this.svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', s); },
  wallet(s = 15)   { return this.svg('<path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 14h.01"/><path d="M2 9V5a2 2 0 012-2h14"/>', s); },
  cash(s = 15)     { return this.svg('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>', s); },
  box(s = 15)      { return this.svg('<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>', s); },
  tag(s = 14)      { return this.svg('<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>', s); },
  target(s = 15)   { return this.svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', s); },
  users(s = 15)    { return this.svg('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>', s); },
  receipt(s = 15)  { return this.svg('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/>', s); },
  camera(s = 15)   { return this.svg('<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>', s); },
  phone(s = 15)    { return this.svg('<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>', s); },
  chart(s = 15)    { return this.svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>', s); },
  trend(s = 15)    { return this.svg('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', s); },
  bolt(s = 15)     { return this.svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', s); },
  bulb(s = 15)     { return this.svg('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/>', s); },
  list(s = 16)     { return this.svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>', s); },
  arrowRight(s = 14) { return this.svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', s); },
  accountType(type, s = 15) {
    const map = { cash: this.cash(s), bank: this.bank(s), credit_card: this.card(s), wallet: this.wallet(s), other: this.box(s) };
    return map[type] || this.box(s);
  },
  category(cat, s = 14) {
    const c = String(cat || '').toLowerCase();
    if (c.includes('food') || c.includes('grocer') || c.includes('din')) return this.svg('<path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>', s);
    if (c.includes('transport') || c.includes('travel')) return this.svg('<rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>', s);
    if (c.includes('shop')) return this.svg('<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>', s);
    if (c.includes('entertain')) return this.svg('<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>', s);
    if (c.includes('health') || c.includes('med')) return this.svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', s);
    if (c.includes('bill') || c.includes('util') || c.includes('hous')) return this.bulb(s);
    if (c.includes('salary')) return this.svg('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>', s);
    if (c.includes('freelance')) return this.svg('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', s);
    if (c.includes('invest')) return this.trend(s);
    return this.tag(s);
  }
};