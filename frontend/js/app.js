// ── Apply saved theme & sidebar state immediately (before DOM paint) ──────────
(function () {
  const t = localStorage.getItem('fl_theme');
  if (t === 'dark') document.documentElement.classList.add('dark-pre');

  const s = localStorage.getItem('fl_sidebar_compact');
  if (s === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body?.classList.add('sidebar-compact');
      document.getElementById('sidebar')?.classList.add('collapsed');
    });
  }

  const p = localStorage.getItem('fl_privacy_mode');
  if (p === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body?.classList.add('privacy-mode');
    });
  }
})();

// ── State ──────────────────────────────────────────────────────
const State = {
  page: 'dashboard',
  month: new Date().getMonth() + 1,
  year:  new Date().getFullYear(),
  transactions: [],
  summary: {},
  // Goals load from the backend (see loadGoals) — no longer localStorage,
  // so they survive a cleared browser or a switch to a new device.
  goals: [],
  // Accounts load once at App.init() (not per-page) since the account
  // <select> in the transaction modal, the transactions filter, and the
  // import page all need it available before the user ever visits the
  // dedicated Accounts page.
  accounts: [],
  // Transactions-page pagination (separate from the small `limit=`
  // snapshots the dashboard/analytics widgets pull — those stay unpaginated).
  txnPage: 1,
  txnPageSize: 50,
  txnTotal: 0,
  aiModel: localStorage.getItem('fl_ai_model') || 'chatgpt',
  aiSessionId: null,
  aiSessions: []
};

