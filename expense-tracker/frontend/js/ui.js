const fmt = n => '₹' + Math.abs(n).toLocaleString('en-IN', {minimumFractionDigits:0, maximumFractionDigits:0});

const UI = {
  currentType: 'income',
  editId: null,

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
    const current = selected || (type==='income' ? 'Salary' : 'Food');
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
    this.editId = txn ? txn.id : null;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const title = document.getElementById('modalTitle');
    if (title) title.textContent = txn ? 'Edit Transaction' : 'Add Transaction';
    set('txnDesc',   txn ? txn.description : '');
    set('txnAmount', txn ? txn.amount : '');
    set('txnDate',   txn ? txn.date : new Date().toISOString().slice(0,10));
    this.setType(txn ? txn.type : 'income');
    this.buildCatPicker(txn ? txn.type : 'income', txn ? txn.category : null);
    document.getElementById('addModal')?.classList.add('open');
    setTimeout(() => document.getElementById('txnDesc')?.focus(), 100);
  },

  closeAddModal() {
    document.getElementById('addModal')?.classList.remove('open');
    this.editId = null;
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
      balEl.style.color = balance >= 0 ? 'white' : '#E8B4A5';
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
      const color = CAT_COLORS[t.category] || '#A79C8C';
      return `<div class="txn-item">
        <div class="txn-name-wrap">
          <div class="txn-dot" style="background:${color}"></div>
          <div class="txn-meta-col">
            <div class="txn-name">${t.description}</div>
            <div class="txn-date">${t.category} · ${t.date}</div>
          </div>
        </div>
        <div class="txn-cat-badge">${CAT_EMOJIS[t.category]||''} ${t.category}</div>
        <div class="txn-date-col">${t.date}</div>
        <div class="txn-amount ${t.type==='income'?'inc':'exp'}">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
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
      <div class="bs-card"><div class="bs-label">Total Spent</div><div class="bs-val" style="color:#A6402F">${fmt(totalSpent)}</div></div>
      <div class="bs-card"><div class="bs-label">Over Budget</div><div class="bs-val" style="color:${overBudget>0?'#A6402F':'#3E6154'}">${overBudget} categor${overBudget===1?'y':'ies'}</div></div>`;
    if (!budgets.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No budgets yet. Set one to start tracking!</div>'; return; }
    grid.innerHTML = budgets.map(b => {
      const color     = b.percent >= 100 ? '#A6402F' : b.percent >= 80 ? '#B8862F' : '#3E6154';
      const remaining = b.monthly_limit - b.spent;
      return `<div class="budget-card">
        <div class="budget-header">
          <div class="budget-cat-wrap">
            <div class="budget-cat-dot" style="background:${CAT_COLORS[b.category]||'#A79C8C'}"></div>
            <div class="budget-cat">${CAT_EMOJIS[b.category]||''} ${b.category}</div>
          </div>
          <button class="budget-delete" data-action="del-budget" data-id="${b.id}">✕</button>
        </div>
        <div class="budget-amounts">
          <span>Spent: <span>${fmt(b.spent)}</span></span>
          <span>Limit: <span>${fmt(b.monthly_limit)}</span></span>
        </div>
        <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${b.percent}%;background:${color}"></div></div>
        <div class="budget-footer">
          <div class="budget-percent" style="color:${color}">${b.percent}%</div>
          <div class="budget-remaining" style="color:${remaining>=0?'#3E6154':'#A6402F'}">${remaining>=0?fmt(remaining)+' left':fmt(Math.abs(remaining))+' over'}</div>
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
        <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${Math.round(total/max*100)}%;background:#BF5730"></div></div>
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
        <div class="goal-bar-bg"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <div class="goal-percent">${pct}% complete</div>
          <div style="font-size:12px;color:#A79C8C">${remaining > 0 ? fmt(remaining)+' to go' : '🎉 Goal reached!'}</div>
        </div>
        <button class="tip-btn" style="margin-top:12px" data-action="add-savings" data-id="${g.id}">+ Add Savings</button>
      </div>`;
    }).join('');
  }
};