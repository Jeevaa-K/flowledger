const Auth = {
  init() {
    // Older versions kept the JWT in localStorage; remove any leftover copy.
    localStorage.removeItem('fl_token');

    // Check for ?reset=<token> in URL to show reset screen
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset');
    if (resetToken) {
      document.getElementById('authOverlay')?.classList.add('show');
      this.showTab('reset');
      const tokenInput = document.getElementById('resetToken');
      if (tokenInput) tokenInput.value = resetToken;
      this.bindEvents();
      this.bindConnectivity();
      return;
    }

    const user = JSON.parse(localStorage.getItem('fl_user') || 'null');

    // The real session is an httpOnly cookie. fl_user is only a cached profile
    // for instant rendering; if the cookie has expired, the first API call
    // returns 401 and API.handleUnauthorized() shows the login screen.
    if (user) {
      // Already logged in — show app directly
      this.onLoggedIn(user);
    } else {
      // Show login screen
      document.getElementById('authOverlay').classList.add('show');
    }

    this.bindEvents();
    this.bindConnectivity();
  },

  bindConnectivity() {
    window.addEventListener('offline', () => {
      if (typeof UI !== 'undefined') UI.toast("You're offline — changes won't save until you're back online", 'error', 5000);
    });
    window.addEventListener('online', () => {
      if (typeof UI !== 'undefined') UI.toast('Back online', 'success');
    });
  },

  bindEvents() {
    const on = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    on('loginBtn',    'click',   () => this.login());
    on('registerBtn', 'click',   () => this.register());
    on('loginEmail',    'keydown', e => { if (e.key==='Enter') this.login(); });
    on('loginPassword', 'keydown', e => { if (e.key==='Enter') this.login(); });
    on('regConfirm',    'keydown', e => { if (e.key==='Enter') this.register(); });
    on('forgotBtn',     'click',   () => this.forgotPassword());
    on('forgotEmail',   'keydown', e => { if (e.key==='Enter') this.forgotPassword(); });
    on('resetBtn',      'click',   () => this.resetPasswordSubmit());
    on('resetConfirmPassword', 'keydown', e => { if (e.key==='Enter') this.resetPasswordSubmit(); });

    // Sidebar gear icon → profile, avatar dropdown, auth tabs, password
    // visibility toggles, and the demo-login button all share one
    // delegated handler via data-action attributes.
    document.addEventListener('click', e => {
      const gear = e.target.closest('#openProfileModal');
      if (gear) { e.stopPropagation(); this.openProfile(); return; }

      // Avatar button → toggle dropdown
      const avatarBtn = e.target.closest('#topbarProfileBtn');
      if (avatarBtn) {
        e.stopPropagation();
        const dd = document.getElementById('avatarDropdown');
        const open = dd?.classList.toggle('show');
        avatarBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }

      // Close dropdown when clicking outside
      const wrap = e.target.closest('#avatarWrap');
      if (!wrap) {
        const dd = document.getElementById('avatarDropdown');
        dd?.classList.remove('show');
        document.getElementById('topbarProfileBtn')?.setAttribute('aria-expanded', 'false');
      }

      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'auth-tab-login')    this.showTab('login');
      else if (action === 'auth-tab-register') this.showTab('register');
      else if (action === 'auth-tab-forgot') this.showTab('forgot');
      else if (action === 'toggle-pwd')   this.togglePwd(actionEl.dataset.target);
      else if (action === 'try-demo')     this.tryDemo();
    });

    // Dropdown items
    on('avProfile', 'click', () => {
      document.getElementById('avatarDropdown').classList.remove('show');
      this.openProfile();
    });
    on('avLogout', 'click', () => {
      document.getElementById('avatarDropdown').classList.remove('show');
      this.logout();
    });
    on('closeProfileModal',   'click', () => document.getElementById('profileModal').classList.remove('open'));
    on('saveProfileBtn',      'click', () => this.saveProfile());
    on('changePasswordBtn',   'click', () => this.changePassword());
    on('deleteAccountBtn',    'click', () => this.openDeleteAccountModal());
    on('closeDeleteAccountModal', 'click', () => this.closeDeleteAccountModal());
    on('cancelDeleteAccountBtn',  'click', () => this.closeDeleteAccountModal());
    on('finalDeleteAccountBtn',   'click', () => this.submitDeleteAccount());
    on('logoutBtn',           'click', () => this.logout());

    // Real-time verification listeners for Account Deletion
    const phraseInput = document.getElementById('confirmDeletePhrase');
    const pwdInput = document.getElementById('confirmDeletePassword');
    const validateDel = () => this.checkDeleteVerification();
    phraseInput?.addEventListener('input', validateDel);
    pwdInput?.addEventListener('input', validateDel);
    pwdInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const btn = document.getElementById('finalDeleteAccountBtn');
        if (btn && !btn.disabled) this.submitDeleteAccount();
      }
    });

    // Profile tab delegation - works even when modal is hidden
    document.addEventListener('click', e => {
      const tab = e.target.closest('.profile-tab');
      if (!tab || !tab.dataset.ptab) return;
      document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.profile-panel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById('ptab-' + tab.dataset.ptab);
      if (panel) panel.style.display = 'block';
    });
  },

  showTab(tab) {
    const el = (id) => document.getElementById(id);
    if (el('formLogin'))    el('formLogin').style.display    = tab === 'login'    ? 'block' : 'none';
    if (el('formRegister')) el('formRegister').style.display = tab === 'register' ? 'block' : 'none';
    if (el('formForgot'))   el('formForgot').style.display   = tab === 'forgot'   ? 'block' : 'none';
    if (el('formReset'))    el('formReset').style.display    = tab === 'reset'    ? 'block' : 'none';

    const tabsRow = document.querySelector('.auth-tabs');
    if (tabsRow) tabsRow.style.display = (tab === 'forgot' || tab === 'reset') ? 'none' : 'grid';

    if (el('tabLogin')) {
      el('tabLogin').classList.toggle('active', tab === 'login');
      el('tabLogin').setAttribute('aria-selected', tab === 'login' ? 'true' : 'false');
    }
    if (el('tabRegister')) {
      el('tabRegister').classList.toggle('active', tab === 'register');
      el('tabRegister').setAttribute('aria-selected', tab === 'register' ? 'true' : 'false');
    }

    this.setError('loginError', '');
    this.setError('registerError', '');
    this.setError('forgotError', '');
    this.setError('resetError', '');
    if (el('forgotSuccess')) el('forgotSuccess').style.display = 'none';
  },

  async forgotPassword() {
    const email = document.getElementById('forgotEmail')?.value?.trim();
    this.setError('forgotError', '');
    const successEl = document.getElementById('forgotSuccess');
    if (successEl) successEl.style.display = 'none';
    if (!email) { this.setError('forgotError', 'Please enter your email'); return; }

    const btn = document.getElementById('forgotBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending link...'; }

    try {
      const data = await API.post('/auth/forgot', { email });
      if (successEl) {
        successEl.textContent = data.message || 'If this email is registered, password reset instructions have been sent.';
        successEl.style.display = 'block';
      }
    } catch (e) {
      this.setError('forgotError', e.message.replace(/^\d+:\s*/, ''));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link →'; }
    }
  },

  async resetPasswordSubmit() {
    const token = document.getElementById('resetToken')?.value;
    const newPassword = document.getElementById('resetNewPassword')?.value;
    const confirmPassword = document.getElementById('resetConfirmPassword')?.value;
    this.setError('resetError', '');

    if (!newPassword || !confirmPassword) {
      this.setError('resetError', 'Please fill in all fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.setError('resetError', 'Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      this.setError('resetError', 'Password must be at least 8 characters');
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      this.setError('resetError', 'Password must include at least one letter and one number');
      return;
    }

    const btn = document.getElementById('resetBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Resetting...'; }

    try {
      const data = await API.post('/auth/reset', { token, newPassword });
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('' + (data.message || 'Password reset successfully! Please login.'), 'success', 4000);
      }
      // Remove ?reset query from URL
      window.history.replaceState({}, document.title, window.location.pathname);
      this.showTab('login');
      const loginEmail = document.getElementById('loginEmail');
      if (loginEmail) loginEmail.focus();
    } catch (e) {
      this.setError('resetError', e.message.replace(/^\d+:\s*/, ''));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Set New Password →'; }
    }
  },

  togglePwd(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nowVisible = el.type === 'password';
    el.type = nowVisible ? 'text' : 'password';
    const btn = el.parentElement?.querySelector('.eye-btn');
    if (btn) btn.setAttribute('aria-label', nowVisible ? 'Hide password' : 'Show password');
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
      // Full reload rather than calling onLoggedIn() in-place: if App was
      // already initialized for a DIFFERENT user earlier in this browser
      // tab (session ended without hitting the logout button — closed
      // tab, expired token, etc.), App._started would still be true and
      // App.init() would silently be skipped, leaving the previous
      // user's dashboard/chat DOM on screen under the new login.
      // Reloading guarantees a clean slate every time, matching logout().
      window.location.reload();
    } catch(e) {
      this.setError('loginError', e.message.replace(/^\d+:\s*/, ''));
      btn.textContent = 'Login →'; btn.disabled = false;
    }
  },

  async register() {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm  = document.getElementById('regConfirm').value;
    this.setError('registerError', '');
    if (!name || !email || !password) { this.setError('registerError', 'Please fill in all fields'); return; }
    if (password !== confirm)          { this.setError('registerError', 'Passwords do not match'); return; }
    if (password.length < 8) {
      this.setError('registerError', 'Password must be at least 8 characters');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      this.setError('registerError', 'Password must include at least one letter and one number');
      return;
    }
    const btn = document.getElementById('registerBtn');
    btn.textContent = 'Creating account...'; btn.disabled = true;
    try {
      const data = await API.post('/auth/register', { name, email, password });
      this.storeSession(data, true);
      // See the comment in login() above — reload guarantees no stale
      // App/DOM state from an earlier session leaks into this new one.
      window.location.reload();
    } catch(e) {
      this.setError('registerError', e.message.replace(/^\d+:\s*/, ''));
      btn.textContent = 'Create Account →'; btn.disabled = false;
    }
  },

  async tryDemo() {
    this.setError('loginError', '');
    try {
      const data = await API.post('/auth/demo');
      this.storeSession(data, false);
      window.location.reload();
    } catch (e) {
      this.setError('loginError', e.message.replace(/^\d+:\s*/, ''));
    }
  },

  storeSession(data, remember) {
    localStorage.setItem('fl_user', JSON.stringify(data.user));
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

  async logout() {
    if (!confirm('Log out of FlowLedger?')) return;
    try { await API.post('/auth/logout'); } catch {}
    await API.clearToken();
    localStorage.removeItem('fl_user');
    localStorage.removeItem('fl_remember');
    if ('caches' in window) {
      try {
        for (const k of await caches.keys()) {
          await caches.delete(k);
        }
      } catch (_) {}
    }
    window.location.reload();
  },

  async openProfile() {
    try {
      // Use stored user data instead of API call to avoid JSON parse issues
      const stored = JSON.parse(localStorage.getItem('fl_user') || '{}');
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('profileName',     stored.name  || '');
      set('profileEmail',    stored.email || '');
      set('profileCurrency', stored.currency || '₹');
      // AI consent toggle
      const consentEl = document.getElementById('profileAiConsent');
      if (consentEl) consentEl.checked = Boolean(stored.ai_consent);
      document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.profile-panel').forEach(p => p.style.display = 'none');
      const firstTab = document.querySelector('.profile-tab');
      firstTab?.classList.add('active');
      firstTab?.setAttribute('aria-selected', 'true');
      const infoPanel = document.getElementById('ptab-info');
      if (infoPanel) infoPanel.style.display = 'block';
      document.getElementById('profileModal')?.classList.add('open');
    } catch(e) { console.error('openProfile error:', e); }
  },

  async saveProfile() {
    const nameEl = document.getElementById('profileName');
    const currEl = document.getElementById('profileCurrency');
    const consentEl = document.getElementById('profileAiConsent');
    if (!nameEl || !currEl) { alert('Something went wrong loading the form'); return; }
    const name       = nameEl.value.trim();
    const currency   = currEl.value;
    const ai_consent = consentEl ? consentEl.checked : false;
    if (!name) { alert('Name cannot be empty'); return; }
    try {
      await API.put('/auth/profile', { name, currency, ai_consent });
      const user = JSON.parse(localStorage.getItem('fl_user') || '{}');
      user.name = name; user.currency = currency; user.ai_consent = ai_consent;
      localStorage.setItem('fl_user', JSON.stringify(user));
      this.onLoggedIn(user);
      document.getElementById('profileModal')?.classList.remove('open');
      UI.toast('Profile updated', 'success');
    } catch(e) { alert(e.message.replace(/^\d+:\s*/,'')); }
  },

  async changePassword() {
    const curEl = document.getElementById('currentPwd');
    const newEl = document.getElementById('newPwd');
    const confEl = document.getElementById('confirmPwd');
    if (!curEl || !newEl || !confEl) { alert('Something went wrong loading the form'); return; }
    const current = curEl.value;
    const newPwd  = newEl.value;
    const confirm = confEl.value;
    if (!current || !newPwd) { alert('Please fill in all fields'); return; }
    if (newPwd !== confirm)  { alert('Passwords do not match'); return; }
    if (newPwd.length < 6)   { alert('Password must be at least 6 characters'); return; }
    try {
      await API.put('/auth/password', { currentPassword:current, newPassword:newPwd });
      ['currentPwd','newPwd','confirmPwd'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('profileModal')?.classList.remove('open');
      UI.toast('Password changed', 'success');
    } catch(e) { alert(e.message.replace(/^\d+:\s*/,'')); }
  },

  openDeleteAccountModal() {
    // Hide profile modal first so the confirmation modal has clear focus
    document.getElementById('profileModal')?.classList.remove('open');
    const modal = document.getElementById('deleteAccountModal');
    if (!modal) return;

    // Reset inputs & status
    const phrase = document.getElementById('confirmDeletePhrase');
    const pwd = document.getElementById('confirmDeletePassword');
    const btn = document.getElementById('finalDeleteAccountBtn');
    const badge = document.getElementById('delMatchBadge');
    const btnText = document.getElementById('finalDeleteAccountText');

    if (phrase) phrase.value = '';
    if (pwd) pwd.value = '';
    if (btn) btn.disabled = true;
    if (badge) {
      badge.textContent = 'REQUIRED';
      badge.style.color = 'var(--text-tertiary)';
    }
    if (btnText) btnText.textContent = 'Permanently Delete Account';

    modal.classList.add('open');
    setTimeout(() => phrase?.focus(), 150);
  },

  closeDeleteAccountModal() {
    document.getElementById('deleteAccountModal')?.classList.remove('open');
  },

  checkDeleteVerification() {
    const phraseInput = document.getElementById('confirmDeletePhrase');
    const pwdInput = document.getElementById('confirmDeletePassword');
    const btn = document.getElementById('finalDeleteAccountBtn');
    const badge = document.getElementById('delMatchBadge');
    if (!phraseInput || !btn) return;

    const val = phraseInput.value.trim();
    let userEmail = '';
    try {
      const u = JSON.parse(localStorage.getItem('fl_user') || '{}');
      userEmail = (u.email || '').toLowerCase();
    } catch {}

    const isMatch = val.toUpperCase() === 'DELETE' || (userEmail && val.toLowerCase() === userEmail);
    const hasPwd = pwdInput ? pwdInput.value.length >= 1 : true;

    if (badge) {
      if (isMatch) {
        badge.textContent = 'VERIFIED';
        badge.style.color = 'var(--income)';
      } else {
        badge.textContent = 'REQUIRED';
        badge.style.color = 'var(--text-tertiary)';
      }
    }

    btn.disabled = !(isMatch && hasPwd);
  },

  async submitDeleteAccount() {
    const phraseInput = document.getElementById('confirmDeletePhrase');
    const pwdInput = document.getElementById('confirmDeletePassword');
    const btn = document.getElementById('finalDeleteAccountBtn');
    const btnText = document.getElementById('finalDeleteAccountText');

    const phrase = phraseInput?.value.trim();
    const password = pwdInput?.value;

    let userEmail = '';
    try {
      const u = JSON.parse(localStorage.getItem('fl_user') || '{}');
      userEmail = (u.email || '').toLowerCase();
    } catch {}

    if (phrase?.toUpperCase() !== 'DELETE' && (!userEmail || phrase?.toLowerCase() !== userEmail)) {
      UI.toast('Please type DELETE to verify', 'error');
      phraseInput?.focus();
      return;
    }

    if (!password) {
      UI.toast('Please enter your password to confirm', 'error');
      pwdInput?.focus();
      return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Wiping account & data...';

    try {
      await API.del('/auth/account', { password });
      
      this.closeDeleteAccountModal();
      UI.toast('Account permanently deleted. Goodbye!', 'success', 3500);

      // Clean storage and redirect to login after short delay
      setTimeout(() => {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
      }, 1400);
    } catch (e) {
      const msg = e.message.replace(/^\d+:\s*/, '');
      UI.toast(msg || 'Failed to delete account', 'error');
      if (btn) btn.disabled = false;
      if (btnText) btnText.textContent = 'Permanently Delete Account';
      if (pwdInput) {
        pwdInput.value = '';
        pwdInput.focus();
      }
      this.checkDeleteVerification();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());