// ── App ────────────────────────────────────────────────────────
const App = {
  async init() {
    this.bindTheme();
    this.bindPrivacyMode();
    this.bindSidebarCollapse();
    this.bindKeyboard();
    this.bindVoiceInput();
    this.setGreeting();
    this.setTopbarDate();
    this.bindNav();
    this.bindModals();
    this.bindFilters();
    this.bindChat();
    this.bindMobile();
    this.bindSearch();
    this.bindAISmartTools();
    this.updateNavCount();
    Notifications.init();
    Tags.init();
    await this.loadAccounts();
    await this.loadDashboard();
    Recurring.load();
  },

  setGreeting() {
    const h  = new Date().getHours();
    const el = document.getElementById('greeting');
    if (el) el.textContent = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  },

  setTopbarDate() {
    const el = document.getElementById('topbarDate');
    if (el) el.textContent = new Date().toLocaleDateString('en-IN', {weekday:'short',day:'numeric',month:'short',year:'numeric'});
  },

  // ── Navigation ─────────────────────────────────────────────
  bindNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.navigate(btn.dataset.page);
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
      });
    });
    this.on('prevMonth', 'click', () => {
      State.month--; if (State.month < 1) { State.month = 12; State.year--; }
      this.loadDashboard();
    });
    this.on('nextMonth', 'click', () => {
      State.month++; if (State.month > 12) { State.month = 1; State.year++; }
      this.loadDashboard();
    });
    this.on('quickAdd',   'click', () => UI.openAddModal());
    this.on('exportBtn',  'click', () => API.exportCSV());
    this.on('getTipBtn',  'click', () => this.getQuickTip());
  },

  async navigate(page) {
    State.page = page;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    if      (page === 'dashboard')    await this.loadDashboard();
    else if (page === 'transactions') await this.loadTransactions();
    else if (page === 'accounts')     await this.loadAccounts(true);
    else if (page === 'budgets')      await this.loadBudgets();
    else if (page === 'analytics')    await this.loadAnalytics();
    else if (page === 'ai')           await this.loadAI();
    else if (page === 'goals')        await this.loadGoals();
    else if (page === 'recurring')    await Recurring.load();
    else if (page === 'groups')       await Groups.init();
    else if (page === 'import')             Importer.init();
    else if (page === 'reports')            this.initReports();
  },

  // ── Dashboard ──────────────────────────────────────────────
  async loadDashboard() {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ml = document.getElementById('monthLabel');
    const cl = document.getElementById('currentMonthLabel');
    if (ml) ml.textContent = months[State.month - 1];
    if (cl) cl.textContent = `${months[State.month - 1]} ${State.year}`;

    const kpiIds = ['kpiBalance','kpiIncome','kpiExpense','kpiSavings'];
    kpiIds.forEach(id => document.getElementById(id)?.classList.add('is-loading'));

    try {
      const isCurrentMonth = State.month === (new Date().getMonth() + 1) && State.year === new Date().getFullYear();
      const [summary, txns, budgets] = await Promise.all([
        API.get(`/summary?month=${State.month}&year=${State.year}`),
        API.get('/transactions?limit=6'),
        // Budgets always reflect the CURRENT calendar month server-side, so
        // only fetch/show the alert when that's actually what's on screen —
        // otherwise browsing a past month would show a misleading "over
        // budget" banner for spending that happened in a different month.
        isCurrentMonth ? API.get('/budgets') : Promise.resolve([])
      ]);
      State.summary = summary;
      State.transactions = txns;

      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      setText('kpiBalance', fmt(summary.balance));
      const balEl = document.getElementById('kpiBalance');
      if (balEl) balEl.classList.toggle('negative', summary.balance < 0);
      setText('kpiIncome',  fmt(summary.income));
      setText('kpiExpense', fmt(summary.expense));
      setText('kpiSavings', summary.savingsRate + '%');
      kpiIds.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));

      const sr = parseFloat(summary.savingsRate);
      setText('savingsStatus', sr >= 30 ? 'Excellent! 🎉' : sr >= 15 ? 'Good job! 👍' : sr > 0 ? 'Keep improving' : 'No savings yet');

      const badge = document.getElementById('balanceBadge');
      if (badge) { badge.textContent = summary.savingsRate + '% saved'; badge.className = sr >= 0 ? 'kpi-badge' : 'kpi-badge neg'; }

      UI.updateSidebar(summary.income, summary.expense, summary.balance);
      this.updateAIStats(summary);
      Charts.renderDoughnut(summary.byCategory);
      Charts.renderBar(summary.monthlyTrend);

      // Forecast
      if (summary.forecastExpense > 0) {
        const fb = document.getElementById('forecastBanner');
        const fa = document.getElementById('forecastBannerAmt');
        const fb2 = document.getElementById('forecastBadge');
        const fa2 = document.getElementById('forecastAmt');
        if (fb) fb.style.display = 'flex';
        if (fa) fa.textContent = fmt(summary.forecastExpense);
        if (fb2) fb2.style.display = 'block';
        if (fa2) fa2.textContent = fmt(summary.forecastExpense);
      }

      this.renderBudgetAlert(budgets);
      this.updateHealthScore(summary, budgets, State.accounts);
      this.loadBurnRate();
      UI.renderTxnList(txns, 'recentTxns', 6, false);
      UI.renderTopCats(summary.byCategory || []);

      const inTxns = txns.filter(t => t.type === 'income').length;
      const exTxns = txns.filter(t => t.type === 'expense').length;
      setText('incomeCount',  `${inTxns} transaction${inTxns !== 1 ? 's' : ''}`);
      setText('expenseCount', `${exTxns} transaction${exTxns !== 1 ? 's' : ''}`);

    } catch(e) {
      console.error('Dashboard error:', e);
      kpiIds.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));
      UI.toast('⚠ Could not load data. Is the server running?', 'error');
    }
  },

  updateAIStats(summary) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('aiStatInc', fmt(summary.income  || 0));
    set('aiStatExp', fmt(summary.expense || 0));
    set('aiStatSav', fmt((summary.income || 0) - (summary.expense || 0)));
  },

  // Feeds the notification bell (topbar, visible on every page) when any
  // budget is over 100%, or nearing it (>=80%) — a budget's status used to
  // only ever show up on the Budgets page itself, so a user could go the
  // whole month without noticing they're close to (or already past) a
  // limit unless they happened to open that one page.
  renderBudgetAlert(budgets) {
    const over    = (budgets || []).filter(b => b.percent >= 100);
    const nearing = (budgets || []).filter(b => b.percent >= 80 && b.percent < 100);
    const items = [
      ...over.map(b => ({
        icon: '🚨', level: '',
        title: `Over budget: ${b.category}`,
        sub: `Spent ${fmt(b.spent)} of ${fmt(b.monthly_limit)} limit (${b.percent}%)`
      })),
      ...nearing.map(b => ({
        icon: '⚠️', level: 'warn',
        title: `Approaching limit: ${b.category}`,
        sub: `Spent ${fmt(b.spent)} of ${fmt(b.monthly_limit)} limit (${b.percent}%)`
      }))
    ];
    Notifications.setBudgetAlerts(items);
  },

  async updateNavCount() {
    try {
      const txns = await API.get('/transactions?limit=500');
      const el = document.getElementById('txn-count');
      if (el) el.textContent = txns.length;
    } catch {}
  },

  async getQuickTip() {
    const btn = document.getElementById('getTipBtn');
    const tip = document.getElementById('aiTip');
    if (!tip || !btn) return;
    btn.textContent = 'Loading...'; btn.disabled = true;
    try {
      const { reply } = await API.post('/ai/chat', { message: 'Give me one quick financial tip based on my current spending. 2 sentences max.' });
      tip.textContent = reply;
    } catch {
      tip.textContent = 'Connect AI to get personalized insights!';
    } finally { btn.textContent = 'Get Insight'; btn.disabled = false; }
  },

  // ── Transactions ───────────────────────────────────────────
  async loadTransactions(filters={}, resetPage=true) {
    const list = document.getElementById('allTxns');
    list?.classList.add('is-fetching');
    if (resetPage) State.txnPage = 1;
    try {
      const qs = new URLSearchParams();
      if (filters.type)       qs.set('type',       filters.type);
      if (filters.category)   qs.set('category',   filters.category);
      if (filters.from)       qs.set('from',       filters.from);
      if (filters.to)         qs.set('to',         filters.to);
      if (filters.account_id) qs.set('account_id', filters.account_id);
      if (filters.tag)        qs.set('tag',        filters.tag);
      if (filters.search)     qs.set('search',     filters.search);
      if (filters.min_amount) qs.set('min_amount', filters.min_amount);
      if (filters.max_amount) qs.set('max_amount', filters.max_amount);
      if (filters.sort)       qs.set('sort',       filters.sort);
      qs.set('limit', State.txnPageSize);
      qs.set('page',  State.txnPage);
      const { data: txns, total } = await API.getWithCount('/transactions?' + qs);
      State.transactions = txns;
      State.txnTotal = total;
      State.lastTxnFilters = filters;
      UI.renderTxnList(txns, 'allTxns', null, true);
      this.renderTxnPagination();
      this.updateTxnFilterResultsBar(filters, total, txns);
    } catch { UI.toast('Error loading transactions', 'error'); }
    finally { list?.classList.remove('is-fetching'); }
  },

  renderTxnPagination() {
    const totalPages = Math.max(Math.ceil(State.txnTotal / State.txnPageSize), 1);
    const label = document.getElementById('txnPageLabel');
    const prev  = document.getElementById('txnPrevPage');
    const next  = document.getElementById('txnNextPage');
    if (label) label.textContent = `Page ${State.txnPage} of ${totalPages} (${State.txnTotal} total)`;
    if (prev)  prev.disabled = State.txnPage <= 1;
    if (next)  next.disabled = State.txnPage >= totalPages;
  },

  async saveTxn() {
    const descEl = document.getElementById('txnDesc');
    const amtEl  = document.getElementById('txnAmount');
    const dateEl = document.getElementById('txnDate');
    const catEl  = document.getElementById('txnCategory');
    const accEl  = document.getElementById('txnAccount');
    if (!descEl || !amtEl || !dateEl || !catEl) { UI.toast('⚠ Something went wrong loading the form', 'error'); return; }

    const desc       = descEl.value.trim();
    const amount     = parseFloat(amtEl.value);
    const date       = dateEl.value;
    const category   = catEl.value;
    const type       = UI.currentType;
    const account_id = accEl?.value || null;
    const tags       = Tags.getPills();
    if (!desc || !amount || !date || !category) { UI.toast('⚠ Fill in all fields', 'error'); return; }
    if (amount <= 0) { UI.toast('⚠ Amount must be greater than 0', 'error'); return; }

    const btn = document.getElementById('saveTxnBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      let budgetToastShown = false;
      if (UI.editId) {
        await API.put(`/transactions/${UI.editId}`, { description:desc, amount, type, category, date, account_id, tags });
        UI.toast('✓ Transaction updated', 'success');
      } else {
        await API.post('/transactions', { description:desc, amount, type, category, date, account_id, tags });
        // Only worth checking for a fresh expense in the current month —
        // that's the only case /api/budgets' spend total actually covers,
        // and only expenses count against a budget in the first place.
        const isCurrentMonth = new Date(date).toISOString().slice(0,7) === new Date().toISOString().slice(0,7);
        if (type === 'expense' && isCurrentMonth) {
          budgetToastShown = await this.checkBudgetAfterSave(category);
        }
        if (!budgetToastShown) UI.toast('✓ Transaction added', 'success');
      }
      UI.closeAddModal();
      this.updateNavCount();
      Tags.populateFilterSelect();
      // A transaction changes account balances, so refresh accounts too —
      // cheap call, keeps the dashboard strip and Accounts page correct
      // without waiting for the user to navigate away and back.
      this.loadAccounts(State.page === 'accounts');
      if (State.page === 'transactions') await this.loadTransactions();
      else await this.loadDashboard();
    } catch(e) { UI.toast(e.message.match(/^\d+:/) ? 'Error: ' + e.message : e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save'; } }
  },

  // Re-fetches budgets right after saving and, if the just-saved category
  // has a budget that's now at/over its limit, shows that instead of the
  // generic "Transaction added" toast. Returns true if it showed a
  // budget-specific toast (so the caller skips the generic one).
  async checkBudgetAfterSave(category) {
    try {
      const budgets = await API.get('/budgets');
      const match = budgets.find(b => b.category === category);
      if (!match) return false;
      if (match.percent >= 100) {
        UI.toast(`⚠ Over budget for ${category} (${match.percent}%)`, 'error', 4000);
        return true;
      }
      if (match.percent >= 80) {
        UI.toast(`⚠ ${category} budget at ${match.percent}%`, 'error', 3500);
        return true;
      }
      return false;
    } catch { return false; } // budget check is a nice-to-have, never block the save on it
  },

  async editTxn(id) {
    try {
      // Fetches the single row directly — previously pulled the (capped,
      // most-recent-200) list and searched it client-side, which silently
      // did nothing when the clicked transaction was older than that.
      const txn = await API.get(`/transactions/${id}`);
      UI.openAddModal(txn);
    } catch { UI.toast('Could not load transaction', 'error'); }
  },

  async deleteTxn(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await API.del(`/transactions/${id}`);
      UI.toast('✓ Deleted', 'success');
      this.updateNavCount();
      this.loadAccounts(State.page === 'accounts');
      if (State.page === 'transactions') await this.loadTransactions();
      else await this.loadDashboard();
    } catch { UI.toast('Error deleting', 'error'); }
  },

  // ── Accounts ───────────────────────────────────────────────
  // forceRerender=true when called from navigate() (user is actually
  // looking at the Accounts page); false on the init() background load,
  // where we only need State.accounts populated for the selects/strip.
  async loadAccounts(forceRerender=false) {
    try {
      State.accounts = await API.get('/accounts');
      UI.populateAccountSelects(State.accounts);
      UI.renderAccountStrip(State.accounts);
      if (forceRerender) UI.renderAccounts(State.accounts);
    } catch(e) {
      console.error('Load accounts error:', e);
      if (forceRerender) UI.toast('⚠ Could not load accounts', 'error');
    }
  },

  async saveAccount() {
    const nameEl  = document.getElementById('accountName');
    const typeEl  = document.getElementById('accountType');
    const balEl   = document.getElementById('accountStartingBalance');
    const editIdEl = document.getElementById('editAccountId');
    if (!nameEl || !typeEl || !balEl || !editIdEl) { UI.toast('⚠ Something went wrong loading the form', 'error'); return; }

    const name             = nameEl.value.trim();
    const type              = typeEl.value;
    const starting_balance = parseFloat(balEl.value) || 0;
    const editId            = editIdEl.value;
    if (!name) { UI.toast('⚠ Enter an account name', 'error'); return; }

    const btn = document.getElementById('saveAccountBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      if (editId) {
        await API.put(`/accounts/${editId}`, { name, type, starting_balance });
        UI.toast('✓ Account updated', 'success');
      } else {
        await API.post('/accounts', { name, type, starting_balance });
        UI.toast('✓ Account added', 'success');
      }
      UI.closeAccountModal();
      await this.loadAccounts(State.page === 'accounts');
      if (State.page === 'dashboard') await this.loadDashboard();
    } catch(e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/,''), 'error');
    } finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save Account'; } }
  },

  editAccount(id) {
    const account = State.accounts.find(a => a.id === id);
    if (account) UI.openAccountModal(account);
  },

  async deleteAccount(id) {
    // Deleting an account never deletes its transactions — see the
    // ON DELETE SET NULL comment on the backend route. They just show
    // as unassigned afterward, so this confirm only needs to warn about
    // the account itself, not the history behind it.
    if (!confirm('Delete this account? Transactions on it will stay in your history but become unassigned.')) return;
    try {
      await API.del(`/accounts/${id}`);
      UI.toast('✓ Account removed', 'success');
      await this.loadAccounts(true);
      if (State.page === 'dashboard') await this.loadDashboard();
    } catch(e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/,''), 'error');
    }
  },

  // ── Budgets ────────────────────────────────────────────────
  async loadBudgets() {
    try { UI.renderBudgets(await API.get('/budgets')); }
    catch { UI.toast('Error loading budgets', 'error'); }
  },

  async saveBudget() {
    const catEl = document.getElementById('budgetCategory');
    const limEl = document.getElementById('budgetLimit');
    if (!catEl || !limEl) { UI.toast('⚠ Something went wrong loading the form', 'error'); return; }
    const category      = catEl.value;
    const monthly_limit = parseFloat(limEl.value);
    if (!monthly_limit || monthly_limit <= 0) { UI.toast('⚠ Enter a valid limit', 'error'); return; }
    const btn = document.getElementById('saveBudgetBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      await API.post('/budgets', { category, monthly_limit });
      UI.toast('✓ Budget saved', 'success');
      UI.closeBudgetModal();
      await this.loadBudgets();
    } catch { UI.toast('Error saving budget', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save Budget'; } }
  },

  async deleteBudget(id) {
    if (!confirm('Remove this budget?')) return;
    try { await API.del(`/budgets/${id}`); UI.toast('✓ Removed', 'success'); await this.loadBudgets(); }
    catch { UI.toast('Error removing budget', 'error'); }
  },

  // ── Smart Budget Auto-Planner ──────────────────────────────
  async openAutoBudgetPlanner() {
    const panel = document.getElementById('autoBudgetPanel');
    if (!panel) return;
    panel.style.display = '';
    await this.fetchBudgetSuggestions();
  },

  closeAutoBudgetPlanner() {
    const panel = document.getElementById('autoBudgetPanel');
    if (panel) panel.style.display = 'none';
  },

  async fetchBudgetSuggestions() {
    const refreshBtn = document.getElementById('refreshAutoBudgetBtn');
    const bannerText = document.getElementById('autoBudgetAiText');
    const list = document.getElementById('autoBudgetList');
    if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '⏳ Analyzing...'; }
    if (bannerText) bannerText.textContent = 'Analyzing your 90-day spending velocity across categories...';
    if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">⏳ Running AI spending diagnosis and computing realistic caps...</div>';

    try {
      const data = await API.get('/budgets/suggest');
      this._budgetSuggestions = data.suggestions || [];
      this.renderBudgetSuggestions(data);
    } catch (e) {
      console.error('Auto budget error:', e);
      UI.toast('Could not generate budget suggestions: ' + (e.message || 'Error'), 'error');
      if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--expense)">⚠ Failed to load suggestions. Please try again.</div>';
    } finally {
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Re-analyze'; }
    }
  },

  renderBudgetSuggestions(data) {
    const { suggestions, totalSuggested, totalCurrent, aiSummary } = data;
    const bannerText = document.getElementById('autoBudgetAiText');
    if (bannerText) bannerText.innerHTML = (aiSummary || 'Personalized budget targets calculated based on spending history.').replace(/\n/g, '<br>');

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('abStatCategories', (suggestions || []).length);
    setText('abStatCurrent', fmt(totalCurrent || 0));
    setText('abStatSuggested', fmt(totalSuggested || 0));

    const list = document.getElementById('autoBudgetList');
    if (!list) return;

    if (!suggestions || suggestions.length === 0) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">No spending categories detected yet. Add transactions to generate personalized limits!</div>';
      return;
    }

    list.innerHTML = suggestions.map((s, idx) => {
      const color = (typeof CAT_COLORS !== 'undefined' && CAT_COLORS[s.category]) || '#6366F1';
      const emoji = (typeof CAT_EMOJIS !== 'undefined' && CAT_EMOJIS[s.category]) || '🏷️';
      const trendLabel = s.trend === 'increasing' ? '↗ Trending +15%' : s.trend === 'decreasing' ? '↘ Downward' : s.trend === 'starter' ? '⭐ Starter' : '➡ Stable';

      return `
        <div class="ab-item-row" id="abRow_${idx}" data-idx="${idx}">
          <div class="ab-item-check">
            <input type="checkbox" class="ab-row-check" data-idx="${idx}" checked />
          </div>
          <div class="ab-cat-cell">
            <div class="ab-cat-badge" style="background:${color}"></div>
            <div>
              <div class="ab-cat-name">${emoji} ${s.category}</div>
              <div class="ab-cat-meta">${s.avgMonthlySpend > 0 ? `Avg: ${fmt(s.avgMonthlySpend)}/mo` : 'No history yet'}</div>
            </div>
          </div>
          <div class="ab-reason-cell">
            <span class="ab-trend-pill ${s.trend}">${trendLabel}</span>
            <span>${s.reason}</span>
          </div>
          <div class="ab-input-cell">
            <div class="ab-input-wrap">
              <span class="ab-curr-sym">₹</span>
              <input type="number" class="ab-input-field" id="abInput_${idx}" data-idx="${idx}" value="${s.suggestedLimit}" min="50" step="50" />
            </div>
            <div class="ab-prev-limit">${s.currentLimit ? `Current: ${fmt(s.currentLimit)}` : 'No current limit'}</div>
          </div>
          <div class="ab-action-cell">
            <button class="btn-ghost btn-sm" data-action="apply-single-budget" data-idx="${idx}" type="button">Apply</button>
          </div>
        </div>
      `;
    }).join('');

    this.updateAutoBudgetSelectionSummary();
    this.bindAutoBudgetEvents();
  },

  updateAutoBudgetSelectionSummary() {
    const checks = document.querySelectorAll('.ab-row-check');
    let count = 0;
    let total = 0;

    checks.forEach(chk => {
      const idx = parseInt(chk.dataset.idx);
      const row = document.getElementById(`abRow_${idx}`);
      const input = document.getElementById(`abInput_${idx}`);
      const val = input ? (parseFloat(input.value) || 0) : 0;

      if (chk.checked) {
        count++;
        total += val;
        if (row) row.classList.remove('excluded');
      } else {
        if (row) row.classList.add('excluded');
      }
    });

    const countEl = document.getElementById('abSelectedCount');
    const totalEl = document.getElementById('abSelectedTotal');
    const applyBtn = document.getElementById('applyAutoBudgetsBtn');
    if (countEl) countEl.textContent = count;
    if (totalEl) totalEl.textContent = fmt(total);
    if (applyBtn) {
      applyBtn.disabled = (count === 0);
      applyBtn.textContent = `⚡ Apply Selected Budgets (${count})`;
    }
  },

  bindAutoBudgetEvents() {
    // Select all checkbox
    const selectAll = document.getElementById('abSelectAll');
    if (selectAll) {
      selectAll.onchange = (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.ab-row-check').forEach(chk => { chk.checked = isChecked; });
        this.updateAutoBudgetSelectionSummary();
      };
    }

    // Individual checkboxes
    document.querySelectorAll('.ab-row-check').forEach(chk => {
      chk.onchange = () => {
        this.updateAutoBudgetSelectionSummary();
      };
    });

    // Input changes recalculate total
    document.querySelectorAll('.ab-input-field').forEach(inp => {
      inp.oninput = () => {
        this.updateAutoBudgetSelectionSummary();
      };
    });
  },

  async applySelectedBudgets() {
    if (!this._budgetSuggestions || this._budgetSuggestions.length === 0) return;
    const checks = document.querySelectorAll('.ab-row-check:checked');
    if (checks.length === 0) {
      UI.toast('Please select at least one budget suggestion', 'error');
      return;
    }

    const budgetsToApply = [];
    checks.forEach(chk => {
      const idx = parseInt(chk.dataset.idx);
      const s = this._budgetSuggestions[idx];
      const inp = document.getElementById(`abInput_${idx}`);
      const limit = inp ? parseFloat(inp.value) : (s ? s.suggestedLimit : 0);
      if (s && limit > 0) {
        budgetsToApply.push({
          category: s.category,
          monthly_limit: limit
        });
      }
    });

    const btn = document.getElementById('applyAutoBudgetsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }

    try {
      const res = await API.post('/budgets/apply-suggestions', { budgets: budgetsToApply });
      UI.toast(`✓ Successfully set ${res.count || budgetsToApply.length} category budgets!`, 'success');
      this.closeAutoBudgetPlanner();
      await this.loadBudgets();
    } catch (e) {
      console.error('Apply budgets error:', e);
      UI.toast('Failed to apply budgets: ' + (e.message || 'Error'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Apply Selected Budgets'; }
    }
  },

  async applySingleBudget(idx) {
    if (!this._budgetSuggestions || !this._budgetSuggestions[idx]) return;
    const s = this._budgetSuggestions[idx];
    const inp = document.getElementById(`abInput_${idx}`);
    const limit = inp ? parseFloat(inp.value) : s.suggestedLimit;
    if (!limit || limit <= 0) {
      UI.toast('Please enter a valid monthly limit', 'error');
      return;
    }

    try {
      await API.post('/budgets', { category: s.category, monthly_limit: limit });
      UI.toast(`✓ Saved budget for ${s.category}: ${fmt(limit)}`, 'success');
      const prevEl = inp.parentElement?.parentElement?.querySelector('.ab-prev-limit');
      if (prevEl) prevEl.textContent = `Current: ${fmt(limit)}`;
      await this.loadBudgets();
    } catch (e) {
      UI.toast('Failed to save budget: ' + (e.message || 'Error'), 'error');
    }
  },

  // ── Analytics ──────────────────────────────────────────────
  async loadAnalytics() {
    try {
      const [summary, txns] = await Promise.all([API.get('/summary'), API.get('/transactions?limit=500')]);
      Charts.renderLine(summary.monthlyTrend);
      UI.renderCatBreakdown(summary.byCategory || []);
      UI.renderTopDays(txns);
    } catch { UI.toast('Error loading analytics', 'error'); }
  },

  // ── Reports / Financial Audit ───────────────────────────────
  initReports() {
    const months = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];

    // Reset month/year to current State each time the page is opened
    this._auditMonth = State.month;
    this._auditYear  = State.year;

    const setMonthLabel = () => {
      const el = document.getElementById('auditMonthLabel');
      if (el) el.textContent = months[this._auditMonth - 1] + ' ' + this._auditYear;
    };
    setMonthLabel();

    // Only bind interactive elements once
    if (this._auditBound) return;
    this._auditBound = true;

    const hideResults = () => {
      document.getElementById('auditEmptyState').style.display = 'flex';
      ['auditKpiRow','auditAiCard','auditGrid','auditDownloadCard'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    };

    document.getElementById('auditPrevMonth')?.addEventListener('click', () => {
      this._auditMonth--;
      if (this._auditMonth < 1) { this._auditMonth = 12; this._auditYear--; }
      setMonthLabel();
      hideResults();
    });
    document.getElementById('auditNextMonth')?.addEventListener('click', () => {
      this._auditMonth++;
      if (this._auditMonth > 12) { this._auditMonth = 1; this._auditYear++; }
      setMonthLabel();
      hideResults();
    });

    const generateAudit = async () => {
      const btn  = document.getElementById('generateAuditBtn');
      const btn2 = document.getElementById('auditEmptyGenBtn');
      const origText  = btn  ? btn.textContent  : '';
      const origText2 = btn2 ? btn2.textContent : '';
      if (btn)  { btn.disabled  = true; btn.textContent  = '⏳ Analyzing...'; }
      if (btn2) { btn2.disabled = true; btn2.textContent = '⏳ Analyzing...'; }
      try {
        const data = await API.get(`/reports/audit?month=${this._auditMonth}&year=${this._auditYear}`);
        this.renderAudit(data);
      } catch(e) {
        console.error('Audit error:', e);
        UI.toast('Error generating audit: ' + e.message, 'error');
      } finally {
        if (btn)  { btn.disabled  = false; btn.textContent  = origText; }
        if (btn2) { btn2.disabled = false; btn2.textContent = origText2; }
      }
    };

    document.getElementById('generateAuditBtn')?.addEventListener('click', generateAudit);
    document.getElementById('auditEmptyGenBtn')?.addEventListener('click', generateAudit);

    const downloadCsv = async () => {
      const token = localStorage.getItem('fl_token');
      try {
        const res = await fetch(`/api/export/monthly-csv?month=${this._auditMonth}&year=${this._auditYear}`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Failed to download CSV');
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `statement-${this._auditYear}-${String(this._auditMonth).padStart(2,'0')}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('✓ CSV downloaded!', 'success');
      } catch(e) { UI.toast('CSV error: ' + e.message, 'error'); }
    };
    document.getElementById('downloadAuditCsvBtn')?.addEventListener('click', downloadCsv);
    document.getElementById('downloadAuditCsvBtn2')?.addEventListener('click', downloadCsv);

    document.getElementById('downloadPdfBtn')?.addEventListener('click', async () => {
      const btn   = document.getElementById('downloadPdfBtn');
      const token = localStorage.getItem('fl_token');
      const m     = this._auditMonth;
      const y     = this._auditYear;
      if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }
      try {
        const res = await fetch(`/api/export/pdf?month=${m}&year=${y}`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) {
          let msg = 'Failed';
          try { const j = await res.json(); msg = j.error || j.details || msg; } catch {}
          throw new Error(msg);
        }
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('Empty PDF received');
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href    = url;
        a.download = `flowledger-${y}-${String(m).padStart(2,'0')}.pdf`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('✓ PDF downloaded!', 'success');
      } catch(e) {
        console.error('PDF error:', e);
        UI.toast('PDF error: ' + e.message, 'error');
      } finally {
        if (btn) { btn.textContent = '📄 Download PDF'; btn.disabled = false; }
      }
    });
  },

  renderAudit(data) {
    const { summary, byCategory, topMerchants, aiAnalysis, periodName } = data;

    // Switch visibility
    document.getElementById('auditEmptyState').style.display = 'none';
    document.getElementById('auditKpiRow').style.display     = 'grid';
    document.getElementById('auditAiCard').style.display     = '';
    document.getElementById('auditGrid').style.display       = 'grid';
    document.getElementById('auditDownloadCard').style.display = '';

    // KPI cards
    document.getElementById('auditKpiRow').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon kpi-icon-positive">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </div></div>
        <div class="kpi-value green">${fmt(summary.income)}</div>
        <div class="kpi-label">Total Income</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-icon kpi-icon-negative"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg></div>
          ${summary.momChange !== 0 ? `<span class="audit-mom-badge ${summary.momChange > 0 ? 'up' : 'down'}">${summary.momChange > 0 ? '↑' : '↓'} ${Math.abs(summary.momChange)}% MoM</span>` : ''}
        </div>
        <div class="kpi-value red">${fmt(summary.expense)}</div>
        <div class="kpi-label">Total Expenses</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon kpi-icon-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div></div>
        <div class="kpi-value ${summary.netSavings >= 0 ? 'green' : 'red'}">${fmt(summary.netSavings)}</div>
        <div class="kpi-label">Net Savings</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon kpi-icon-highlight"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3.332.83-4.5 2.05C10.832 3.83 9.26 3 7.5 3A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7 7-7z"/></svg></div></div>
        <div class="kpi-value purple">${summary.savingsRate}%</div>
        <div class="kpi-label">Savings Rate</div>
        <div class="kpi-sub">${summary.txnCount} transactions</div>
      </div>`;

    // Period label
    const periodEl = document.getElementById('auditAiPeriod');
    if (periodEl) periodEl.textContent = periodName || '';

    // AI analysis — simple markdown → HTML
    const bodyEl = document.getElementById('auditAiBody');
    if (bodyEl && aiAnalysis) {
      bodyEl.innerHTML = aiAnalysis
        .replace(/### (.*)/g, '<h3>$1</h3>')
        .replace(/## (.*)/g, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^• (.*)/gm, '<li>$1</li>')
        .replace(/^- (.*)/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
        .replace(/\n\n/g, '<br>');
    }

    // Category breakdown
    const catColors = ['#6366F1','#10B981','#F59E0B','#EF4444','#06B6D4','#8B5CF6','#EC4899','#F97316'];
    document.getElementById('auditCatList').innerHTML = (byCategory || []).length
      ? byCategory.map((c, i) => `
          <div class="audit-cat-row">
            <div style="width:10px;height:10px;border-radius:50%;background:${catColors[i % catColors.length]};flex-shrink:0"></div>
            <div style="flex:1;font-size:13px;font-weight:600;color:var(--text-primary)">${c.category}</div>
            <div style="font-size:12px;color:var(--text-secondary);min-width:60px;text-align:right">${fmt(c.total)}</div>
            <div class="audit-cat-bar-track" style="width:80px">
              <div class="audit-cat-bar-fill" style="width:${c.percent}%;background:${catColors[i % catColors.length]}"></div>
            </div>
            <div class="audit-cat-pct">${c.percent}%</div>
          </div>`).join('')
      : '<div style="padding:20px;text-align:center;color:var(--text-tertiary)">No expense categories this month</div>';

    // Top merchants
    document.getElementById('auditTopMerchants').innerHTML = (topMerchants || []).length
      ? topMerchants.map((t, i) => `
          <div class="audit-merchant-row">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:22px;height:22px;border-radius:var(--r-sm,6px);background:var(--surface-sunken);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--text-secondary)">${i+1}</div>
              <div>
                <div style="font-weight:600;color:var(--text-primary)">${t.description}</div>
                <div style="font-size:11px;color:var(--text-tertiary)">${t.category} · ${t.date}</div>
              </div>
            </div>
            <div class="red" style="font-weight:700">${fmt(t.amount)}</div>
          </div>`).join('')
      : '<div style="padding:20px;text-align:center;color:var(--text-tertiary)">No transactions this month</div>';
  },




  // ── Goals ──────────────────────────────────────────────────
  // Backed by /api/goals (Postgres) — previously localStorage-only, so
  // goals would silently vanish on a cleared browser or a new device.
  async loadGoals() {
    try {
      State.goals = await API.get('/goals');
      UI.renderGoals(State.goals);
    } catch(e) {
      console.error('Load goals error:', e);
      UI.toast('⚠ Could not load goals', 'error');
    }
  },

  async saveGoal() {
    const nameEl   = document.getElementById('goalName');
    const targetEl = document.getElementById('goalTarget');
    const savedEl  = document.getElementById('goalSaved');
    const dateEl   = document.getElementById('goalDate');
    const editIdEl = document.getElementById('goalEditId');
    if (!nameEl || !targetEl || !savedEl || !dateEl || !editIdEl) { UI.toast('⚠ Something went wrong loading the form', 'error'); return; }

    const name   = nameEl.value.trim();
    const target = parseFloat(targetEl.value);
    const saved  = parseFloat(savedEl.value) || 0;
    const date   = dateEl.value;
    const editId = editIdEl.value;
    if (!name || !target) { UI.toast('⚠ Fill in goal name and target', 'error'); return; }

    const btn = document.getElementById('saveGoalBtn');
    if (btn) btn.disabled = true;
    try {
      if (editId) {
        await API.put(`/goals/${editId}`, { name, target, saved, date });
        UI.toast('✓ Goal updated', 'success');
      } else {
        await API.post('/goals', { name, target, saved, date });
        UI.toast('✓ Goal added', 'success');
      }
      UI.closeGoalModal();
      await this.loadGoals();
    } catch(e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/,''), 'error');
    } finally { if (btn) btn.disabled = false; }
  },

  editGoal(id) {
    const goal = State.goals.find(g => g.id === id);
    if (goal) UI.openGoalModal(goal);
  },

  async addSavings(id) {
    const goal = State.goals.find(g => g.id === id);
    if (!goal) return;
    const amount = parseFloat(prompt(`Add savings to "${goal.name}"\nCurrently saved: ${fmt(goal.saved)}\n\nEnter amount to add:`));
    if (!amount || isNaN(amount) || amount <= 0) return;
    try {
      await API.put(`/goals/${id}`, { name: goal.name, target: goal.target, saved: goal.saved + amount, date: goal.date });
      UI.toast(`✓ Added ${fmt(amount)} to ${goal.name}`, 'success');
      await this.loadGoals();
    } catch(e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/,''), 'error');
    }
  },

  async deleteGoal(id) {
    if (!confirm('Delete this goal?')) return;
    try {
      await API.del(`/goals/${id}`);
      UI.toast('✓ Goal removed', 'success');
      await this.loadGoals();
    } catch(e) {
      UI.toast('⚠ ' + e.message.replace(/^\d+:\s*/,''), 'error');
    }
  },

  // ── AI ─────────────────────────────────────────────────────
  // Default welcome bubble shown when the current user has no chat
  // history — also what the container gets reset to for a fresh
  // session, so a previous user's messages (rendered before a login
  // that didn't fully reload the page) never linger for the next one.
  // ── AI Multi-Model Intelligence ─────────────────────────────
  AI_WELCOME_HTML: `
    <div class="chat-msg assistant">
      <div class="msg-avatar">AI</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <strong>Welcome to your AI Financial Advisor!</strong><br><br>
          I have full context of your financial transactions, accounts, and group splits. Choose your preferred AI engine above:
          <ul style="margin: 8px 0 0 18px; line-height: 1.6;">
            <li><strong>ChatGPT (GPT-4o)</strong>: Proactive wealth strategies, income compounding, and practical advice.</li>
            <li><strong>Claude 3.5 Sonnet</strong>: Methodical budget scrutiny, expense audits, and structured plans.</li>
            <li><strong>Groq Fast</strong>: Instant, rapid queries and balance math.</li>
          </ul>
        </div>
        <div class="msg-time">Just now</div>
      </div>
    </div>`,

  formatMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks ```code```
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // Inline code `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Headers ###
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h2>$1</h2>');
    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text* or _text_
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Blockquote >
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
    // Lists
    html = html.replace(/^\s*[-•*]\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    // Line breaks
    html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    return html;
  },

  async loadAI() {
    this.updateAIStats(State.summary);
    this.selectAiModel(State.aiModel);
    await this.loadAiSessions();

    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (State.aiSessionId) {
      await this.switchAiSession(State.aiSessionId);
    } else {
      container.innerHTML = this.AI_WELCOME_HTML;
    }
  },

  async loadAiSessions() {
    const listEl = document.getElementById('aiSessionList');
    const badgeEl = document.getElementById('aiSessionCount');
    if (!listEl) return;
    try {
      const sessions = await API.get('/ai/sessions');
      State.aiSessions = sessions || [];
      if (badgeEl) badgeEl.textContent = State.aiSessions.length;
      if (!State.aiSessions.length) {
        listEl.innerHTML = '<div class="ai-session-empty">No saved chats yet.</div>';
        return;
      }
      listEl.innerHTML = State.aiSessions.map(s => {
        const isActive = State.aiSessionId === s.id;
        const icon = s.model === 'claude' ? '🟣' : s.model === 'fast' ? '⚡' : '🟢';
        const d = s.updated_at ? new Date(s.updated_at).toLocaleDateString('en-IN', {month:'short', day:'numeric'}) : '';
        return `
          <div class="ai-session-item ${isActive ? 'active' : ''}" data-session-id="${s.id}">
            <div class="ai-session-meta">
              <div class="ai-session-title">${icon} ${s.title || 'Conversation'}</div>
              <div class="ai-session-date">${d} · ${s.message_count || 0} msgs</div>
            </div>
            <button class="ai-session-del" data-action="del-session" data-session-id="${s.id}" title="Delete conversation">✕</button>
          </div>`;
      }).join('');

      listEl.querySelectorAll('.ai-session-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.ai-session-del')) return;
          this.switchAiSession(parseInt(item.dataset.sessionId));
        });
      });

      listEl.querySelectorAll('.ai-session-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteAiSession(parseInt(btn.dataset.sessionId));
        });
      });
    } catch (e) {
      console.warn('Could not load AI sessions:', e);
    }
  },

  async switchAiSession(sessionId) {
    State.aiSessionId = sessionId;
    const session = State.aiSessions.find(s => s.id === sessionId);
    if (session && session.model) {
      this.selectAiModel(session.model);
    }
    const titleEl = document.getElementById('chatSessionTitle');
    if (titleEl) titleEl.textContent = session ? session.title : 'Conversation';

    document.querySelectorAll('.ai-session-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.sessionId) === sessionId);
    });

    const c = document.getElementById('chatMessages');
    if (c) c.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px">Loading conversation...</div>';

    try {
      const data = await API.get(`/ai/sessions/${sessionId}`);
      c.innerHTML = '';
      if (!data.messages || !data.messages.length) {
        c.innerHTML = this.AI_WELCOME_HTML;
        return;
      }
      data.messages.forEach(m => this.appendMsg(m.role, m.content, m.model || State.aiModel));
      c.scrollTop = c.scrollHeight;
    } catch (e) {
      UI.toast('Failed to load chat: ' + e.message, 'error');
    }
  },

  startNewAiChat() {
    State.aiSessionId = null;
    const titleEl = document.getElementById('chatSessionTitle');
    if (titleEl) titleEl.textContent = 'New Conversation';
    document.querySelectorAll('.ai-session-item').forEach(el => el.classList.remove('active'));
    const c = document.getElementById('chatMessages');
    if (c) c.innerHTML = this.AI_WELCOME_HTML;
    document.getElementById('chatInput')?.focus();
  },

  async deleteAiSession(sessionId) {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      await API.del(`/ai/sessions/${sessionId}`);
      if (State.aiSessionId === sessionId) {
        this.startNewAiChat();
      }
      await this.loadAiSessions();
      UI.toast('Conversation deleted', 'success');
    } catch (e) {
      UI.toast('Failed to delete: ' + e.message, 'error');
    }
  },

  selectAiModel(model) {
    State.aiModel = model;
    localStorage.setItem('fl_ai_model', model);

    document.querySelectorAll('.ai-model-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.model === model);
    });

    const banner = document.getElementById('chatModelBanner');
    const label = document.getElementById('chatModelLabel');
    if (banner) {
      banner.className = `chat-model-banner ${model}`;
    }
    if (label) {
      if (model === 'claude') label.textContent = 'Claude 3.5 Sonnet Mode';
      else if (model === 'fast') label.textContent = 'Groq Fast Mode';
      else label.textContent = 'ChatGPT (GPT-4o) Mode';
    }
  },

  appendMsg(role, content, model = null) {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    const isAssistant = role === 'assistant';
    const activeModel = model || State.aiModel;
    const avatarText = isAssistant ? (activeModel === 'claude' ? 'CL' : activeModel === 'fast' ? '⚡' : 'GPT') : 'You';
    const formattedHtml = isAssistant ? this.formatMarkdown(content) : content.replace(/\n/g, '<br>');

    const d = document.createElement('div');
    d.className = `chat-msg ${role}`;
    d.innerHTML = `
      <div class="msg-avatar">${avatarText}</div>
      <div class="msg-content">
        <div class="msg-bubble">${formattedHtml}</div>
        <div class="msg-meta-row">
          <div class="msg-time">${new Date().toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'})}</div>
          ${isAssistant ? `<button type="button" class="msg-copy-btn" title="Copy response">📋 Copy</button>` : ''}
        </div>
      </div>`;

    if (isAssistant) {
      const copyBtn = d.querySelector('.msg-copy-btn');
      copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
        }).catch(() => UI.toast('Copy failed', 'error'));
      });
    }

    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },

  appendTyping() {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    const activeModel = State.aiModel;
    const avatarText = activeModel === 'claude' ? 'CL' : activeModel === 'fast' ? '⚡' : 'GPT';
    const d = document.createElement('div');
    d.className = 'chat-msg assistant'; d.id = 'typingIndicator';
    d.innerHTML = `
      <div class="msg-avatar">${avatarText}</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },

  async sendChat(msg) {
    if (!msg || !msg.trim()) return;
    const input = document.getElementById('chatInput');
    const btn   = document.getElementById('chatSend');
    if (input) input.value = '';
    if (btn) btn.disabled = true;

    this.appendMsg('user', msg);
    this.appendTyping();

    try {
      const res = await API.post('/ai/chat', {
        message: msg,
        model: State.aiModel,
        session_id: State.aiSessionId
      });
      document.getElementById('typingIndicator')?.remove();
      
      if (res && res.session_id && !State.aiSessionId) {
        State.aiSessionId = res.session_id;
        await this.loadAiSessions();
      }
      this.appendMsg('assistant', res.reply, res.model || State.aiModel);
    } catch(e) {
      document.getElementById('typingIndicator')?.remove();
      this.appendMsg('assistant', '⚠ Error: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
      input?.focus();
    }
  },

  // ── Search ─────────────────────────────────────────────────
  bindSearch() {
    const input = document.getElementById('globalSearch');
    const wrap  = input?.closest('.topbar-search');
    if (!input) return;
    let resultsEl = null;
    input.addEventListener('input', async () => {
      const q = input.value.trim().toLowerCase();
      if (resultsEl) { resultsEl.remove(); resultsEl = null; }
      if (q.length < 2) return;
      try {
        const txns = await API.get('/transactions?limit=500');
        const matches = txns.filter(t =>
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          // Matches the raw number ("1500") and the ₹-formatted display
          // string ("1,500") so a search for either form finds it.
          String(t.amount).includes(q) ||
          fmt(t.amount).toLowerCase().includes(q)
        ).slice(0,6);
        if (!matches.length) return;
        resultsEl = document.createElement('div');
        resultsEl.className = 'search-results';
        resultsEl.innerHTML = matches.map(t => `
          <div class="search-item" data-action="goto-transactions">
            <div style="width:8px;height:8px;border-radius:50%;background:${Charts.getCatColor(t.category)};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description}</div>
              <div style="font-size:11px;color:#A79C8C">${t.category} · ${t.date}</div>
            </div>
            <div style="font-size:13px;font-family:'JetBrains Mono',monospace;color:${t.type==='income'?'#3E6154':'#A6402F'}">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
          </div>`).join('');
        wrap.appendChild(resultsEl);
      } catch {}
    });
    document.addEventListener('click', e => {
      if (!wrap?.contains(e.target) && resultsEl) { resultsEl.remove(); resultsEl = null; }
    });
  },

  // ── Bindings ────────────────────────────────────────────────
  on(id, ev, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  },

  bindModals() {
    this.on('openAddModal',    'click', () => UI.openAddModal());
    this.on('closeAddModal',   'click', () => UI.closeAddModal());
    this.on('saveTxnBtn',      'click', () => this.saveTxn());
    this.on('addModal',        'click', e  => { if (e.target.id === 'addModal') UI.closeAddModal(); });
    this.on('txnAmount',       'keydown', e => { if (e.key === 'Enter') this.saveTxn(); });

    this.on('openBudgetModal', 'click', () => UI.openBudgetModal());
    this.on('closeBudgetModal','click', () => UI.closeBudgetModal());
    this.on('saveBudgetBtn',   'click', () => this.saveBudget());
    this.on('budgetModal',     'click', e  => { if (e.target.id === 'budgetModal') UI.closeBudgetModal(); });
    this.on('openAutoBudgetBtn',    'click', () => this.openAutoBudgetPlanner());
    this.on('closeAutoBudgetBtn',   'click', () => this.closeAutoBudgetPlanner());
    this.on('cancelAutoBudgetBtn',  'click', () => this.closeAutoBudgetPlanner());
    this.on('refreshAutoBudgetBtn', 'click', () => this.fetchBudgetSuggestions());
    this.on('applyAutoBudgetsBtn',  'click', () => this.applySelectedBudgets());

    this.on('openAccountModal',  'click', () => UI.openAccountModal());
    this.on('closeAccountModal', 'click', () => UI.closeAccountModal());
    this.on('saveAccountBtn',    'click', () => this.saveAccount());
    this.on('accountModal',      'click', e => { if (e.target.id === 'accountModal') UI.closeAccountModal(); });

    this.on('openGoalModal',   'click', () => UI.openGoalModal());
    this.on('closeGoalModal',  'click', () => UI.closeGoalModal());
    this.on('saveGoalBtn',     'click', () => this.saveGoal());
    this.on('goalModal',       'click', e  => { if (e.target.id === 'goalModal') UI.closeGoalModal(); });

    // Recurring modal
    this.on('openRecurringModal',  'click', () => {
      const nd = document.getElementById('recNextDate');
      if (nd) nd.value = new Date().toISOString().slice(0,10);
      document.getElementById('recurringModal')?.classList.add('open');
    });
    this.on('closeRecurringModal', 'click', () => document.getElementById('recurringModal')?.classList.remove('open'));
    this.on('saveRecurringBtn',    'click', () => Recurring.save());
    this.on('recurringModal',      'click', e => { if(e.target.id==='recurringModal') document.getElementById('recurringModal')?.classList.remove('open'); });
    this.on('receiptModal',        'click', e => { if(e.target.id==='receiptModal') document.getElementById('receiptModal')?.classList.remove('open'); });
    this.on('deleteAccountModal',  'click', e => { if(e.target.id==='deleteAccountModal') document.getElementById('deleteAccountModal')?.classList.remove('open'); });

    // Import
    this.on('importBtn', 'click', () => Importer.importAll());

    // Global event delegation — all dynamic buttons
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const a  = t.dataset.action;
      const id = parseInt(t.dataset.id);

      if      (a === 'type-income')  UI.setType('income');
      else if (a === 'type-expense') UI.setType('expense');
      else if (a === 'rec-type-income') {
        document.getElementById('recType').value = 'income';
        t.className = 'type-btn active-income';
        const other = document.getElementById('recTypeExpense');
        if (other) other.className = 'type-btn';
      }
      else if (a === 'rec-type-expense') {
        document.getElementById('recType').value = 'expense';
        t.className = 'type-btn active-expense';
        const other = document.getElementById('recTypeIncome');
        if (other) other.className = 'type-btn';
      }
      else if (a === 'select-cat') {
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        t.classList.add('active');
        const sel = document.getElementById('txnCategory');
        if (![...sel.options].find(o => o.value === t.dataset.cat))
          sel.innerHTML += `<option value="${t.dataset.cat}">${t.dataset.cat}</option>`;
        sel.value = t.dataset.cat;
      }
      else if (a === 'edit-txn')          App.editTxn(id);
      else if (a === 'del-txn')           App.deleteTxn(id);
      else if (a === 'del-budget')        App.deleteBudget(id);
      else if (a === 'apply-single-budget') App.applySingleBudget(parseInt(t.dataset.idx));
      else if (a === 'edit-account')      App.editAccount(id);
      else if (a === 'del-account')       App.deleteAccount(id);
      else if (a === 'goto-accounts')     App.navigate('accounts');
      else if (a === 'edit-goal')         App.editGoal(id);
      else if (a === 'del-goal')          App.deleteGoal(id);
      else if (a === 'add-savings')       App.addSavings(id);
      else if (a === 'goto-dashboard')    App.navigate('dashboard');
      else if (a === 'toggle-recurring')  Recurring.toggle(id, parseInt(t.dataset.active));
      else if (a === 'del-recurring')     Recurring.delete(id);
      else if (a === 'goto-transactions') App.navigate('transactions');
      else if (a === 'goto-budgets') {
        document.getElementById('notifDropdown')?.classList.remove('show');
        App.navigate('budgets');
      }
      else if (a === 'goto-recurring') {
        document.getElementById('notifDropdown')?.classList.remove('show');
        App.navigate('recurring');
      }
      else if (a === 'chart-doughnut') {
        document.querySelectorAll('[data-action^="chart-"]').forEach(b => b.classList.remove('active'));
        t.classList.add('active'); Charts.renderDoughnut(window._lastCatData, 'doughnut');
      }
      else if (a === 'chart-pie') {
        document.querySelectorAll('[data-action^="chart-"]').forEach(b => b.classList.remove('active'));
        t.classList.add('active'); Charts.renderDoughnut(window._lastCatData, 'pie');
      }
      else if (a === 'bar-bar') {
        document.querySelectorAll('[data-action^="bar-"]').forEach(b => b.classList.remove('active'));
        t.classList.add('active'); Charts.renderBar(window._lastTrendData, 'bar');
      }
      else if (a === 'bar-line') {
        document.querySelectorAll('[data-action^="bar-"]').forEach(b => b.classList.remove('active'));
        t.classList.add('active'); Charts.renderBar(window._lastTrendData, 'line');
      }
    });
  },

  // ── Transactions Search & Filtering ────────────────────────
  getTxnActiveFilters() {
    const searchVal = document.getElementById('txnLiveSearch')?.value?.trim() || '';
    const sortVal   = document.getElementById('txnSortSelect')?.value || 'date_desc';
    const typeVal   = document.getElementById('filterType')?.value || '';
    const catVal    = document.getElementById('filterCategory')?.value || '';
    const accVal    = document.getElementById('filterAccount')?.value || '';
    const tagVal    = document.getElementById('filterTag')?.value || '';
    const fromVal   = document.getElementById('filterFrom')?.value || '';
    const toVal     = document.getElementById('filterTo')?.value || '';
    const minVal    = document.getElementById('filterMinAmount')?.value || '';
    const maxVal    = document.getElementById('filterMaxAmount')?.value || '';

    return {
      search: searchVal,
      sort: sortVal,
      type: typeVal,
      category: catVal,
      account_id: accVal,
      tag: tagVal,
      from: fromVal,
      to: toVal,
      min_amount: minVal,
      max_amount: maxVal
    };
  },

  updateTxnFilterResultsBar(filters, total, txns) {
    const bar = document.getElementById('txnResultsBar');
    const info = document.getElementById('txnResultsInfo');
    const badge = document.getElementById('advFilterBadge');
    if (!bar || !info) return;

    let activeAdvCount = 0;
    if (filters.type) activeAdvCount++;
    if (filters.category) activeAdvCount++;
    if (filters.account_id) activeAdvCount++;
    if (filters.tag) activeAdvCount++;
    if (filters.from || filters.to) activeAdvCount++;
    if (filters.min_amount || filters.max_amount) activeAdvCount++;

    if (badge) {
      badge.textContent = activeAdvCount;
      badge.style.display = activeAdvCount > 0 ? 'inline-flex' : 'none';
    }

    const hasFilters = Boolean(
      filters.search || activeAdvCount > 0 || (filters.sort && filters.sort !== 'date_desc')
    );

    if (!hasFilters) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    const parts = [];
    if (filters.search) parts.push(`matching "<strong>${filters.search}</strong>"`);
    if (filters.type) parts.push(`type: <strong>${filters.type}</strong>`);
    if (filters.category) parts.push(`category: <strong>${filters.category}</strong>`);
    if (filters.from && filters.to) parts.push(`date: <strong>${filters.from} to ${filters.to}</strong>`);
    else if (filters.from) parts.push(`after: <strong>${filters.from}</strong>`);
    else if (filters.to) parts.push(`before: <strong>${filters.to}</strong>`);
    if (filters.min_amount) parts.push(`min: <strong>₹${filters.min_amount}</strong>`);
    if (filters.max_amount) parts.push(`max: <strong>₹${filters.max_amount}</strong>`);

    const filterDesc = parts.length > 0 ? parts.join(', ') : 'Applied filters';
    const sumOnPage = (txns || []).reduce((acc, t) => acc + (t.type === 'expense' ? -parseFloat(t.amount) : parseFloat(t.amount)), 0);

    info.innerHTML = `Found <strong>${total}</strong> transaction${total === 1 ? '' : 's'} (${filterDesc}) • Page net: <strong>${fmt(sumOnPage)}</strong>`;
  },

  bindFilters() {
    let searchDebounceTimer = null;
    const searchInput = document.getElementById('txnLiveSearch');
    const clearSearchBtn = document.getElementById('txnClearSearch');
    const sortSelect = document.getElementById('txnSortSelect');
    const advToggleBtn = document.getElementById('toggleAdvFiltersBtn');
    const advDrawer = document.getElementById('txnAdvancedDrawer');
    const applyAdvBtn = document.getElementById('applyAdvFilters');
    const exportBtn = document.getElementById('exportTxnCsvBtn');
    const resetResultsBtn = document.getElementById('resetResultsBtn');

    const triggerSearch = () => {
      const filters = this.getTxnActiveFilters();
      this.loadTransactions(filters, true);
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'flex' : 'none';
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(triggerSearch, 250);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchDebounceTimer);
          triggerSearch();
        }
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        triggerSearch();
      });
    }

    sortSelect?.addEventListener('change', triggerSearch);

    advToggleBtn?.addEventListener('click', () => {
      if (!advDrawer) return;
      const isHidden = advDrawer.style.display === 'none';
      advDrawer.style.display = isHidden ? 'block' : 'none';
    });

    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const preset = chip.dataset.preset;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        ['filterType','filterCategory','filterAccount','filterTag','filterFrom','filterTo','filterMinAmount','filterMaxAmount'].forEach(id => setVal(id, ''));

        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

        if (preset === 'this_month') {
          setVal('filterFrom', `${y}-${m}-01`);
          setVal('filterTo', `${y}-${m}-${String(lastDay).padStart(2, '0')}`);
        } else if (preset === 'expense') {
          setVal('filterType', 'expense');
        } else if (preset === 'income') {
          setVal('filterType', 'income');
        } else if (preset === 'high_value') {
          setVal('filterMinAmount', '2000');
        } else if (preset === 'food') {
          setVal('filterCategory', 'Food');
        } else if (preset === 'shopping') {
          setVal('filterCategory', 'Shopping');
        } else if (preset === 'bills') {
          setVal('filterCategory', 'Bills');
        }

        triggerSearch();
      });
    });

    applyAdvBtn?.addEventListener('click', () => {
      triggerSearch();
      if (advDrawer) advDrawer.style.display = 'none';
    });

    ['filterType','filterCategory','filterAccount','filterTag','filterFrom','filterTo','filterMinAmount','filterMaxAmount'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', triggerSearch);
    });

    const clearAll = () => {
      ['filterType','filterCategory','filterAccount','filterTag','filterFrom','filterTo','filterMinAmount','filterMaxAmount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (searchInput) searchInput.value = '';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      if (sortSelect) sortSelect.value = 'date_desc';

      document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
      document.querySelector('.quick-chip[data-preset="all"]')?.classList.add('active');

      this.loadTransactions({}, true);
    };

    this.on('clearFilters', 'click', clearAll);
    resetResultsBtn?.addEventListener('click', clearAll);

    exportBtn?.addEventListener('click', async () => {
      const filters = this.getTxnActiveFilters();
      const qs = new URLSearchParams();
      if (filters.search)     qs.set('search',     filters.search);
      if (filters.type)       qs.set('type',       filters.type);
      if (filters.category)   qs.set('category',   filters.category);
      if (filters.account_id) qs.set('account_id', filters.account_id);
      if (filters.tag)        qs.set('tag',        filters.tag);
      if (filters.from)       qs.set('from',       filters.from);
      if (filters.to)         qs.set('to',         filters.to);
      if (filters.min_amount) qs.set('min_amount', filters.min_amount);
      if (filters.max_amount) qs.set('max_amount', filters.max_amount);
      if (filters.sort)       qs.set('sort',       filters.sort);

      const token = localStorage.getItem('fl_token');
      exportBtn.disabled = true;
      exportBtn.textContent = '⏳ Exporting...';
      try {
        const res = await fetch(`/api/transactions/export-csv?${qs}`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transactions-export-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('✓ Filtered transactions exported to CSV!', 'success');
      } catch (err) {
        UI.toast('Export error: ' + (err.message || 'Failed'), 'error');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '⬇ Export CSV';
      }
    });

    this.on('txnPrevPage', 'click', () => {
      if (State.txnPage <= 1) return;
      State.txnPage--;
      this.loadTransactions(State.lastTxnFilters || {}, false);
    });
    this.on('txnNextPage', 'click', () => {
      const totalPages = Math.max(Math.ceil(State.txnTotal / State.txnPageSize), 1);
      if (State.txnPage >= totalPages) return;
      State.txnPage++;
      this.loadTransactions(State.lastTxnFilters || {}, false);
    });
  },

  bindChat() {
    const input = document.getElementById('chatInput');
    const btn   = document.getElementById('chatSend');
    btn?.addEventListener('click', () => this.sendChat(input.value));
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChat(input.value);
      }
    });

    // Model Selector Buttons (ChatGPT, Claude, Fast)
    document.querySelectorAll('.ai-model-btn').forEach(b => {
      b.addEventListener('click', () => {
        this.selectAiModel(b.dataset.model);
      });
    });

    // + New Chat button
    this.on('newChatBtn', 'click', () => this.startNewAiChat());

    // Prompt suggestions
    document.querySelectorAll('.sug-btn').forEach(b => b.addEventListener('click', () => this.sendChat(b.dataset.prompt)));

    // Clear Chat
    this.on('clearChat', 'click', async () => {
      const clearBtn = document.getElementById('clearChat');
      if (clearBtn) clearBtn.disabled = true;
      try {
        if (State.aiSessionId) {
          await API.del(`/ai/sessions/${State.aiSessionId}`);
          await this.loadAiSessions();
        } else {
          await API.del('/ai/history');
        }
        this.startNewAiChat();
        UI.toast('✓ Chat cleared', 'success');
      } catch(e) {
        UI.toast('⚠ Could not clear chat: ' + e.message.replace(/^\d+:\s*/, ''), 'error');
      } finally {
        if (clearBtn) clearBtn.disabled = false;
      }
    });
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
    // Apply saved preference immediately (body may not have .dark yet)
    const saved = localStorage.getItem('fl_theme');
    if (saved === 'dark') document.body.classList.add('dark');

    const btn = document.getElementById('themeToggleBtn');
    btn?.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark');
      localStorage.setItem('fl_theme', isDark ? 'dark' : 'light');
      // Update meta theme-color for mobile chrome
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
      // Ctrl+K / Cmd+K → focus global search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const s = document.getElementById('globalSearch');
        if (s) { s.focus(); s.select(); }
      }
      // Escape → close any open modal
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open, .modal.open').forEach(m => m.classList.remove('open'));
      }
      // Ctrl+Shift+T → open add transaction modal
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        UI.openAddModal();
      }
      // Shift+P -> toggle privacy blur mode
      if (e.shiftKey && (e.key === 'P' || e.key === 'p') && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
          e.preventDefault();
          this.togglePrivacyMode();
        }
      }
    });
  },

  bindVoiceInput() {
    const micBtn = document.getElementById('voiceQuickBtn');
    const input = document.getElementById('aiQuickInput');
    if (!micBtn || !input) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      micBtn.addEventListener('click', () => {
        UI.toast('Voice dictation is supported in Chrome, Edge, and Safari.', 'info');
      });
      return;
    }

    let recognition = null;
    let isListening = false;

    try {
      recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

      recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        input.placeholder = '🎙️ Listening... speak naturally (e.g. "Dinner at Olive Garden ₹450")';
        UI.toast('🎙️ Listening... speak your transaction', 'info');
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          input.value = transcript;
          UI.toast(`Transcribed: "${transcript}"`, 'success');
          // Automatically trigger the NLP parse button
          const quickBtn = document.getElementById('aiQuickSubmitBtn');
          quickBtn?.click();
        }
      };

      recognition.onerror = (event) => {
        isListening = false;
        micBtn.classList.remove('listening');
        input.placeholder = 'Enter transaction details...';
        if (event.error === 'not-allowed') {
          UI.toast('⚠ Microphone access was denied. Please allow microphone permissions.', 'error');
        } else if (event.error !== 'no-speech') {
          UI.toast(`Voice recognition error: ${event.error}`, 'error');
        }
      };

      recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        input.placeholder = 'Enter transaction details...';
      };

      micBtn.addEventListener('click', () => {
        if (isListening) {
          recognition.stop();
        } else {
          try {
            recognition.start();
          } catch (err) {
            console.warn('Speech recognition start failed:', err);
          }
        }
      });
    } catch (e) {
      console.warn('SpeechRec initialization error:', e);
    }
  },

  updateHealthScore(summary, budgets, accounts) {
    const card = document.getElementById('healthScoreCard');
    if (!card) return;

    // 1. Savings Rate Score (0 - 40 pts)
    const income = summary.income || 0;
    const expense = summary.expense || 0;
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
    
    let savingsScore = 0;
    if (savingsRate >= 30) {
      savingsScore = 40;
    } else if (savingsRate >= 20) {
      savingsScore = 32 + Math.round(((savingsRate - 20) / 10) * 8);
    } else if (savingsRate >= 10) {
      savingsScore = 20 + Math.round(((savingsRate - 10) / 10) * 12);
    } else if (savingsRate > 0) {
      savingsScore = Math.max(5, Math.round((savingsRate / 10) * 20));
    } else {
      savingsScore = 0;
    }

    // 2. Budget Discipline Score (0 - 30 pts)
    let budgetScore = 20; // Default when no budgets defined
    let budgetRatioText = 'No budgets defined (setup budgets for +10 pts)';
    if (budgets && budgets.length > 0) {
      const underCount = budgets.filter(b => (b.percent || 0) <= 100).length;
      const overCount = budgets.length - underCount;
      const ratio = underCount / budgets.length;
      budgetScore = Math.round(ratio * 30);
      if (overCount > 0) {
        budgetRatioText = `${underCount}/${budgets.length} budgets on track (${overCount} over limit)`;
      } else {
        budgetRatioText = `All ${budgets.length} active category budgets on track!`;
      }
    }

    // 3. Emergency Cushion / Liquid Reserves (0 - 30 pts)
    let totalLiquidity = 0;
    if (accounts && accounts.length > 0) {
      totalLiquidity = accounts.reduce((acc, a) => acc + (parseFloat(a.balance) || 0), 0);
    } else {
      totalLiquidity = Math.max(0, summary.balance || 0);
    }

    let cushionScore = 0;
    let cushionMonths = 0;
    if (expense > 0) {
      cushionMonths = totalLiquidity / expense;
      if (cushionMonths >= 3) {
        cushionScore = 30;
      } else if (cushionMonths >= 1) {
        cushionScore = 15 + Math.round(((cushionMonths - 1) / 2) * 15);
      } else if (cushionMonths > 0) {
        cushionScore = Math.max(5, Math.round(cushionMonths * 15));
      } else {
        cushionScore = 0;
      }
    } else {
      cushionScore = totalLiquidity > 0 ? 30 : 15;
      cushionMonths = 3;
    }

    // Total Score (0 - 100)
    const totalScore = Math.min(100, Math.max(0, savingsScore + budgetScore + cushionScore));

    // Determine status badge & color
    let grade = '';
    let badgeClass = '';
    let gaugeColor = '#6366F1';
    let tipText = '';

    if (totalScore >= 85) {
      grade = 'Excellent';
      badgeClass = 'status-excellent';
      gaugeColor = '#10B981';
      tipText = `Outstanding financial posture! You're saving ${savingsRate.toFixed(0)}% of income with healthy liquid runway. Consider investing surplus funds into your long-term goals.`;
    } else if (totalScore >= 70) {
      grade = 'Healthy';
      badgeClass = 'status-healthy';
      gaugeColor = '#06B6D4';
      tipText = savingsScore < 25 
        ? `Good overall health! Boosting your monthly savings rate closer to 20% would push your score past 85.`
        : `Strong financial discipline! Review categories nearing budget limits to keep expenses balanced.`;
    } else if (totalScore >= 50) {
      grade = 'Fair';
      badgeClass = 'status-fair';
      gaugeColor = '#F59E0B';
      tipText = budgetScore < 20 
        ? `Some category budgets have exceeded limits. Consider setting stricter limits or trimming discretionary spend.`
        : `Your liquid reserves are currently below recommended 2 months of expenses. Focus on building an emergency cushion.`;
    } else {
      grade = 'Needs Attention';
      badgeClass = 'status-needs-attention';
      gaugeColor = '#EF4444';
      tipText = savingsRate <= 0
        ? `Expenses are currently outpacing your income this month. Check your high-burn categories to halt cash drain.`
        : `Take immediate steps to curb non-essential purchases and build at least 1 month of emergency reserve.`;
    }

    // Render to DOM
    const badgeEl = document.getElementById('healthScoreBadge');
    if (badgeEl) {
      badgeEl.textContent = `${grade} (${totalScore}/100)`;
      badgeEl.className = `health-score-badge ${badgeClass}`;
    }

    const valEl = document.getElementById('healthScoreVal');
    if (valEl) valEl.textContent = totalScore;

    const gradeLabel = document.getElementById('healthGradeLabel');
    if (gradeLabel) gradeLabel.textContent = grade;

    // SVG Gauge: circumference is 2 * PI * 54 = 339.29
    const gaugeBar = document.getElementById('healthGaugeBar');
    if (gaugeBar) {
      const circ = 339.29;
      const offset = circ - (circ * (totalScore / 100));
      gaugeBar.style.strokeDasharray = `${circ}`;
      gaugeBar.style.strokeDashoffset = `${offset}`;
      gaugeBar.style.stroke = gaugeColor;
    }

    // Metric items
    const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

    setHtml('healthMetricSavings', `${savingsScore} <span style="font-size:11px;color:var(--text-tertiary)">/ 40 pts</span>`);
    setStyle('healthBarSavings', 'width', `${(savingsScore / 40) * 100}%`);
    setHtml('healthDescSavings', `Savings Rate: <strong>${savingsRate.toFixed(1)}%</strong> of income`);

    setHtml('healthMetricBudget', `${budgetScore} <span style="font-size:11px;color:var(--text-tertiary)">/ 30 pts</span>`);
    setStyle('healthBarBudget', 'width', `${(budgetScore / 30) * 100}%`);
    setHtml('healthDescBudget', budgetRatioText);

    setHtml('healthMetricCushion', `${cushionScore} <span style="font-size:11px;color:var(--text-tertiary)">/ 30 pts</span>`);
    setStyle('healthBarCushion', 'width', `${(cushionScore / 30) * 100}%`);
    setHtml('healthDescCushion', `Emergency Runway: <strong>${cushionMonths.toFixed(1)} months</strong> (${fmt(totalLiquidity)} liquid)`);

    setHtml('healthScoreTip', tipText);
  },
  async loadBurnRate() {
    try {
      const data = await API.get(`/burnrate?month=${State.month}&year=${State.year}`);
      const card = document.getElementById('burnRateCard');
      if (!card) return;
      card.style.display = '';

      const { income, expense, dailyRate, projectedExpense, projectedSavings,
              daysLeft, safeDaily, pace, isCurrentMonth } = data;

      // Pace badge
      const badge = document.getElementById('burnPaceBadge');
      if (badge) {
        const labels = { safe: 'On Track', warning: 'Caution', danger: 'Over-Spend Risk' };
        badge.textContent = labels[pace] || pace;
        badge.className = `burn-pace-badge ${pace}`;
      }

      // Stat values
      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setText('burnDailyRate',  fmt(dailyRate));
      setText('burnProjected',  fmt(projectedExpense));
      setText('burnSafeDaily',  isCurrentMonth && daysLeft > 0 ? fmt(safeDaily) : '—');

      // Progress bar
      const actualPct   = income > 0 ? Math.min(100, (expense / income) * 100) : 0;
      const projectPct  = income > 0 ? Math.min(100, (projectedExpense / income) * 100) : 0;
      const barActual   = document.getElementById('burnBarActual');
      const barProject  = document.getElementById('burnBarProject');
      if (barActual)  barActual.style.width  = actualPct  + '%';
      if (barProject) {
        barProject.style.width = projectPct + '%';
        barProject.className = `burn-bar-project ${pace}`;
      }
      const barSpent = document.getElementById('burnBarSpent');
      if (barSpent) barSpent.textContent = `Spent ${fmt(expense)} of ${fmt(income)}`;

      // Warning message
      const warn = document.getElementById('burnWarning');
      if (warn) {
        if (pace === 'danger') {
          warn.style.display = '';
          warn.textContent = `⚠ At this pace you'll spend ${fmt(projectedExpense)} this month — ${fmt(projectedExpense - income)} over your income. Cut discretionary spending now!`;
        } else if (pace === 'warning') {
          warn.style.display = '';
          warn.style.background = 'rgba(245,158,11,0.08)';
          warn.style.borderColor = 'rgba(245,158,11,0.25)';
          warn.style.color = '#F59E0B';
          warn.textContent = `Heads up: projected month-end spend is ${fmt(projectedExpense)}, eating ${Math.round((projectedExpense/income)*100)}% of income. Consider slowing down spending.`;
        } else {
          warn.style.display = 'none';
        }
      }

      // Bell notification for danger / warning (current month only)
      if (isCurrentMonth && (pace === 'danger' || pace === 'warning')) {
        const existing = (State.burnAlert || '');
        const msg = pace === 'danger'
          ? `Burn Rate ALERT: Projected overspend of ${fmt(projectedExpense - income)} this month!`
          : `Burn Rate Warning: Spending at ${Math.round((projectedExpense/income)*100)}% of income pace.`;
        if (existing !== msg && typeof Notifications !== 'undefined') {
          State.burnAlert = msg;
          Notifications.add({ id: 'burn-' + pace, text: msg, type: pace, icon: '🔥' });
        }
      }
    } catch(e) {
      console.error('Burn rate error:', e);
      // Silently hide the card if endpoint not available
      const card = document.getElementById('burnRateCard');
      if (card) card.style.display = 'none';
    }
  },


  bindAISmartTools() {
    // 1. Natural Language Quick Add
    const quickInput = document.getElementById('aiQuickInput');
    const quickBtn = document.getElementById('aiQuickSubmitBtn');
    
    const handleQuickAdd = async () => {
      const text = quickInput?.value?.trim();
      if (!text) {
        UI.toast('Please enter a transaction sentence (e.g. "Spent ₹450 on coffee yesterday")', 'error');
        return;
      }

      if (quickBtn) { quickBtn.disabled = true; quickBtn.textContent = '✨ Extracting...'; }
      try {
        const res = await API.parseNaturalLanguage(text);
        if (res && res.result) {
          const r = res.result;
          UI.toast('✨ AI extracted transaction details!', 'success');
          UI.openAddModal({
            description: r.description || text,
            amount: r.amount || '',
            type: r.type || 'expense',
            category: r.category || 'Other',
            date: r.date || new Date().toISOString().slice(0, 10),
            account_id: r.account_id || '',
            tags: r.tags || []
          });
          if (quickInput) quickInput.value = '';
        }
      } catch (err) {
        UI.toast(err.message || 'Failed to parse input', 'error');
      } finally {
        if (quickBtn) { quickBtn.disabled = false; quickBtn.textContent = '✨ Extract'; }
      }
    };

    if (quickBtn) quickBtn.addEventListener('click', handleQuickAdd);
    if (quickInput) {
      quickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleQuickAdd();
      });
    }

    // 2. Receipt Scanner Modal & Drag & Drop Processing
    const btnScan = document.getElementById('btnScanReceipt');
    const receiptModal = document.getElementById('receiptModal');
    const closeReceiptBtn = document.getElementById('closeReceiptModal');
    const cancelReceiptBtn = document.getElementById('cancelReceiptBtn');
    const dropzone = document.getElementById('receiptDropzone');
    const fileInput = document.getElementById('receiptFileInput');
    const previewWrap = document.getElementById('receiptPreviewWrap');
    const previewImg = document.getElementById('receiptPreviewImg');
    const dropContent = document.getElementById('dropzoneContent');
    const laserLine = document.getElementById('scanLaserLine');
    const statusArea = document.getElementById('receiptStatusArea');
    const loader = document.getElementById('receiptLoader');
    const resultCard = document.getElementById('receiptResultCard');
    const useBtn = document.getElementById('useReceiptDataBtn');

    let currentExtractedData = null;

    const rescanBtn = document.getElementById('rescanReceiptBtn');

    const resetReceiptModal = () => {
      currentExtractedData = null;
      if (fileInput) fileInput.value = '';
      if (previewWrap) previewWrap.style.display = 'none';
      if (dropContent) dropContent.style.display = 'block';
      if (laserLine) laserLine.style.display = 'none';
      if (statusArea) statusArea.style.display = 'none';
      if (loader) loader.style.display = 'none';
      if (resultCard) resultCard.style.display = 'none';
      if (useBtn) useBtn.style.display = 'none';
      if (rescanBtn) rescanBtn.style.display = 'none';
    };

    const openReceiptModal = () => {
      resetReceiptModal();
      if (receiptModal) receiptModal.classList.add('open');
    };

    const closeReceiptModal = () => {
      if (receiptModal) receiptModal.classList.remove('open');
      resetReceiptModal();
    };

    if (btnScan) btnScan.addEventListener('click', openReceiptModal);
    if (closeReceiptBtn) closeReceiptBtn.addEventListener('click', closeReceiptModal);
    if (cancelReceiptBtn) cancelReceiptBtn.addEventListener('click', closeReceiptModal);
    if (rescanBtn) rescanBtn.addEventListener('click', resetReceiptModal);

    if (dropzone) {
      dropzone.addEventListener('click', (e) => {
        if (e.target !== fileInput) fileInput.click();
      });
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processReceiptFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          processReceiptFile(e.target.files[0]);
        }
      });
    }

    const processReceiptFile = (file) => {
      if (!file.type.startsWith('image/')) {
        UI.toast('Please select an image file (PNG, JPG, WebP)', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        UI.toast('File size exceeds 5MB limit', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target.result;
        if (previewImg) previewImg.src = base64;
        if (dropContent) dropContent.style.display = 'none';
        if (previewWrap) previewWrap.style.display = 'block';
        if (laserLine) laserLine.style.display = 'block';
        if (statusArea) statusArea.style.display = 'block';
        if (loader) loader.style.display = 'flex';
        if (resultCard) resultCard.style.display = 'none';
        if (useBtn) useBtn.style.display = 'none';

        try {
          const res = await API.scanReceipt(base64);
          if (res && res.result) {
            currentExtractedData = res.result;
            if (laserLine) laserLine.style.display = 'none';
            if (loader) loader.style.display = 'none';
            if (resultCard) resultCard.style.display = 'block';

            const m = document.getElementById('resMerchant');
            const a = document.getElementById('resAmount');
            const c = document.getElementById('resCategory');
            const d = document.getElementById('resDate');

            if (m) m.textContent = currentExtractedData.merchant || 'Store Receipt';
            if (a) a.textContent = typeof fmt === 'function' ? fmt(currentExtractedData.amount || 0) : `₹${currentExtractedData.amount || 0}`;
            if (c) c.textContent = currentExtractedData.category || 'Other';
            if (d) d.textContent = currentExtractedData.date || new Date().toISOString().slice(0, 10);

            const itemsWrap = document.getElementById('resLineItemsWrap');
            if (itemsWrap) {
              if (currentExtractedData.line_items && currentExtractedData.line_items.length) {
                itemsWrap.innerHTML = '<strong>Items:</strong> ' + currentExtractedData.line_items.slice(0, 5).join(', ');
              } else {
                itemsWrap.innerHTML = '';
              }
            }

            if (useBtn) useBtn.style.display = 'inline-block';
            if (rescanBtn) rescanBtn.style.display = 'inline-block';
            UI.toast('✨ Receipt scanned successfully!', 'success');
          }
        } catch (err) {
          if (laserLine) laserLine.style.display = 'none';
          if (loader) loader.style.display = 'none';
          if (rescanBtn) rescanBtn.style.display = 'inline-block';
          UI.toast(err.message || 'Failed to scan receipt image', 'error');
        }
      };
      reader.readAsDataURL(file);
    };

    if (useBtn) {
      useBtn.addEventListener('click', () => {
        if (!currentExtractedData) return;
        // Clone data BEFORE resetting modal state
        const data = { ...currentExtractedData };
        if (receiptModal) receiptModal.classList.remove('open');
        resetReceiptModal();

        // Ensure date is formatted as YYYY-MM-DD for <input type="date">
        let dateStr = new Date().toISOString().slice(0, 10);
        if (data.date) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
            dateStr = data.date;
          } else {
            try {
              const p = new Date(data.date);
              if (!isNaN(p.getTime())) dateStr = p.toISOString().slice(0, 10);
            } catch {}
          }
        }

        UI.openAddModal({
          description: data.merchant || 'Receipt Expense',
          amount: data.amount || '',
          type: 'expense',
          category: data.category || 'Other',
          date: dateStr,
          tags: Array.isArray(data.tags) && data.tags.length ? data.tags : ['receipt']
        });
        UI.toast('✓ Form pre-filled from receipt!', 'success');
      });
    }
  }
};

