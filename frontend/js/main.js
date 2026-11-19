// ── Apply saved theme & sidebar state immediately ──────────────
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

// ── Feature ES Modules ─────────────────────────────────────────
import { State } from './modules/state.js';
import { DashboardModule } from './modules/dashboard.js';
import { TransactionsModule } from './modules/transactions.js';
import { BudgetsModule } from './modules/budgets.js';
import { SubscriptionsModule } from './modules/subscriptions.js';
import { ProfileModule } from './modules/profile.js';
import { GoalsModule } from './modules/goals.js';
import { ReportsModule } from './modules/reports.js';
import { AIModule } from './modules/ai.js';
import { Notifications } from './modules/notifications.js';
import { Tags } from './modules/tags.js';

// ── Main App Wiring ────────────────────────────────────────────
export const App = {
  ...DashboardModule,
  ...TransactionsModule,
  ...BudgetsModule,
  ...SubscriptionsModule,
  ...ProfileModule,
  ...GoalsModule,
  ...ReportsModule,
  ...AIModule,
  Notifications,
  Tags,

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
    this.bindCashflowRadar();
    this.bindCurrencyFeatures();
    this.updateNavCount();
    Notifications.init();
    Tags.init();
    await this.loadAccounts();
    await this.loadDashboard();
    if (typeof Recurring !== 'undefined' && Recurring.load) {
      Recurring.load();
    }
  },

  setGreeting() {
    const h = new Date().getHours();
    const el = document.getElementById('greeting');
    if (el) el.textContent = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';

    const nameEl = document.getElementById('greetName');
    if (nameEl) {
      try {
        const user = JSON.parse(localStorage.getItem('fl_user') || '{}');
        const firstName = (user.name || '').split(' ')[0];
        nameEl.textContent = firstName;
      } catch (_) { }
    }
  },

  setTopbarDate() {
    const el = document.getElementById('topbarDate');
    if (el) el.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },

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
    this.on('quickAdd', 'click', () => UI.openAddModal());
    this.on('mobileFabAdd', 'click', () => UI.openAddModal());
    this.on('exportBtn', 'click', () => API.exportCSV());
    this.on('getTipBtn', 'click', () => this.getQuickTip());
  },

  async navigate(page) {
    State.page = page;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    if (page === 'dashboard') await this.loadDashboard();
    else if (page === 'transactions') await this.loadTransactions();
    else if (page === 'accounts') await this.loadAccounts(true);
    else if (page === 'budgets') await this.loadBudgets();
    else if (page === 'analytics') await this.loadAnalytics();
    else if (page === 'ai') await this.loadAI();
    else if (page === 'goals') await this.loadGoals();
    else if (page === 'recurring') {
      if (typeof Recurring !== 'undefined' && Recurring.load) await Recurring.load();
    }
    else if (page === 'groups') {
      if (typeof Groups !== 'undefined' && Groups.init) await Groups.init();
    }
    else if (page === 'import') {
      if (typeof Importer !== 'undefined' && Importer.init) Importer.init();
    }
    else if (page === 'reports') this.initReports();
  },

  on(id, ev, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  },

  bindSearch() {
    const input = document.getElementById('globalSearch');
    const wrap = input?.closest('.topbar-search');
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
          String(t.amount).includes(q) ||
          fmt(t.amount).toLowerCase().includes(q)
        ).slice(0, 6);
        if (!matches.length) return;
        resultsEl = document.createElement('div');
        resultsEl.className = 'search-results';
        resultsEl.innerHTML = matches.map(t => `
          <div class="search-item" data-action="goto-transactions">
            <div style="width:8px;height:8px;border-radius:50%;background:${Charts.getCatColor(t.category)};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.description)}</div>
              <div style="font-size:11px;color:#A79C8C">${escapeHtml(t.category)} · ${escapeHtml(t.date)}</div>
            </div>
            <div style="font-size:13px;font-family:'JetBrains Mono',monospace;color:${t.type === 'income' ? '#3E6154' : '#A6402F'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</div>
          </div>`).join('');
        wrap.appendChild(resultsEl);
      } catch { }
    });
    document.addEventListener('click', e => {
      if (!wrap?.contains(e.target) && resultsEl) { resultsEl.remove(); resultsEl = null; }
    });
  },

  bindModals() {
    this.on('openAddModal',    'click', () => UI.openAddModal());
    this.on('closeAddModal',   'click', () => UI.closeAddModal());
    this.on('saveTxnBtn',      'click', () => this.saveTxn());
    this.on('addModal',        'click', e  => { if (e.target.id === 'addModal') UI.closeAddModal(); });
    this.on('txnAmount',       'keydown', e => { if (e.key === 'Enter') this.saveTxn(); });
    this.on('txnAmount',       'input',   () => { if (UI.isSplitMode) UI.updateSplitCalculator(); });
    this.on('btnToggleSplit',  'click', () => UI.setSplitMode(!UI.isSplitMode));
    this.on('btnCancelSplit',  'click', () => UI.setSplitMode(false));
    this.on('btnAddSplitRow',  'click', () => UI.addSplitRow());

    this.on('openBudgetModal', 'click', () => UI.openBudgetModal());
    this.on('closeBudgetModal', 'click', () => UI.closeBudgetModal());
    this.on('saveBudgetBtn', 'click', () => this.saveBudget());
    this.on('budgetModal', 'click', e => { if (e.target.id === 'budgetModal') UI.closeBudgetModal(); });
    this.on('openAutoBudgetBtn', 'click', () => this.openAutoBudgetPlanner());
    this.on('closeAutoBudgetBtn', 'click', () => this.closeAutoBudgetPlanner());
    this.on('cancelAutoBudgetBtn', 'click', () => this.closeAutoBudgetPlanner());
    this.on('refreshAutoBudgetBtn', 'click', () => this.fetchBudgetSuggestions());
    this.on('applyAutoBudgetsBtn', 'click', () => this.applySelectedBudgets());

    this.on('openAccountModal', 'click', () => UI.openAccountModal());
    this.on('closeAccountModal', 'click', () => UI.closeAccountModal());
    this.on('saveAccountBtn', 'click', () => this.saveAccount());
    this.on('accountModal', 'click', e => { if (e.target.id === 'accountModal') UI.closeAccountModal(); });

    this.on('openGoalModal', 'click', () => UI.openGoalModal());
    this.on('closeGoalModal', 'click', () => UI.closeGoalModal());
    this.on('saveGoalBtn', 'click', () => this.saveGoal());
    this.on('goalModal', 'click', e => { if (e.target.id === 'goalModal') UI.closeGoalModal(); });

    this.on('closeAddSavingsModal', 'click', () => UI.closeAddSavingsModal());
    this.on('asCancelBtn',          'click', () => UI.closeAddSavingsModal());
    this.on('asSubmitBtn',          'click', () => this.submitSavingsDeposit());
    this.on('addSavingsModal',      'click', e => { if (e.target.id === 'addSavingsModal') UI.closeAddSavingsModal(); });
    this.on('asTypeDeposit',        'click', () => UI.setSavingsMode('deposit'));
    this.on('asTypeWithdraw',       'click', () => UI.setSavingsMode('withdraw'));
    this.on('asAmount',             'input', () => UI.updateSavingsPreview());
    this.on('asAmount',             'keydown', e => { if (e.key === 'Enter') this.submitSavingsDeposit(); });

    document.getElementById('asQuickChips')?.addEventListener('click', e => {
      const chip = e.target.closest('.as-chip');
      if (!chip) return;
      const amtInput = document.getElementById('asAmount');
      if (!amtInput) return;
      if (chip.id === 'asFillRemainingBtn') {
        const rem = parseFloat(chip.dataset.rem) || 0;
        if (rem > 0) amtInput.value = rem;
      } else {
        const addAmt = parseFloat(chip.dataset.amt) || 0;
        const current = parseFloat(amtInput.value) || 0;
        amtInput.value = current + addAmt;
      }
      UI.updateSavingsPreview();
    });

    this.on('openRecurringModal', 'click', () => {
      const nd = document.getElementById('recNextDate');
      if (nd) nd.value = (typeof getLocalDateString === 'function' ? getLocalDateString() : new Date().toISOString().slice(0, 10));
      document.getElementById('recurringModal')?.classList.add('open');
    });
    this.on('closeRecurringModal', 'click', () => document.getElementById('recurringModal')?.classList.remove('open'));
    this.on('saveRecurringBtn', 'click', () => {
      if (typeof Recurring !== 'undefined' && Recurring.save) Recurring.save();
    });
    this.on('recurringModal', 'click', e => { if (e.target.id === 'recurringModal') document.getElementById('recurringModal')?.classList.remove('open'); });
    this.on('receiptModal', 'click', e => { if (e.target.id === 'receiptModal') document.getElementById('receiptModal')?.classList.remove('open'); });
    this.on('deleteAccountModal', 'click', e => { if (e.target.id === 'deleteAccountModal') document.getElementById('deleteAccountModal')?.classList.remove('open'); });

    this.on('importBtn', 'click', () => {
      if (typeof Importer !== 'undefined' && Importer.importAll) Importer.importAll();
    });

    document.addEventListener('click', e => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const a = t.dataset.action;
      const id = parseInt(t.dataset.id);

      if (a === 'type-income') UI.setType('income');
      else if (a === 'type-expense') UI.setType('expense');
      else if (a === 'rec-type-income') {
        const recType = document.getElementById('recType');
        if (recType) recType.value = 'income';
        t.className = 'type-btn active-income';
        const other = document.getElementById('recTypeExpense');
        if (other) other.className = 'type-btn';
      }
      else if (a === 'rec-type-expense') {
        const recType = document.getElementById('recType');
        if (recType) recType.value = 'expense';
        t.className = 'type-btn active-expense';
        const other = document.getElementById('recTypeIncome');
        if (other) other.className = 'type-btn';
      }
      else if (a === 'select-cat') {
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        t.classList.add('active');
        const sel = document.getElementById('txnCategory');
        if (![...sel.options].find(o => o.value === t.dataset.cat)) {
          const opt = document.createElement('option');
          opt.value = t.dataset.cat;
          opt.textContent = t.dataset.cat;
          sel.appendChild(opt);
        }
        sel.value = t.dataset.cat;
      }
      else if (a === 'edit-txn') this.editTxn(id);
      else if (a === 'del-txn') this.deleteTxn(id);
      else if (a === 'del-budget') this.deleteBudget(id);
      else if (a === 'apply-single-budget') this.applySingleBudget(parseInt(t.dataset.idx));
      else if (a === 'edit-account') this.editAccount(id);
      else if (a === 'del-account') this.deleteAccount(id);
      else if (a === 'goto-accounts') this.navigate('accounts');
      else if (a === 'edit-goal') this.editGoal(id);
      else if (a === 'del-goal') this.deleteGoal(id);
      else if (a === 'add-savings') this.addSavings(id);
      else if (a === 'goto-dashboard') this.navigate('dashboard');
      else if (a === 'toggle-recurring') {
        if (typeof Recurring !== 'undefined' && Recurring.toggle) Recurring.toggle(id, parseInt(t.dataset.active));
      }
      else if (a === 'del-recurring') {
        if (typeof Recurring !== 'undefined' && Recurring.delete) Recurring.delete(id);
      }
      else if (a === 'goto-transactions') this.navigate('transactions');
      else if (a === 'goto-budgets') {
        document.getElementById('notifDropdown')?.classList.remove('show');
        this.navigate('budgets');
      }
      else if (a === 'goto-recurring') {
        document.getElementById('notifDropdown')?.classList.remove('show');
        this.navigate('recurring');
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
  }
};

if (typeof window !== 'undefined') {
  window.App = App;
  window.State = State;
  window.Notifications = Notifications;
  window.Tags = Tags;
}

export default App;
