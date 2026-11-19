import { State } from './state.js';

export const ProfileModule = {
  async loadAccounts(forceRerender = false) {
    try {
      State.accounts = await API.get('/accounts');
      UI.populateAccountSelects(State.accounts);
      UI.renderAccountStrip(State.accounts);
      if (forceRerender) {
        UI.renderAccounts(State.accounts);
        if (typeof this.loadCashflowForecast === 'function') this.loadCashflowForecast();
      }
    } catch (e) {
      console.error('Load accounts error:', e);
      if (forceRerender) UI.toast('⚠ Could not load accounts', 'error');
    }
  },

  async saveAccount() {
    const nameEl = document.getElementById('accountName');
    const typeEl = document.getElementById('accountType');
    const balEl = document.getElementById('accountStartingBalance');
    const currEl = document.getElementById('accountCurrency');
    const editIdEl = document.getElementById('editAccountId');
    if (!nameEl || !typeEl || !balEl || !editIdEl) { UI.toast('⚠ Something went wrong loading the form', 'error'); return; }

    const name = nameEl.value.trim();
    const type = typeEl.value;
    const starting_balance = parseFloat(balEl.value) || 0;
    const currency = currEl?.value || 'INR';
    const editId = editIdEl.value;
    if (!name) { UI.toast('⚠ Enter an account name', 'error'); return; }

    const btn = document.getElementById('saveAccountBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      if (editId) {
        await API.put(`/accounts/${editId}`, { name, type, starting_balance, currency });
        UI.toast('✓ Account updated', 'success');
      } else {
        await API.post('/accounts', { name, type, starting_balance, currency });
        UI.toast('✓ Account added', 'success');
      }
      UI.closeAccountModal();
      await this.loadAccounts(State.page === 'accounts');
      if (State.page === 'dashboard' && typeof this.loadDashboard === 'function') await this.loadDashboard();
    } catch (e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/, ''), 'error');
    } finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save Account'; } }
  },

  editAccount(id) {
    const account = State.accounts.find(a => a.id === id);
    if (account) UI.openAccountModal(account);
  },

  async deleteAccount(id) {
    if (!confirm('Delete this account? Transactions on it will stay in your history but become unassigned.')) return;
    try {
      await API.del(`/accounts/${id}`);
      UI.toast('✓ Account removed', 'success');
      await this.loadAccounts(true);
      if (State.page === 'dashboard' && typeof this.loadDashboard === 'function') await this.loadDashboard();
    } catch (e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/, ''), 'error');
    }
  },

  bindMobile() {
    const hb = document.getElementById('hamburger');
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebarOverlay');
    hb?.addEventListener('click', () => {
      const open = sb?.classList.toggle('open');
      ov?.classList.toggle('show');
      hb?.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    ov?.addEventListener('click', () => { sb?.classList.remove('open'); ov?.classList.remove('show'); });
  },

  bindTheme() {
    const saved = localStorage.getItem('fl_theme');
    if (saved === 'dark') document.body.classList.add('dark');

    const btn = document.getElementById('themeToggleBtn');
    btn?.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark');
      localStorage.setItem('fl_theme', isDark ? 'dark' : 'light');
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', isDark ? '#0F172A' : '#6366F1');
    });
  },

  bindSidebarCollapse() {
    const isCompact = localStorage.getItem('fl_sidebar_compact') === 'true';
    if (isCompact) {
      document.body.classList.add('sidebar-compact');
      document.getElementById('sidebar')?.classList.add('collapsed');
    }

    const btn = document.getElementById('sidebarCollapseBtn');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const compact = document.body.classList.toggle('sidebar-compact');
      document.getElementById('sidebar')?.classList.toggle('collapsed', compact);
      localStorage.setItem('fl_sidebar_compact', compact ? 'true' : 'false');
    });
  },

  bindPrivacyMode() {
    const isPrivacy = localStorage.getItem('fl_privacy_mode') === 'true';
    if (isPrivacy) document.body.classList.add('privacy-mode');

    const btn = document.getElementById('privacyModeBtn');
    btn?.addEventListener('click', () => {
      this.togglePrivacyMode();
    });
  },

  togglePrivacyMode() {
    const isPrivacy = document.body.classList.toggle('privacy-mode');
    localStorage.setItem('fl_privacy_mode', isPrivacy ? 'true' : 'false');
    UI.toast(isPrivacy ? '👁️ Privacy mode ON — sensitive amounts blurred' : '👁️ Privacy mode OFF — amounts visible', 'info');
  },

  bindKeyboard() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const s = document.getElementById('globalSearch');
        if (s) { s.focus(); s.select(); }
      }
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open, .modal.open').forEach(m => m.classList.remove('open'));
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        UI.openAddModal();
      }
      if (e.shiftKey && (e.key === 'P' || e.key === 'p') && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
          e.preventDefault();
          this.togglePrivacyMode();
        }
      }
    });
  },

  bindCurrencyFeatures() {
    const accCurr = document.getElementById('accountCurrency');
    if (accCurr) {
      accCurr.addEventListener('change', () => {
        const sym = getCurrencySymbol(accCurr.value);
        const symEl = document.getElementById('accountCurrencySymbol');
        if (symEl) symEl.textContent = sym;
      });
    }

    const txnCurr = document.getElementById('txnCurrency');
    if (txnCurr) {
      txnCurr.addEventListener('change', () => {
        const sym = getCurrencySymbol(txnCurr.value);
        const symEl = document.getElementById('txnCurrSymbol');
        if (symEl) symEl.textContent = sym;
        this.updateFxPreview();
      });
    }

    const txnAmt = document.getElementById('txnAmount');
    if (txnAmt) {
      txnAmt.addEventListener('input', () => this.updateFxPreview());
    }

    const txnAcc = document.getElementById('txnAccount');
    if (txnAcc) {
      txnAcc.addEventListener('change', () => {
        const selectedOpt = txnAcc.selectedOptions[0];
        const accCurrency = selectedOpt?.dataset?.currency;
        if (accCurrency && txnCurr) {
          txnCurr.value = accCurrency;
          const sym = getCurrencySymbol(accCurrency);
          const symEl = document.getElementById('txnCurrSymbol');
          if (symEl) symEl.textContent = sym;
          this.updateFxPreview();
        }
      });
    }

    const toggleRateBtn = document.getElementById('btnToggleCustomFxRate');
    const fxRateRow = document.getElementById('fxRateEditRow');
    if (toggleRateBtn && fxRateRow) {
      toggleRateBtn.addEventListener('click', () => {
        const isHidden = fxRateRow.style.display === 'none';
        fxRateRow.style.display = isHidden ? 'block' : 'none';
        toggleRateBtn.textContent = isHidden ? 'Hide Custom Rate' : 'Custom Rate';
      });
    }

    const customRateInput = document.getElementById('txnCustomRate');
    if (customRateInput) {
      customRateInput.addEventListener('input', () => this.updateFxPreview());
    }

    const resetRateBtn = document.getElementById('btnResetFxRate');
    if (resetRateBtn && customRateInput) {
      resetRateBtn.addEventListener('click', () => {
        customRateInput.value = '';
        this.updateFxPreview();
      });
    }

    const openConvBtn = document.getElementById('openConverterBtn');
    const convModal = document.getElementById('currencyConverterModal');
    const closeConvBtn = document.getElementById('closeConverterModal');
    if (openConvBtn && convModal) {
      openConvBtn.addEventListener('click', () => {
        convModal.classList.add('open');
        this.updateConverterCalc();
      });
    }
    if (closeConvBtn && convModal) {
      closeConvBtn.addEventListener('click', () => {
        convModal.classList.remove('open');
      });
    }

    const convAmt = document.getElementById('convAmount');
    const convFrom = document.getElementById('convFrom');
    const convTo = document.getElementById('convTo');
    const convSwap = document.getElementById('convSwapBtn');

    [convAmt, convFrom, convTo].forEach(el => {
      if (el) el.addEventListener('input', () => this.updateConverterCalc());
    });

    if (convSwap && convFrom && convTo) {
      convSwap.addEventListener('click', () => {
        const temp = convFrom.value;
        convFrom.value = convTo.value;
        convTo.value = temp;
        this.updateConverterCalc();
      });
    }
  },

  async updateFxPreview() {
    const currEl = document.getElementById('txnCurrency');
    const amtEl = document.getElementById('txnAmount');
    const previewEl = document.getElementById('txnFxPreview');
    const previewText = document.getElementById('txnFxText');
    const customRateEl = document.getElementById('txnCustomRate');
    if (!currEl || !amtEl || !previewEl || !previewText) return;

    const baseCurrCode = normalizeCurrCode(currentCurrency());
    const selectedCurr = currEl.value || baseCurrCode;
    const amount = parseFloat(amtEl.value) || 0;

    if (normalizeCurrCode(selectedCurr) === baseCurrCode || amount <= 0) {
      previewEl.style.display = 'none';
      return;
    }

    previewEl.style.display = 'flex';
    const customRate = (customRateEl && customRateEl.value && !isNaN(parseFloat(customRateEl.value)))
      ? parseFloat(customRateEl.value)
      : null;

    try {
      const res = await API.convertCurrency(amount, selectedCurr, baseCurrCode, customRate);
      if (res && res.converted !== undefined) {
        const baseSym = getCurrencySymbol(baseCurrCode);
        previewText.textContent = `≈ ${baseSym}${res.converted.toLocaleString(CURRENCY_LOCALE[baseSym]||'en-IN')} (1 ${selectedCurr} = ${baseSym}${res.rate})`;
        if (customRateEl && !customRateEl.value) {
          customRateEl.placeholder = res.rate;
        }
      }
    } catch (e) {
      console.warn('FX preview error:', e);
    }
  },

  async updateConverterCalc() {
    const amtEl = document.getElementById('convAmount');
    const fromEl = document.getElementById('convFrom');
    const toEl = document.getElementById('convTo');
    const lineEl = document.getElementById('convRateLine');
    const resEl = document.getElementById('convResultAmount');
    if (!amtEl || !fromEl || !toEl || !lineEl || !resEl) return;

    const amount = parseFloat(amtEl.value) || 0;
    const from = fromEl.value;
    const to = toEl.value;

    try {
      const data = await API.convertCurrency(amount, from, to);
      const toSym = getCurrencySymbol(to);
      lineEl.textContent = `1 ${from} = ${data.rate} ${to}`;
      resEl.textContent = `${toSym}${data.converted.toLocaleString(CURRENCY_LOCALE[toSym] || 'en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    } catch (err) {
      console.warn('Converter calc error:', err);
    }
  }
};

export default ProfileModule;
