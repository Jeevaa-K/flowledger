const Auth = {
  init() {
    const token = localStorage.getItem('fl_token');
    const user  = JSON.parse(localStorage.getItem('fl_user') || 'null');

    if (token && user) {
      // Already logged in — show app directly
      this.onLoggedIn(user);
    } else {
      // Show login screen
      document.getElementById('authOverlay').classList.add('show');
    }

    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('loginBtn').addEventListener('click',    () => this.login());
    document.getElementById('registerBtn').addEventListener('click', () => this.register());
    document.getElementById('loginEmail').addEventListener('keydown',    e => { if (e.key==='Enter') this.login(); });
    document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key==='Enter') this.login(); });
    document.getElementById('regConfirm').addEventListener('keydown',    e => { if (e.key==='Enter') this.register(); });
    // Sidebar gear icon → profile
    document.addEventListener('click', e => {
      const gear = e.target.closest('#openProfileModal');
      if (gear) { e.stopPropagation(); this.openProfile(); return; }

      // Avatar button → toggle dropdown
      const avatarBtn = e.target.closest('#topbarProfileBtn');
      if (avatarBtn) {
        e.stopPropagation();
        const dd = document.getElementById('avatarDropdown');
        if (dd) dd.classList.toggle('show');
        return;
      }

      // Close dropdown when clicking outside
      const wrap = e.target.closest('#avatarWrap');
      if (!wrap) {
        const dd = document.getElementById('avatarDropdown');
        if (dd) dd.classList.remove('show');
      }
    });

    // Dropdown items
    const avProfile = document.getElementById('avProfile');
    const avTheme   = document.getElementById('avTheme');
    const avLogout  = document.getElementById('avLogout');
    if (avProfile) avProfile.addEventListener('click', () => {
      document.getElementById('avatarDropdown').classList.remove('show');
      this.openProfile();
    });
    if (avTheme) avTheme.addEventListener('click', () => {
      document.getElementById('avatarDropdown').classList.remove('show');
      if (typeof Theme !== 'undefined') Theme.toggle();
      const btn = document.getElementById('avTheme');
      if (btn) btn.textContent = (localStorage.getItem('fl_theme')==='dark' ? '☀️' : '🌙') + ' Toggle Dark Mode';
    });
    if (avLogout) avLogout.addEventListener('click', () => {
      document.getElementById('avatarDropdown').classList.remove('show');
      this.logout();
    });
    document.getElementById('closeProfileModal').addEventListener('click', () => document.getElementById('profileModal').classList.remove('open'));
    document.getElementById('saveProfileBtn').addEventListener('click',    () => this.saveProfile());
    document.getElementById('changePasswordBtn').addEventListener('click', () => this.changePassword());
    document.getElementById('deleteAccountBtn').addEventListener('click',  () => this.deleteAccount());
    document.getElementById('logoutBtn').addEventListener('click',         () => this.logout());

    // Profile tab delegation - works even when modal is hidden
    document.addEventListener('click', e => {
      const tab = e.target.closest('.profile-tab');
      if (!tab || !tab.dataset.ptab) return;
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-panel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      const panel = document.getElementById('ptab-' + tab.dataset.ptab);
      if (panel) panel.style.display = 'block';
    });
  },

  showTab(tab) {
    document.getElementById('formLogin').style.display    = tab === 'login'    ? 'block' : 'none';
    document.getElementById('formRegister').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('tabLogin').classList.toggle('active',    tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    document.getElementById('loginError').textContent    = '';
    document.getElementById('registerError').textContent = '';
  },

  togglePwd(id) {
    const el = document.getElementById(id);
    el.type = el.type === 'password' ? 'text' : 'password';
  },

  setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  },

  async login() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    this.setError('loginError', '');
    if (!email || !password) { this.setError('loginError', 'Please fill in all fields'); return; }
    const btn = document.getElementById('loginBtn');
    btn.textContent = 'Logging in...'; btn.disabled = true;
    try {
      const data = await API.post('/auth/login', { email, password });
      this.storeSession(data, document.getElementById('rememberMe').checked);
      this.onLoggedIn(data.user);
    } catch(e) {
      this.setError('loginError', e.message.replace(/^\d+:\s*/, ''));
    } finally { btn.textContent = 'Login →'; btn.disabled = false; }
  },

  async register() {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm  = document.getElementById('regConfirm').value;
    this.setError('registerError', '');
    if (!name || !email || !password) { this.setError('registerError', 'Please fill in all fields'); return; }
    if (password !== confirm)          { this.setError('registerError', 'Passwords do not match'); return; }
    if (password.length < 6)           { this.setError('registerError', 'Password must be at least 6 characters'); return; }
    const btn = document.getElementById('registerBtn');
    btn.textContent = 'Creating account...'; btn.disabled = true;
    try {
      const data = await API.post('/auth/register', { name, email, password });
      this.storeSession(data, true);
      this.onLoggedIn(data.user);
    } catch(e) {
      this.setError('registerError', e.message.replace(/^\d+:\s*/, ''));
    } finally { btn.textContent = 'Create Account →'; btn.disabled = false; }
  },

  async tryDemo() {
    this.setError('loginError', '');
    try {
      let data;
      try {
        data = await API.post('/auth/register', { name:'Demo User', email:'demo@flowledger.app', password:'demo123456' });
      } catch {
        data = await API.post('/auth/login', { email:'demo@flowledger.app', password:'demo123456' });
      }
      this.storeSession(data, false);
      this.onLoggedIn(data.user);
    } catch(e) {
      this.setError('loginError', 'Demo failed: ' + e.message.replace(/^\d+:\s*/,''));
    }
  },

  storeSession(data, remember) {
    localStorage.setItem('fl_token', data.token);
    localStorage.setItem('fl_user',  JSON.stringify(data.user));
    if (remember) localStorage.setItem('fl_remember', '1');
  },

  onLoggedIn(user) {
    document.getElementById('authOverlay').classList.remove('show');
    const el = (id) => document.getElementById(id);
    const initial = (user.name || 'U').charAt(0).toUpperCase();
    if (el('userAvatar')) el('userAvatar').textContent = initial;
    if (el('userName'))   el('userName').textContent   = user.name;
    if (el('userEmail'))  el('userEmail').textContent  = user.email;
    // Also update dropdown
    if (el('avAvatar')) el('avAvatar').textContent = initial;
    if (el('avName'))   el('avName').textContent   = user.name;
    if (el('avEmail'))  el('avEmail').textContent  = user.email;
    localStorage.setItem('fl_user', JSON.stringify(user));
    // Only start the app AFTER auth is confirmed
    if (typeof App !== 'undefined' && !App._started) {
      App._started = true;
      App.init();
    }
  },

  logout() {
    if (!confirm('Log out of FlowLedger?')) return;
    localStorage.removeItem('fl_token');
    localStorage.removeItem('fl_user');
    localStorage.removeItem('fl_remember');
    window.location.reload();
  },

  async openProfile() {
    try {
      // Use stored user data instead of API call to avoid JSON parse issues
      const stored = JSON.parse(localStorage.getItem('fl_user') || '{}');
      document.getElementById('profileName').value     = stored.name  || '';
      document.getElementById('profileEmail').value    = stored.email || '';
      document.getElementById('profileCurrency').value = stored.currency || '₹';
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-panel').forEach(p => p.style.display = 'none');
      document.querySelector('.profile-tab').classList.add('active');
      document.getElementById('ptab-info').style.display = 'block';
      document.getElementById('profileModal').classList.add('open');
    } catch(e) { console.error('openProfile error:', e); }
  },

  async saveProfile() {
    const name     = document.getElementById('profileName').value.trim();
    const currency = document.getElementById('profileCurrency').value;
    if (!name) { alert('Name cannot be empty'); return; }
    try {
      await API.put('/auth/profile', { name, currency });
      const user = JSON.parse(localStorage.getItem('fl_user') || '{}');
      user.name = name; user.currency = currency;
      localStorage.setItem('fl_user', JSON.stringify(user));
      this.onLoggedIn(user);
      document.getElementById('profileModal').classList.remove('open');
      UI.toast('✓ Profile updated', 'success');
    } catch(e) { alert(e.message.replace(/^\d+:\s*/,'')); }
  },

  async changePassword() {
    const current = document.getElementById('currentPwd').value;
    const newPwd  = document.getElementById('newPwd').value;
    const confirm = document.getElementById('confirmPwd').value;
    if (!current || !newPwd) { alert('Please fill in all fields'); return; }
    if (newPwd !== confirm)  { alert('Passwords do not match'); return; }
    if (newPwd.length < 6)   { alert('Password must be at least 6 characters'); return; }
    try {
      await API.put('/auth/password', { currentPassword:current, newPassword:newPwd });
      ['currentPwd','newPwd','confirmPwd'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('profileModal').classList.remove('open');
      UI.toast('✓ Password changed', 'success');
    } catch(e) { alert(e.message.replace(/^\d+:\s*/,'')); }
  },

  async deleteAccount() {
    if (!confirm('Are you absolutely sure? This will permanently delete all your data.')) return;
    if (!confirm('Final confirmation — this cannot be undone!')) return;
    try {
      await API.del('/auth/account');
      localStorage.clear();
      window.location.reload();
    } catch(e) { alert(e.message.replace(/^\d+:\s*/,'')); }
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());