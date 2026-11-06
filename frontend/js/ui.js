// Locale per symbol so number grouping looks native for each currency
// (₹ uses Indian lakh/crore grouping — 1,50,000 — the others use the
// standard thousands grouping — 150,000).
const CURRENCY_LOCALE = { '₹': 'en-IN', '$': 'en-US', '€': 'de-DE', '£': 'en-GB' };

// Reads the symbol from localStorage on every call (not cached) so a
// profile change takes effect immediately without a page reload —
// saveProfile() already updates fl_user before re-rendering the page.
function currentCurrency() {
  try { return JSON.parse(localStorage.getItem('fl_user') || '{}').currency || '₹'; }
  catch { return '₹'; }
}

const fmt = n => {
  const symbol = currentCurrency();
  const locale = CURRENCY_LOCALE[symbol] || 'en-IN';
  return symbol + Math.abs(n).toLocaleString(locale, {minimumFractionDigits:0, maximumFractionDigits:0});
};

const UI = {
  currentType: 'income',
  editId: null,
  isSplitMode: false,
  splitRows: [],

  setSplitMode(active) {
    this.isSplitMode = Boolean(active);
    const toggleBtn = document.getElementById('btnToggleSplit');
    const singleSection = document.getElementById('singleCategorySection');
    const splitSection = document.getElementById('splitCategorySection');
    if (!toggleBtn || !singleSection || !splitSection) return;

    if (this.isSplitMode) {
      toggleBtn.style.display = 'none';
      singleSection.style.display = 'none';
      splitSection.style.display = 'block';

      if (!this.splitRows || this.splitRows.length < 2) {
        const total = parseFloat(document.getElementById('txnAmount')?.value) || 0;
        const half1 = total > 0 ? Math.round((total / 2) * 100) / 100 : '';
        const half2 = total > 0 ? Math.round((total - (parseFloat(half1) || 0)) * 100) / 100 : '';
        this.splitRows = [
          { category: 'Food', amount: half1, note: '' },
          { category: 'Shopping', amount: half2, note: '' }
        ];
      }
      this.renderSplitRows();
    } else {
      toggleBtn.style.display = 'inline-flex';
      toggleBtn.textContent = '✂️ Split into Multiple Categories';
      singleSection.style.display = 'block';
      splitSection.style.display = 'none';
      this.splitRows = [];
    }
    this.updateSplitCalculator();
  },

  renderSplitRows() {
    const container = document.getElementById('splitRowsContainer');
    if (!container) return;
    const cats = ['Food','Transport','Shopping','Entertainment','Health','Bills','Salary','Freelance','Investment','Other'];

    container.innerHTML = this.splitRows.map((r, i) => `
      <div class="split-row" data-index="${i}">
        <select class="split-cat-select" data-index="${i}">
          ${cats.map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <div class="input-prefix" style="max-width:140px">
          <span>₹</span>
          <input type="number" class="split-amt-input" data-index="${i}" placeholder="0.00" min="0" step="0.01" value="${r.amount !== '' && r.amount !== undefined ? r.amount : ''}" />
        </div>
        <input type="text" class="split-note-input" data-index="${i}" placeholder="Detail/Note (optional)" value="${r.note || ''}" style="flex:1" />
        <button type="button" class="btn-ghost split-del-btn" data-index="${i}" title="Remove part" ${this.splitRows.length <= 2 ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}>✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.split-cat-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (this.splitRows[idx]) this.splitRows[idx].category = e.target.value;
      });
    });

    container.querySelectorAll('.split-amt-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx = parseInt(e.target.dataset.index, 10);
        const val = parseFloat(e.target.value);
        if (this.splitRows[idx]) this.splitRows[idx].amount = isNaN(val) ? '' : val;
        this.updateSplitCalculator();
      });
    });

    container.querySelectorAll('.split-note-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (this.splitRows[idx]) this.splitRows[idx].note = e.target.value;
      });
    });

    container.querySelectorAll('.split-del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        if (this.splitRows.length > 2) {
          this.splitRows.splice(idx, 1);
          this.renderSplitRows();
          this.updateSplitCalculator();
        }
      });
    });

    this.updateSplitCalculator();
  },

  addSplitRow(category = 'Other', amount = '', note = '') {
    this.splitRows.push({ category, amount, note });
    this.renderSplitRows();
    this.updateSplitCalculator();
  },

  updateSplitCalculator() {
    const totalEl = document.getElementById('txnAmount');
    const total = parseFloat(totalEl?.value) || 0;
    const allocated = this.splitRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const remaining = Math.round((total - allocated) * 100) / 100;

    const allocSpan = document.getElementById('splitAllocatedText');
    const totalSpan = document.getElementById('splitTotalText');
    const remSpan = document.getElementById('splitRemainingText');
    const pill = document.getElementById('splitBalancePill');

    if (allocSpan) allocSpan.textContent = typeof fmt === 'function' ? fmt(allocated) : `₹${allocated.toFixed(0)}`;
    if (totalSpan) totalSpan.textContent = typeof fmt === 'function' ? fmt(total) : `₹${total.toFixed(0)}`;

    if (remSpan && pill) {
      if (Math.abs(remaining) < 0.01 && total > 0) {
        remSpan.textContent = '✓ Balanced (₹0.00 left)';
        pill.style.background = 'var(--income-tint)';
        pill.style.borderColor = 'var(--income-border)';
        pill.style.color = 'var(--income)';
      } else if (remaining > 0) {
        remSpan.textContent = `₹${remaining.toFixed(2)} left to allocate`;
        pill.style.background = 'var(--warning-tint)';
        pill.style.borderColor = 'var(--warning-border)';
        pill.style.color = 'var(--warning-dark)';
      } else {
        remSpan.textContent = `₹${Math.abs(remaining).toFixed(2)} over allocated`;
        pill.style.background = 'var(--expense-tint)';
        pill.style.borderColor = 'var(--expense-border)';
        pill.style.color = 'var(--expense)';
      }
    }
  },

  setType(type) {
    this.currentType = type;
    const inc = document.getElementById('typeIncome');
    const exp = document.getElementById('typeExpense');
    if (inc) inc.className = 'type-btn' + (type==='income'  ? ' active-income'  : '');
    if (exp) exp.className = 'type-btn' + (type==='expense' ? ' active-expense' : '');
    this.buildCatPicker(type, null);
  },

  buildCatPicker(type='income', selected=null) {
    const cats = ['Food','Transport','Shopping','Entertainment','Health','Bills','Salary','Freelance','Investment','Other'];
    const matched = cats.find(c => c.toLowerCase() === (selected || '').toLowerCase());
    const current = matched || selected || (type==='income' ? 'Salary' : 'Food');
    const picker = document.getElementById('catPicker');
    const select = document.getElementById('txnCategory');
    if (!select) return;
    select.innerHTML = cats.map(c=>`<option value="${c}">${c}</option>`).join('');
    select.value = current;
    if (picker) picker.innerHTML = cats.map(c=>`
      <button type="button" class="cat-chip${c===current?' active':''}" data-action="select-cat" data-cat="${c}">
        ${CAT_EMOJIS[c]||'•'} ${c}
      </button>`).join('');
  },

  openAddModal(txn=null) {
    const isEdit = Boolean(txn && txn.id);
    this.editId = isEdit ? txn.id : null;
    this.setSplitMode(false);
    const toggleBtn = document.getElementById('btnToggleSplit');
    if (toggleBtn) toggleBtn.style.display = isEdit ? 'none' : 'inline-flex';

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const title = document.getElementById('modalTitle');
    if (title) title.textContent = isEdit ? 'Edit Transaction' : 'Add Transaction';
    const saveBtn = document.getElementById('saveTxnBtn');
    if (saveBtn) saveBtn.textContent = isEdit ? 'Update Transaction' : 'Save Transaction';
    set('txnDesc',   txn ? txn.description : '');
    set('txnAmount', txn ? txn.amount : '');
    set('txnDate',   txn ? txn.date : new Date().toISOString().slice(0,10));
    const targetType = txn ? txn.type : 'income';
    this.setType(targetType);
    this.buildCatPicker(targetType, txn ? txn.category : null);
    const accSel = document.getElementById('txnAccount');
    if (accSel && txn?.account_id) accSel.value = txn.account_id;
    Tags.setPills(txn?.tags || []);
    document.getElementById('addModal')?.classList.add('open');
    setTimeout(() => document.getElementById('txnDesc')?.focus(), 100);
  },

  closeAddModal() {
    document.getElementById('addModal')?.classList.remove('open');
    this.setSplitMode(false);
    this.editId = null;
    Tags.setPills([]);
  },

  openBudgetModal() {
    const lim = document.getElementById('budgetLimit');
    if (lim) lim.value = '';
    document.getElementById('budgetModal')?.classList.add('open');
    setTimeout(() => document.getElementById('budgetLimit')?.focus(), 100);
  },
  closeBudgetModal() { document.getElementById('budgetModal')?.classList.remove('open'); },

  openGoalModal(goal=null) {
    const title = document.getElementById('goalModalTitle');
    if (title) title.textContent = goal ? 'Edit Goal' : 'Add Financial Goal';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('goalName',   goal ? goal.name   : '');
    set('goalTarget', goal ? goal.target : '');
    set('goalSaved',  goal ? goal.saved  : '0');
    set('goalDate',   goal ? goal.date   : '');
    set('goalEditId', goal ? goal.id     : '');
    document.getElementById('goalModal')?.classList.add('open');
    setTimeout(() => document.getElementById('goalName')?.focus(), 100);
  },
  closeGoalModal() { document.getElementById('goalModal')?.classList.remove('open'); },

  currentSavingsGoal: null,
  savingsMode: 'deposit', // 'deposit' | 'withdraw'

  openAddSavingsModal(goal) {
    if (!goal) return;
    this.currentSavingsGoal = goal;
    this.savingsMode = 'deposit';

    // Set toggle state
    const depBtn = document.getElementById('asTypeDeposit');
    const wthBtn = document.getElementById('asTypeWithdraw');
    if (depBtn) depBtn.className = 'type-btn active-income';
    if (wthBtn) wthBtn.className = 'type-btn';

    // Labels & text
    const title = document.getElementById('addSavingsTitle');
    const sub = document.getElementById('addSavingsSub');
    const amtLbl = document.getElementById('asAmountLabel');
    const accLbl = document.getElementById('asAccountLabel');
    const submitBtn = document.getElementById('asSubmitBtn');
    const logTxnLbl = document.getElementById('asLogTxnLabel');

    if (title) title.textContent = `Add Savings to "${goal.name}"`;
    if (sub) sub.textContent = 'Deposit money into your target savings fund';
    if (amtLbl) amtLbl.textContent = 'Amount to Add (₹)';
    if (accLbl) accLbl.textContent = 'Deduct From Account';
    if (submitBtn) submitBtn.textContent = 'Deposit Savings';
    if (logTxnLbl) logTxnLbl.textContent = 'Record as a "Savings / Investment" expense transaction';

    // Goal Info Card
    const saved = Number(goal.saved) || 0;
    const target = Number(goal.target) || 0;
    const pct = target > 0 ? Math.min(Math.round((saved / target) * 100), 100) : 0;
    const remaining = Math.max(0, target - saved);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('asGoalName', goal.name);
    set('asGoalSaved', fmt(saved));
    set('asGoalTarget', fmt(target));
    set('asGoalPercent', `${pct}% reached`);
    set('asGoalRemaining', remaining > 0 ? `${fmt(remaining)} to reach goal` : '🎉 Goal already reached!');
    set('asProjectedNewPercent', '');

    const bar = document.getElementById('asProgressBar');
    if (bar) bar.style.width = `${pct}%`;

    const fillRemBtn = document.getElementById('asFillRemainingBtn');
    if (fillRemBtn) {
      fillRemBtn.textContent = remaining > 0 ? `Full Remaining (${fmt(remaining)})` : 'Goal Full';
      fillRemBtn.dataset.rem = remaining;
    }

    // Input fields
    const idEl = document.getElementById('asGoalId');
    const amtEl = document.getElementById('asAmount');
    const dateEl = document.getElementById('asDate');
    const noteEl = document.getElementById('asNote');
    const logCheck = document.getElementById('asLogTxn');

    if (idEl) idEl.value = goal.id;
    if (amtEl) amtEl.value = '';
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
    if (noteEl) noteEl.value = `Savings deposit: ${goal.name}`;
    if (logCheck) logCheck.checked = true;

    // Populate Account select with balances
    const accSel = document.getElementById('asSourceAccount');
    if (accSel && typeof State !== 'undefined' && Array.isArray(State.accounts)) {
      const active = State.accounts.filter(a => !a.archived);
      let opts = active.map(a => `<option value="${a.id}">${a.name} (${fmt(a.balance || 0)})</option>`).join('');
      opts += '<option value="">(None - Don\'t change account balance)</option>';
      accSel.innerHTML = opts;
    }

    document.getElementById('addSavingsModal')?.classList.add('open');
    setTimeout(() => amtEl?.focus(), 100);
  },

  closeAddSavingsModal() {
    document.getElementById('addSavingsModal')?.classList.remove('open');
    this.currentSavingsGoal = null;
  },

  setSavingsMode(mode) {
    this.savingsMode = mode;
    const depBtn = document.getElementById('asTypeDeposit');
    const wthBtn = document.getElementById('asTypeWithdraw');
    const amtLbl = document.getElementById('asAmountLabel');
    const accLbl = document.getElementById('asAccountLabel');
    const submitBtn = document.getElementById('asSubmitBtn');
    const logTxnLbl = document.getElementById('asLogTxnLabel');
    const title = document.getElementById('addSavingsTitle');
    const noteEl = document.getElementById('asNote');
    const goal = this.currentSavingsGoal;
    const goalName = goal ? goal.name : 'Goal';

    if (mode === 'deposit') {
      if (depBtn) depBtn.className = 'type-btn active-income';
      if (wthBtn) wthBtn.className = 'type-btn';
      if (title) title.textContent = `Add Savings to "${goalName}"`;
      if (amtLbl) amtLbl.textContent = 'Amount to Add (₹)';
      if (accLbl) accLbl.textContent = 'Deduct From Account';
      if (submitBtn) submitBtn.textContent = 'Deposit Savings';
      if (logTxnLbl) logTxnLbl.textContent = 'Record as a "Savings / Investment" expense transaction';
      if (noteEl) noteEl.value = `Savings deposit: ${goalName}`;
    } else {
      if (wthBtn) wthBtn.className = 'type-btn active-expense';
      if (depBtn) depBtn.className = 'type-btn';
      if (title) title.textContent = `Withdraw from "${goalName}"`;
      if (amtLbl) amtLbl.textContent = 'Amount to Withdraw (₹)';
      if (accLbl) accLbl.textContent = 'Deposit Back Into Account';
      if (submitBtn) submitBtn.textContent = 'Withdraw Funds';
      if (logTxnLbl) logTxnLbl.textContent = 'Record as an income / funds returned transaction';
      if (noteEl) noteEl.value = `Goal withdrawal: ${goalName}`;
    }
    this.updateSavingsPreview();
  },

  updateSavingsPreview() {
    const goal = this.currentSavingsGoal;
    if (!goal) return;

    const amtInput = document.getElementById('asAmount');
    const amt = parseFloat(amtInput?.value) || 0;
    const saved = Number(goal.saved) || 0;
    const target = Number(goal.target) || 0;

    let newSaved = this.savingsMode === 'deposit' ? (saved + amt) : Math.max(0, saved - amt);
    let newPct = target > 0 ? Math.min(Math.round((newSaved / target) * 100), 100) : 0;
    let newRem = Math.max(0, target - newSaved);

    const bar = document.getElementById('asProgressBar');
    const projEl = document.getElementById('asProjectedNewPercent');

    if (amt <= 0) {
      const origPct = target > 0 ? Math.min(Math.round((saved / target) * 100), 100) : 0;
      if (bar) bar.style.width = `${origPct}%`;
      if (projEl) projEl.textContent = '';
      return;
    }

    if (bar) bar.style.width = `${newPct}%`;

    if (projEl) {
      if (this.savingsMode === 'deposit') {
        if (newSaved >= target) {
          projEl.innerHTML = `<span style="color:var(--income)">🎉 Will reach 100% (Goal complete!)</span>`;
        } else {
          projEl.innerHTML = `➔ Will reach <strong>${newPct}%</strong> (${fmt(newRem)} left)`;
        }
      } else {
        projEl.innerHTML = `➔ Will become <strong>${newPct}%</strong> (${fmt(newSaved)} saved)`;
      }
    }
  },

  openAccountModal(account=null) {
    const title = document.getElementById('accountModalTitle');
    if (title) title.textContent = account ? 'Edit Account' : 'Add Account';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('accountName',            account ? account.name : '');
    set('accountType',            account ? account.type : 'cash');
    set('accountStartingBalance', account ? account.starting_balance : '0');
    set('editAccountId',          account ? account.id : '');
    document.getElementById('accountModal')?.classList.add('open');
    setTimeout(() => document.getElementById('accountName')?.focus(), 100);
  },
  closeAccountModal() { document.getElementById('accountModal')?.classList.remove('open'); },

  // Fills every <select id="...Account"> in the DOM with the user's
  // accounts (called after any accounts load, so the transaction modal,
  // the transactions-page filter, and the import page all stay in sync
  // without each needing its own fetch).
  populateAccountSelects(accounts, filterEl='') {
    const active = accounts.filter(a => !a.archived);
    const opts = active.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    const txnSel = document.getElementById('txnAccount');
    if (txnSel) txnSel.innerHTML = opts || '<option value="">No accounts yet</option>';

    const importSel = document.getElementById('importAccount');
    if (importSel) importSel.innerHTML = opts || '<option value="">No accounts yet</option>';

    const filterSel = document.getElementById('filterAccount');
    if (filterSel) {
      const current = filterSel.value;
      filterSel.innerHTML = '<option value="">All Accounts</option>' + opts;
      if ([...filterSel.options].some(o => o.value === current)) filterSel.value = current;
    }

    const asSel = document.getElementById('asSourceAccount');
    if (asSel) {
      const asOpts = active.map(a => `<option value="${a.id}">${a.name} (${fmt(a.balance || 0)})</option>`).join('');
      asSel.innerHTML = asOpts + '<option value="">(None - Don\'t change account balance)</option>';
    }
  },

  renderAccounts(accounts) {
    const grid    = document.getElementById('accountGrid');
    const summary = document.getElementById('accountSummary');
    if (!grid) return;
    const totalBalance = accounts.reduce((s,a) => s + a.balance, 0);
    const negativeCount = accounts.filter(a => a.balance < 0).length;
    if (summary) summary.innerHTML = `
      <div class="bs-card"><div class="bs-label">Total Balance</div><div class="bs-val" style="color:${totalBalance>=0?'var(--income)':'var(--expense)'}">${fmt(totalBalance)}</div></div>
      <div class="bs-card"><div class="bs-label">Accounts</div><div class="bs-val">${accounts.length}</div></div>
      <div class="bs-card"><div class="bs-label">Negative Balance</div><div class="bs-val" style="color:${negativeCount>0?'var(--expense)':'var(--income)'}">${negativeCount} account${negativeCount===1?'':'s'}</div></div>`;
    if (!accounts.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No accounts yet. Add one to start tracking balances!</div>'; return; }
    const typeEmoji = { cash:'💵', bank:'🏦', credit_card:'💳', wallet:'👛', other:'📦' };
    const typeLabel = { cash:'Cash', bank:'Bank', credit_card:'Credit Card', wallet:'Wallet', other:'Other' };
    grid.innerHTML = accounts.map(a => `
      <div class="budget-card" style="${a.archived?'opacity:0.55':''}">
        <div class="budget-header">
          <div class="budget-cat-wrap">
            <div class="budget-cat-dot" style="background:${a.color||'#6366f1'}"></div>
            <div class="budget-cat">${typeEmoji[a.type]||'📦'} ${a.name}</div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="txn-btn edit" data-action="edit-account" data-id="${a.id}" title="Edit">✎</button>
            <button class="budget-delete" data-action="del-account" data-id="${a.id}">✕</button>
          </div>
        </div>
        <div class="budget-amounts">
          <span>Type: <span>${typeLabel[a.type]||a.type}</span></span>
          <span>Starting: <span>${fmt(a.starting_balance)}</span></span>
        </div>
        <div class="budget-footer" style="margin-top:8px">
          <div class="budget-percent" style="color:${a.balance>=0?'var(--income)':'var(--expense)'};font-size:20px">${fmt(a.balance)}</div>
          <div class="budget-remaining">${a.archived ? 'Archived' : 'Current balance'}</div>
        </div>
      </div>`).join('');
  },

  renderAccountStrip(accounts) {
    const card = document.getElementById('dashAccountsCard');
    const el   = document.getElementById('dashAccountStrip');
    if (!card || !el) return;
    const active = accounts.filter(a => !a.archived);
    // Hidden entirely when there's only the single auto-created default
    // account — showing a one-item "By Account" strip is just noise
    // until the user actually has more than one account to compare.
    if (active.length < 2) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    el.innerHTML = active.map(a => `
      <div style="flex:1;min-width:140px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);border-left:3px solid ${a.color||'var(--brand)'}">
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px">${a.name}</div>
        <div style="font-size:16px;font-weight:600;color:${a.balance>=0?'var(--income)':'var(--expense)'}">${fmt(a.balance)}</div>
      </div>`).join('');
  },

  toast(msg, type='success', duration=2800) {
    const el = document.getElementById('toast');
    if (!el) { console.warn('Toast:', msg); return; }
    el.textContent = msg;
    el.className = `toast show ${type}`;
    setTimeout(() => el.classList.remove('show'), duration);
  },

  updateSidebar(income, expense, balance) {
    const balEl = document.getElementById('sidebarBalance');
    if (balEl) {
      balEl.textContent = fmt(balance);
      balEl.style.color = balance >= 0 ? 'white' : 'var(--expense-tint)';
    }
    const incEl = document.getElementById('sidebarInc');
    const expEl = document.getElementById('sidebarExp');
    if (incEl) incEl.textContent = '↑ ' + fmt(income);
    if (expEl) expEl.textContent = '↓ ' + fmt(expense);
    const pct = income > 0 ? Math.min((income - expense) / income * 100, 100) : 0;
    const fillEl = document.getElementById('sidebarBarFill');
    if (fillEl) fillEl.style.width = Math.max(pct, 0) + '%';
  },

  renderTxnList(txns, containerId, limit=null, tableMode=false) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (tableMode) el.classList.add('table-mode');
    else el.classList.remove('table-mode');
    const list = limit ? txns.slice(0, limit) : txns;
    if (!list.length) {
      // tableMode is only ever true on the Transactions page, where an
      // empty list usually means the filters excluded everything rather
      // than there being no data at all — different message, same markup.
      const filtersActive = tableMode && ['filterType','filterCategory','filterFrom','filterTo']
        .some(id => document.getElementById(id)?.value);
      el.innerHTML = filtersActive
        ? `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No matches</div><div class="empty-sub">Nothing fits these filters. Try widening the date range or clearing a filter.</div></div>`
        : `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No transactions yet</div><div class="empty-sub">Add your first one to start tracking.</div></div>`;
      return;
    }
    el.innerHTML = list.map(t => {
      const color = CAT_COLORS[t.category] || '#94A3B8';
      const isIncome = t.type === 'income';
      const borderColor = isIncome ? 'var(--income)' : 'var(--expense)';
      const splitBadge = t.split_id
        ? `<span class="txn-split-chip" title="Part of a split transaction">✂️ Split</span>`
        : '';
      const tagsHtml = (t.tags && t.tags.length)
        ? `<div class="txn-tags">${t.tags.map(g => `<span class="txn-tag-chip">#${g}</span>`).join('')}</div>`
        : '';
      return `<div class="txn-item" style="border-left-color:${borderColor}">
        <div class="txn-name-wrap">
          <div class="txn-dot" style="background:${color}"></div>
          <div class="txn-meta-col">
            <div class="txn-name">${t.description} ${splitBadge}</div>
            <div class="txn-date">${t.category} · ${t.date}</div>
            ${tagsHtml}
          </div>
        </div>
        <div class="txn-cat-badge">${CAT_EMOJIS[t.category]||''} ${t.category}</div>
        <div class="txn-date-col">${t.date}</div>
        <div class="txn-amount ${isIncome?'inc':'exp'}">${isIncome?'+':'-'}${fmt(t.amount)}</div>
        <div class="txn-actions">
          <button class="txn-btn edit" data-action="edit-txn" data-id="${t.id}" aria-label="Edit ${t.description}">✎</button>
          <button class="txn-btn del"  data-action="del-txn"  data-id="${t.id}" aria-label="Delete ${t.description}">✕</button>
        </div>
      </div>`;
    }).join('');
  },

  renderBudgets(budgets) {
    const grid    = document.getElementById('budgetGrid');
    const summary = document.getElementById('budgetSummary');
    if (!grid) return;
    const totalLimit = budgets.reduce((s,b) => s + b.monthly_limit, 0);
    const totalSpent = budgets.reduce((s,b) => s + b.spent, 0);
    const overBudget = budgets.filter(b => b.percent >= 100).length;
    if (summary) summary.innerHTML = `
      <div class="bs-card"><div class="bs-label">Total Budget</div><div class="bs-val">${fmt(totalLimit)}</div></div>
      <div class="bs-card"><div class="bs-label">Total Spent</div><div class="bs-val" style="color:var(--expense)">${fmt(totalSpent)}</div></div>
      <div class="bs-card"><div class="bs-label">Over Budget</div><div class="bs-val" style="color:${overBudget>0?'var(--expense)':'var(--income)'}">${overBudget} categor${overBudget===1?'y':'ies'}</div></div>`;
    if (!budgets.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No budgets yet. Set one to start tracking!</div>'; return; }
    grid.innerHTML = budgets.map(b => {
      const color     = b.percent >= 100 ? 'var(--expense)' : b.percent >= 80 ? 'var(--warning)' : 'var(--income)';
      const barBg     = b.percent >= 100 ? 'var(--expense)' : b.percent >= 80 ? 'var(--warning)'  : 'var(--income)';
      const remaining = b.monthly_limit - b.spent;
      return `<div class="budget-card">
        <div class="budget-header">
          <div class="budget-cat-wrap">
            <div class="budget-cat-dot" style="background:${CAT_COLORS[b.category]||'#94A3B8'}"></div>
            <div class="budget-cat">${CAT_EMOJIS[b.category]||''} ${b.category}</div>
          </div>
          <button class="budget-delete" data-action="del-budget" data-id="${b.id}">✕</button>
        </div>
        <div class="budget-amounts">
          <span>Spent: <span>${fmt(b.spent)}</span></span>
          <span>Limit: <span>${fmt(b.monthly_limit)}</span></span>
        </div>
        <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${b.percent}%;background:${barBg}"></div></div>
        <div class="budget-footer">
          <div class="budget-percent" style="color:${color}">${b.percent}%</div>
          <div class="budget-remaining" style="color:${remaining>=0?'var(--income)':'var(--expense)'}">${remaining>=0?fmt(remaining)+' left':fmt(Math.abs(remaining))+' over'}</div>
        </div>
      </div>`;
    }).join('');
  },

  renderTopCats(cats) {
    const el = document.getElementById('topCats');
    if (!el) return;
    const max = cats[0]?.total || 1;
    el.innerHTML = cats.slice(0,5).map(c => `
      <div class="top-cat-row">
        <div class="tc-dot" style="background:${CAT_COLORS[c.category]||'#A79C8C'}"></div>
        <div class="tc-name">${CAT_EMOJIS[c.category]||''} ${c.category}</div>
        <div class="tc-bar-bg"><div class="tc-bar-fill" style="width:${Math.round(c.total/max*100)}%;background:${CAT_COLORS[c.category]||'#A79C8C'}"></div></div>
        <div class="tc-amount">${fmt(c.total)}</div>
      </div>`).join('') || '<div class="empty-state">No data yet.</div>';
  },

  renderCatBreakdown(cats) {
    const el = document.getElementById('catBreakdown');
    if (!el) return;
    const max = cats[0]?.total || 1;
    el.innerHTML = cats.slice(0,8).map(c => `
      <div class="cat-row">
        <div class="cat-dot" style="background:${CAT_COLORS[c.category]||'#A79C8C'}"></div>
        <div class="cat-name">${CAT_EMOJIS[c.category]||''} ${c.category}</div>
        <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${Math.round(c.total/max*100)}%;background:${CAT_COLORS[c.category]||'#A79C8C'}"></div></div>
        <div class="cat-amount">${fmt(c.total)}</div>
      </div>`).join('') || '<div class="empty-state">No expense data yet.</div>';
  },

  renderTopDays(txns) {
    const el = document.getElementById('topDays');
    if (!el) return;
    const dayMap = {};
    txns.filter(t => t.type==='expense').forEach(t => {
      const dateStr = t.date ? (typeof t.date === 'string' ? t.date.slice(0,10) : new Date(t.date).toISOString().slice(0,10)) : '';
      if (dateStr) dayMap[dateStr] = (dayMap[dateStr]||0) + parseFloat(t.amount);
    });
    const sorted = Object.entries(dayMap).sort((a,b) => b[1]-a[1]).slice(0,7);
    const max = sorted[0]?.[1] || 1;
    el.innerHTML = sorted.map(([date,total]) => `
      <div class="cat-row">
        <div class="cat-name" style="font-family:'JetBrains Mono',monospace;font-size:12px">${date}</div>
        <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${Math.round(total/max*100)}%;background:var(--expense)"></div></div>
        <div class="cat-amount">${fmt(total)}</div>
      </div>`).join('') || '<div class="empty-state">No data yet.</div>';
  },

  renderGoals(goals) {
    const el = document.getElementById('goalsGrid');
    if (!el) return;
    if (!goals.length) { el.innerHTML = '<div class="empty-state">No goals yet. Add one to start tracking!</div>'; return; }
    const emojis = ['🏠','✈️','🎓','💻','🚗','💍','🏋️','🌍','🏆','💰'];
    el.innerHTML = goals.map((g,i) => {
      const pct       = Math.min(Math.round((g.saved / g.target) * 100), 100);
      const remaining = g.target - g.saved;
      const barColor  = pct >= 100 ? 'var(--income)' : pct >= 75 ? 'var(--brand)' : pct >= 40 ? 'var(--warning)' : 'var(--savings)';
      return `<div class="goal-card">
        <div style="font-size:26px;margin-bottom:10px">${emojis[i % emojis.length]}</div>
        <div class="goal-header">
          <div>
            <div class="goal-name">${g.name}</div>
            <div class="goal-date">${g.date ? 'Target: '+g.date : 'No deadline'}</div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="txn-btn edit" data-action="edit-goal" data-id="${g.id}" title="Edit">✎</button>
            <button class="goal-delete"  data-action="del-goal"  data-id="${g.id}">✕</button>
          </div>
        </div>
        <div class="goal-amounts">
          <span>Saved: <strong>${fmt(g.saved)}</strong></span>
          <span>Goal: <strong>${fmt(g.target)}</strong></span>
        </div>
        <div class="goal-bar-bg"><div class="goal-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <div class="goal-percent" style="color:${barColor}">${pct}% complete</div>
          <div style="font-size:12px;color:var(--text-tertiary)">${remaining > 0 ? fmt(remaining)+' to go' : '🎉 Goal reached!'}</div>
        </div>
        <button class="tip-btn" style="margin-top:12px" data-action="add-savings" data-id="${g.id}">+ Add Savings</button>
      </div>`;
    }).join('');
  }
};