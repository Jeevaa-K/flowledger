const BASE = window.location.protocol === 'file:'
  ? 'http://localhost:3001/api'
  : '/api';

const API = {
  getToken() { return localStorage.getItem('fl_token'); },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    const t = this.getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
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
    if (r.status === 401) {
      localStorage.removeItem('fl_token');
      localStorage.removeItem('fl_user');
      window.location.reload();
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
  del(path)        { return this.request('DELETE', path); },

  // Same as get(), but also returns the X-Total-Count header — used only
  // by the paginated transactions list, so request()'s return shape
  // (plain parsed JSON) stays unchanged for every other call site.
  async getWithCount(path) {
    const r = await fetch(BASE + path, { headers: this.headers() });
    if (r.status === 401) {
      localStorage.removeItem('fl_token');
      localStorage.removeItem('fl_user');
      window.location.reload();
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

  scanReceipt(image) {
    return this.post('/ai/scan-receipt', { image });
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
      // Token goes in the Authorization header, never the URL — a query
      // param would end up in server access logs and browser history.
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