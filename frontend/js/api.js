// The session uses httpOnly cookies on the web and Capacitor Preferences / Authorization Bearer token in native apps.
// In native hybrid apps (Capacitor), backend URL can be configured via fl_api_url.
const API = {
  _token: null,

  isNative() {
    return !!(window.Capacitor && (typeof window.Capacitor.isNativePlatform === 'function' ? window.Capacitor.isNativePlatform() : true));
  },

  async getToken() {
    if (!this.isNative()) return null;
    if (this._token) return this._token;
    if (window.Capacitor?.Plugins?.Preferences) {
      try {
        const { value } = await window.Capacitor.Plugins.Preferences.get({ key: 'fl_token' });
        if (value) { this._token = value; return value; }
      } catch (_) {}
    }
    this._token = localStorage.getItem('fl_token') || null;
    return this._token;
  },

  async setToken(token) {
    if (!token || !this.isNative()) return;
    this._token = token;
    if (window.Capacitor?.Plugins?.Preferences) {
      try {
        await window.Capacitor.Plugins.Preferences.set({ key: 'fl_token', value: token });
      } catch (_) {}
    }
    try { localStorage.setItem('fl_token', token); } catch (_) {}
  },

  async clearToken() {
    this._token = null;
    if (window.Capacitor?.Plugins?.Preferences) {
      try {
        await window.Capacitor.Plugins.Preferences.remove({ key: 'fl_token' });
      } catch (_) {}
    }
    try { localStorage.removeItem('fl_token'); } catch (_) {}
  },

  getBase() {
    const custom = localStorage.getItem('fl_api_url') || (window.FLOWLEDGER_API_URL || null);
    if (custom) return custom.replace(/\/+$/, '') + '/api';
    return '/api';
  },

  async headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.isNative()) {
      h['X-Client'] = 'native';
      const token = await this.getToken();
      if (token) {
        h['Authorization'] = `Bearer ${token}`;
      }
    }
    return h;
  },

  // Session expired or missing: drop the cached profile and show the login screen.
  handleUnauthorized() {
    this.clearToken();
    localStorage.removeItem('fl_user');
    window.location.reload();
  },

  // Credential-verification endpoints may legitimately reject wrong passwords
  // without meaning the user's session cookie has expired.
  isCredentialRoute(path) {
    return /^\/auth\/(login|register|password|account|forgot|reset)(\?|$)/.test(path);
  },

  async request(method, path, body) {
    const headers = await this.headers();
    const opts = { method, headers, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    let r;
    const base = this.getBase();
    try {
      r = await fetch(base + path, opts);
    } catch {
      // fetch() throws (not a rejected HTTP status) when there's no network at all
      throw new Error("You're offline — check your connection and try again.");
    }
    const tokenHeader = r.headers.get('x-auth-token');
    if (tokenHeader) {
      await this.setToken(tokenHeader);
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

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path, body) { return this.request('DELETE', path, body); },

  async getCashflowForecast(days = 30, accountId = null, discretionary = true) {
    let q = `?days=${days}&discretionary=${discretionary}`;
    if (accountId) q += `&account_id=${accountId}`;
    return this.get(`/cashflow-forecast${q}`);
  },

  async getCurrencies() {
    return this.get('/currencies');
  },

  async getCurrencyRates(base) {
    const q = base ? `?base=${base}` : '';
    return this.get(`/currencies/rates${q}`);
  },

  async convertCurrency(amount, from, to, rate) {
    return this.post('/currencies/convert', { amount, from, to, rate });
  },

  // Same as get(), but also returns the X-Total-Count header — used only
  // by the paginated transactions list, so request()'s return shape
  // (plain parsed JSON) stays unchanged for every other call site.
  async getWithCount(path) {
    const headers = await this.headers();
    const r = await fetch(this.getBase() + path, { headers, credentials: 'include' });
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
  deleteGroup(id) { return this.del(`/groups/${id}`); },

  async exportCSV(queryString = '') {
    try {
      const base = this.getBase();
      const url = base + '/export/csv' + (queryString ? '?' + queryString : '');
      const res = await fetch(url, {
        headers: await this.headers(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = queryString ? `transactions-export-${new Date().toISOString().slice(0, 10)}.csv` : 'expenses.csv';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('CSV export failed: ' + e.message, 'error');
      } else {
        alert('CSV export failed: ' + e.message);
      }
    }
  }
};