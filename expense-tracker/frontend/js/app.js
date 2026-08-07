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
  // Transactions-page pagination (separate from the small `limit=`
  // snapshots the dashboard/analytics widgets pull — those stay unpaginated).
  txnPage: 1,
  txnPageSize: 50,
  txnTotal: 0
};

// ── App ────────────────────────────────────────────────────────
const App = {
  async init() {
    this.setGreeting();
    this.setTopbarDate();
    this.bindNav();
    this.bindModals();
    this.bindFilters();
    this.bindChat();
    this.bindMobile();
    this.bindSearch();
    this.updateNavCount();
    await this.loadDashboard();
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
    else if (page === 'budgets')      await this.loadBudgets();
    else if (page === 'analytics')    await this.loadAnalytics();
    else if (page === 'ai')           await this.loadAI();
    else if (page === 'goals')        await this.loadGoals();
    else if (page === 'recurring')    await Recurring.load();
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

  // Shows a dashboard banner when any budget is over 100%, or nearing
  // it (>=80%) — otherwise a budget only surfaces its status on the
  // Budgets page, so a user could go the whole month without noticing
  // they're close to (or already past) a limit.
  renderBudgetAlert(budgets) {
    const banner = document.getElementById('budgetAlertBanner');
    if (!banner) return;
    if (!budgets || !budgets.length) { banner.style.display = 'none'; return; }

    const over   = budgets.filter(b => b.percent >= 100);
    const nearing = budgets.filter(b => b.percent >= 80 && b.percent < 100);
    if (!over.length && !nearing.length) { banner.style.display = 'none'; return; }

    const title = document.getElementById('budgetAlertTitle');
    const sub   = document.getElementById('budgetAlertSub');
    if (over.length) {
      const names = over.map(b => b.category).join(', ');
      if (title) title.textContent = over.length === 1 ? 'Over Budget' : `Over Budget in ${over.length} Categories`;
      if (sub)   sub.textContent = `You've gone over your limit for ${names}. Check the Budgets page for details.`;
    } else {
      const names = nearing.map(b => b.category).join(', ');
      if (title) title.textContent = nearing.length === 1 ? 'Approaching Budget Limit' : `Approaching Limits in ${nearing.length} Categories`;
      if (sub)   sub.textContent = `You're at 80%+ of your budget for ${names}.`;
    }
    banner.style.display = 'flex';
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
      if (filters.type)     qs.set('type',     filters.type);
      if (filters.category) qs.set('category', filters.category);
      if (filters.from)     qs.set('from',     filters.from);
      if (filters.to)       qs.set('to',       filters.to);
      qs.set('limit', State.txnPageSize);
      qs.set('page',  State.txnPage);
      const { data: txns, total } = await API.getWithCount('/transactions?' + qs);
      State.transactions = txns;
      State.txnTotal = total;
      State.lastTxnFilters = filters;
      UI.renderTxnList(txns, 'allTxns', null, true);
      this.renderTxnPagination();
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
    if (!descEl || !amtEl || !dateEl || !catEl) { UI.toast('⚠ Something went wrong loading the form', 'error'); return; }

    const desc     = descEl.value.trim();
    const amount   = parseFloat(amtEl.value);
    const date     = dateEl.value;
    const category = catEl.value;
    const type     = UI.currentType;
    if (!desc || !amount || !date || !category) { UI.toast('⚠ Fill in all fields', 'error'); return; }
    if (amount <= 0) { UI.toast('⚠ Amount must be greater than 0', 'error'); return; }

    const btn = document.getElementById('saveTxnBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      let budgetToastShown = false;
      if (UI.editId) {
        await API.put(`/transactions/${UI.editId}`, { description:desc, amount, type, category, date });
        UI.toast('✓ Transaction updated', 'success');
      } else {
        await API.post('/transactions', { description:desc, amount, type, category, date });
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
      const all = await API.get('/transactions');
      const txn = all.find(t => t.id === id);
      if (txn) UI.openAddModal(txn);
    } catch { UI.toast('Could not load transaction', 'error'); }
  },

  async deleteTxn(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await API.del(`/transactions/${id}`);
      UI.toast('✓ Deleted', 'success');
      this.updateNavCount();
      if (State.page === 'transactions') await this.loadTransactions();
      else await this.loadDashboard();
    } catch { UI.toast('Error deleting', 'error'); }
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

  // ── Analytics ──────────────────────────────────────────────
  async loadAnalytics() {
    try {
      const [summary, txns] = await Promise.all([API.get('/summary'), API.get('/transactions?limit=500')]);
      Charts.renderLine(summary.monthlyTrend);
      UI.renderCatBreakdown(summary.byCategory || []);
      UI.renderTopDays(txns);
    } catch { UI.toast('Error loading analytics', 'error'); }
  },

  // ── Reports ────────────────────────────────────────────────
  initReports() {
    const yearSel = document.getElementById('reportYear');
    if (yearSel && !yearSel.options.length) {
      const y = new Date().getFullYear();
      for (let i = y; i >= y-3; i--) {
        const o = document.createElement('option');
        o.value = i; o.textContent = i;
        yearSel.appendChild(o);
      }
    }
    const monthSel = document.getElementById('reportMonth');
    if (monthSel) monthSel.value = State.month;

    const btn = document.getElementById('downloadPdfBtn');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', async () => {
        const m = document.getElementById('reportMonth').value;
        const y = document.getElementById('reportYear').value;
        const token = localStorage.getItem('fl_token');
        btn.textContent = '⏳ Generating...'; btn.disabled = true;
        try {
          const res = await fetch(`/api/export/pdf?month=${m}&year=${y}`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (!res.ok) {
            let errMsg = 'Failed';
            try { const j = await res.json(); errMsg = j.error || j.details || errMsg; } catch {}
            throw new Error(errMsg);
          }
          const blob = await res.blob();
          if (blob.size === 0) throw new Error('Empty PDF received');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `flowledger-${y}-${String(m).padStart(2,'0')}.pdf`;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          UI.toast('✓ PDF downloaded!', 'success');
        } catch(e) {
          console.error('PDF error:', e);
          UI.toast('PDF error: ' + e.message, 'error');
        } finally {
          btn.textContent = '📄 Download PDF Report'; btn.disabled = false;
        }
      });
    }
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
  async loadAI() {
    this.updateAIStats(State.summary);
    try {
      const history = await API.get('/ai/history');
      if (!history.length) return;
      const container = document.getElementById('chatMessages');
      if (!container) return;
      container.innerHTML = '';
      history.forEach(m => this.appendMsg(m.role, m.content));
      container.scrollTop = container.scrollHeight;
    } catch {}
  },

  appendMsg(role, content) {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    const d = document.createElement('div');
    d.className = `chat-msg ${role}`;
    d.innerHTML = `
      <div class="msg-avatar">${role === 'assistant' ? 'N' : 'U'}</div>
      <div class="msg-content">
        <div class="msg-bubble">${content.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div>
        <div class="msg-time">${new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },

  appendTyping() {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    const d = document.createElement('div');
    d.className = 'chat-msg assistant'; d.id = 'typingIndicator';
    d.innerHTML = `<div class="msg-avatar">N</div><div class="msg-content"><div class="msg-bubble"><div class="msg-typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },

  async sendChat(msg) {
    if (!msg.trim()) return;
    const input = document.getElementById('chatInput');
    const btn   = document.getElementById('chatSend');
    if (input) input.value = '';
    if (btn) btn.disabled = true;
    this.appendMsg('user', msg);
    this.appendTyping();
    try {
      const { reply } = await API.post('/ai/chat', { message: msg });
      document.getElementById('typingIndicator')?.remove();
      this.appendMsg('assistant', reply);
    } catch(e) {
      document.getElementById('typingIndicator')?.remove();
      this.appendMsg('assistant', '⚠ Error: ' + e.message);
    } finally { if (btn) btn.disabled = false; }
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
        const txns    = await API.get('/transactions?limit=500');
        const matches = txns.filter(t => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)).slice(0,6);
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
      else if (a === 'edit-goal')         App.editGoal(id);
      else if (a === 'del-goal')          App.deleteGoal(id);
      else if (a === 'add-savings')       App.addSavings(id);
      else if (a === 'goto-dashboard')    App.navigate('dashboard');
      else if (a === 'toggle-recurring')  Recurring.toggle(id, parseInt(t.dataset.active));
      else if (a === 'del-recurring')     Recurring.delete(id);
      else if (a === 'goto-transactions') App.navigate('transactions');
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

  bindFilters() {
    const go = () => {
      const typeEl = document.getElementById('filterType');
      const catEl  = document.getElementById('filterCategory');
      const fromEl = document.getElementById('filterFrom');
      const toEl   = document.getElementById('filterTo');
      this.loadTransactions({
        type:     typeEl ? typeEl.value : '',
        category: catEl  ? catEl.value  : '',
        from:     fromEl ? fromEl.value : '',
        to:       toEl   ? toEl.value   : ''
      });
    };
    ['filterType','filterCategory','filterFrom','filterTo'].forEach(id =>
      document.getElementById(id)?.addEventListener('change', go));
    this.on('clearFilters', 'click', () => {
      ['filterType','filterCategory'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      ['filterFrom','filterTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      this.loadTransactions();
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
    btn?.addEventListener('click',   () => this.sendChat(input.value));
    input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) this.sendChat(input.value); });
    document.querySelectorAll('.sug-btn').forEach(b => b.addEventListener('click', () => this.sendChat(b.dataset.prompt)));
    this.on('clearChat', 'click', async () => {
      await API.del('/ai/history');
      document.getElementById('chatMessages').innerHTML = `
        <div class="chat-msg assistant">
          <div class="msg-avatar">N</div>
          <div class="msg-content">
            <div class="msg-bubble">Chat cleared! How can I help you today? 🚀</div>
            <div class="msg-time">Just now</div>
          </div>
        </div>`;
      UI.toast('✓ Chat cleared', 'success');
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
  }
};

// App.init() is called by Auth.onLoggedIn() after successful authentication