// ── Notifications ──────────────────────────────────────────────
// Topbar bell, visible on every page (unlike the old dashboard-only
// budget banner). Budget alerts are recomputed each time the dashboard
// loads (see App.renderBudgetAlert) and merged in here; "cleared" ones
// are remembered per-category so they don't reappear until the alert
// condition changes again (e.g. percent moves from 82% to 95%).
const Notifications = {
  items: [],
  budgetItems: [],
  recurringItems: [],
  clearedKeys: new Set(JSON.parse(localStorage.getItem('fl_notif_cleared') || '[]')),

  init() {
    document.addEventListener('click', e => {
      const bellBtn = e.target.closest('#notifBellBtn');
      if (bellBtn) {
        e.stopPropagation();
        const dd = document.getElementById('notifDropdown');
        const open = dd?.classList.toggle('show');
        bellBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const wrap = e.target.closest('#notifWrap');
      if (!wrap) {
        document.getElementById('notifDropdown')?.classList.remove('show');
        document.getElementById('notifBellBtn')?.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('notifClearBtn')?.addEventListener('click', () => {
      this.items.forEach(i => this.clearedKeys.add(i.key));
      this.persist();
      this.render();
    });
  },

  persist() {
    localStorage.setItem('fl_notif_cleared', JSON.stringify([...this.clearedKeys]));
  },

  setBudgetAlerts(rawItems) {
    this.budgetItems = rawItems.map(i => ({ ...i, key: i.title, action: 'goto-budgets' }));
    this.recompute();
  },

  setRecurringAlerts(renewals) {
    this.recurringItems = renewals.map(r => ({
      icon: '📅',
      level: r.diffDays <= 1 ? 'danger' : 'warning',
      title: `Upcoming Renewal: ${r.description}`,
      sub: `${r.diffDays === 0 ? 'Due today' : r.diffDays === 1 ? 'Due tomorrow' : 'Renews in ' + r.diffDays + ' days'} · ${fmt(r.amount)}`,
      key: `rec_${r.id}_${r.next_date}`,
      action: 'goto-recurring'
    }));
    this.recompute();
  },

  recompute() {
    this.items = [...this.budgetItems, ...this.recurringItems];
    const activeKeys = new Set(this.items.map(i => i.key));
    this.clearedKeys = new Set([...this.clearedKeys].filter(k => activeKeys.has(k)));
    this.persist();
    this.render();
  },

  render() {
    const visible = this.items.filter(i => !this.clearedKeys.has(i.key));
    const list = document.getElementById('notifList');
    const dot  = document.getElementById('notifDot');
    if (dot) dot.style.display = visible.length ? 'block' : 'none';
    if (!list) return;

    if (!visible.length) {
      list.innerHTML = `<div class="notif-empty">You're all caught up 🎉</div>`;
      return;
    }
    list.innerHTML = visible.map(i => `
      <div class="notif-item" data-action="${i.action || 'goto-budgets'}">
        <div class="notif-icon ${i.level}">${i.icon}</div>
        <div class="notif-body">
          <div class="notif-title">${i.title}</div>
          <div class="notif-sub">${i.sub}</div>
        </div>
      </div>`).join('');
  }
};

// ── Tags ────────────────────────────────────────────────────────
// Free-text tags with autocomplete from the user's own tag history —
// no predefined/managed list, since forcing someone to register a tag
// before using it defeats the point of ad-hoc labeling. Typing shows
// matching past tags; Enter (or picking a suggestion) commits the
// current input as a pill. The transaction modal reads the current
// pills via getPills() at save time.
const Tags = {
  pills: [],
  known: [],       // all tags this user has ever used (for autocomplete)
  activeSuggestion: -1,

  async init() {
    try { this.known = await API.get('/tags'); } catch { this.known = []; }
    this.populateFilterSelect();

    const input = document.getElementById('tagInput');
    const box   = document.getElementById('tagSuggestions');
    if (!input) return;

    input.addEventListener('input', () => this.showSuggestions(input.value));
    input.addEventListener('keydown', e => {
      const items = box ? [...box.querySelectorAll('.tag-suggestion-item')] : [];
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        this.activeSuggestion = Math.min(this.activeSuggestion + 1, items.length - 1);
        this.highlightSuggestion(items);
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault();
        this.activeSuggestion = Math.max(this.activeSuggestion - 1, 0);
        this.highlightSuggestion(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.activeSuggestion >= 0 && items[this.activeSuggestion]) {
          this.addPill(items[this.activeSuggestion].textContent);
        } else if (input.value.trim()) {
          this.addPill(input.value);
        }
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
      } else if (e.key === 'Backspace' && !input.value && this.pills.length) {
        // Backspace on an empty input deletes the last pill — mirrors
        // how tag/chip inputs behave in most mail and shipping-label UIs.
        this.removePill(this.pills.length - 1);
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#tagInputWrap')) this.hideSuggestions();
    });
  },

  populateFilterSelect() {
    const sel = document.getElementById('filterTag');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Tags</option>' +
      this.known.map(t => `<option value="${t}">#${t}</option>`).join('');
    sel.value = current;
  },

  showSuggestions(query) {
    const box = document.getElementById('tagSuggestions');
    if (!box) return;
    const q = query.trim().toLowerCase();
    this.activeSuggestion = -1;
    const matches = this.known
      .filter(t => !this.pills.includes(t) && (!q || t.includes(q)))
      .slice(0, 8);
    if (!matches.length) { this.hideSuggestions(); return; }
    box.innerHTML = matches.map(t => `<div class="tag-suggestion-item">${t}</div>`).join('');
    box.classList.add('show');
    box.querySelectorAll('.tag-suggestion-item').forEach(el =>
      el.addEventListener('mousedown', ev => { ev.preventDefault(); this.addPill(el.textContent); }));
  },

  highlightSuggestion(items) {
    items.forEach((el, idx) => el.classList.toggle('active', idx === this.activeSuggestion));
  },

  hideSuggestions() {
    const box = document.getElementById('tagSuggestions');
    box?.classList.remove('show');
    this.activeSuggestion = -1;
  },

  addPill(raw) {
    const tag = raw.trim().toLowerCase().slice(0, 30);
    const input = document.getElementById('tagInput');
    if (input) input.value = '';
    this.hideSuggestions();
    if (!tag || this.pills.includes(tag) || this.pills.length >= 15) return;
    this.pills.push(tag);
    if (!this.known.includes(tag)) this.known.push(tag);
    this.renderPills();
  },

  removePill(index) {
    this.pills.splice(index, 1);
    this.renderPills();
  },

  renderPills() {
    const el = document.getElementById('tagPills');
    if (!el) return;
    el.innerHTML = this.pills.map((t, idx) => `
      <span class="tag-pill">#${t}
        <button type="button" class="tag-pill-remove" data-tag-idx="${idx}" aria-label="Remove tag ${t}">×</button>
      </span>`).join('');
    el.querySelectorAll('.tag-pill-remove').forEach(btn =>
      btn.addEventListener('click', () => this.removePill(parseInt(btn.dataset.tagIdx))));
  },

  // Called by UI.openAddModal()/closeAddModal() to load an existing
  // transaction's tags into the modal, or clear the modal on close.
  setPills(tags) {
    this.pills = [...(tags || [])];
    this.renderPills();
    const input = document.getElementById('tagInput');
    if (input) input.value = '';
    this.hideSuggestions();
  },

  getPills() { return [...this.pills]; }
};

// App.init() is called by Auth.onLoggedIn() after successful authentication
