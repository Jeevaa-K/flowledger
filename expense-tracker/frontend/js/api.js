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
    const r = await fetch(BASE + path, opts);
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

  async exportCSV() {
    try {
      const token = this.getToken();
      const res = await fetch(BASE + '/export/csv?token=' + token);
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
