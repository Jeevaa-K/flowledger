const Groups = {
  activeGroupId: null,
  activeGroupData: null,

  async init() {
    this.bindEvents();
    await this.loadGroups();
  },

  bindEvents() {
    const on = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    on('openCreateGroupBtn', 'click', () => this.openGroupModal());
    on('closeGroupModal',    'click', () => this.closeGroupModal());
    on('saveGroupBtn',       'click', () => this.saveGroup());
    on('groupModal',         'click', e => { if (e.target.id === 'groupModal') this.closeGroupModal(); });

    on('backToGroupsBtn',    'click', () => this.showListView());
    on('openGroupExpenseModalBtn', 'click', () => this.openExpenseModal());
    on('closeGroupExpenseModal',    'click', () => this.closeExpenseModal());
    on('saveGroupExpenseBtn',       'click', () => this.saveExpense());
    on('groupExpenseModal',         'click', e => { if (e.target.id === 'groupExpenseModal') this.closeExpenseModal(); });

    on('openSettleModalBtn',  'click', () => this.openSettleModal());
    on('closeSettleModal',     'click', () => this.closeSettleModal());
    on('saveSettleBtn',        'click', () => this.saveSettle());
    on('settleModal',          'click', e => { if (e.target.id === 'settleModal') this.closeSettleModal(); });

    on('deleteCurrentGroupBtn', 'click', () => this.deleteCurrentGroup());

    // Event delegation for dynamic actions (avoids inline onclick attributes blocked by CSP)
    document.addEventListener('click', e => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const id = parseInt(target.dataset.id);

      if (action === 'open-create-group') {
        this.openGroupModal();
      } else if (action === 'open-group') {
        if (id) this.openGroupDetail(id);
      } else if (action === 'delete-group-expense') {
        if (id) this.deleteExpense(id);
      }
    });
  },

  async loadGroups() {
    try {
      const groups = await API.getGroups();
      this.renderGroupsList(groups);
    } catch (e) {
      console.error('Load groups error:', e);
      UI.toast('⚠ Could not load groups', 'error');
    }
  },

  renderGroupsList(groups) {
    const grid = document.getElementById('groupsGrid');
    if (!grid) return;

    if (!groups || !groups.length) {
      grid.innerHTML = `
        <div class="card" style="text-align:center;padding:40px 20px;grid-column:1/-1">
          <div style="font-size:36px;margin-bottom:12px">👥</div>
          <div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">No Groups Created Yet</div>
          <div style="font-size:13px;color:var(--ink-soft);max-width:340px;margin:0 auto 20px">
            Create a shared group for your trip, house rent, or dinner party to track who paid what and settle up instantly.
          </div>
          <button class="btn-primary" data-action="open-create-group">+ Create Your First Group</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = groups.map(g => `
      <div class="card group-card" style="cursor:pointer;transition:transform 0.15s" data-action="open-group" data-id="${g.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:17px;font-weight:700;color:var(--ink)">${g.name}</div>
            <div style="font-size:12px;color:var(--ink-soft);margin-top:2px">${g.description || 'Shared Expense Ledger'}</div>
          </div>
          <span class="res-badge">👥 ${g.member_count} Members</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--border-soft)">
          <span style="font-size:12px;color:var(--ink-soft)">Total Spent:</span>
          <strong style="font-size:15px;color:var(--ink)">${fmt(g.total_expenses || 0)}</strong>
        </div>
      </div>
    `).join('');
  },

  openGroupModal() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('groupNameInput', '');
    set('groupDescInput', '');
    set('groupMembersInput', '');
    document.getElementById('groupModal')?.classList.add('open');
    setTimeout(() => document.getElementById('groupNameInput')?.focus(), 100);
  },

  closeGroupModal() {
    document.getElementById('groupModal')?.classList.remove('open');
  },

  async saveGroup() {
    const name = document.getElementById('groupNameInput')?.value?.trim();
    const desc = document.getElementById('groupDescInput')?.value?.trim();
    const rawMembers = document.getElementById('groupMembersInput')?.value || '';

    if (!name) { UI.toast('⚠ Enter a group name', 'error'); return; }
    const members = rawMembers.split(',').map(m => m.trim()).filter(Boolean);

    const btn = document.getElementById('saveGroupBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

    try {
      const res = await API.createGroup({ name, description: desc, members });
      if (res && res.group) {
        UI.toast('✓ Group created!', 'success');
        this.closeGroupModal();
        await this.loadGroups();
        this.openGroupDetail(res.group.id);
      }
    } catch (e) {
      UI.toast('⚠ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Group'; }
    }
  },

  async openGroupDetail(groupId) {
    this.activeGroupId = groupId;
    document.getElementById('groupsListView').style.display = 'none';
    document.getElementById('groupDetailView').style.display = 'block';

    try {
      const data = await API.getGroupDetails(groupId);
      this.activeGroupData = data;
      this.renderGroupDetail(data);
    } catch (e) {
      UI.toast('⚠ Could not load group details', 'error');
      this.showListView();
    }
  },

  showListView() {
    this.activeGroupId = null;
    this.activeGroupData = null;
    document.getElementById('groupDetailView').style.display = 'none';
    document.getElementById('groupsListView').style.display = 'block';
    this.loadGroups();
  },

  renderGroupDetail(data) {
    const { group, members, expenses, balances, settlements } = data;

    document.getElementById('gdTitle').textContent = group.name;
    document.getElementById('gdMembersList').textContent = 'Members: ' + members.map(m => m.name).join(', ');

    // Render Settlement Grid
    const setGrid = document.getElementById('settlementGrid');
    if (setGrid) {
      if (!settlements.length && (!expenses.length || balances.every(b => Math.abs(b.net) < 0.01))) {
        setGrid.innerHTML = `
          <div style="font-size:13px;color:var(--forest);font-weight:600;padding:10px 0">
            🎉 Everyone is all settled up! No pending balances.
          </div>
        `;
      } else {
        setGrid.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
            ${settlements.map(s => `
              <div class="ai-stats-card" style="margin:0">
                <div style="font-size:13px;font-weight:600;color:var(--ink)">
                  🔴 <strong style="color:var(--brick)">${s.from_name}</strong> owes <strong style="color:var(--forest)">${s.to_name}</strong>
                </div>
                <div style="font-size:18px;font-weight:700;color:var(--clay);margin-top:4px">
                  ${fmt(s.amount)}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    // Render Expense List Stream
    const list = document.getElementById('groupExpenseList');
    if (list) {
      if (!expenses.length) {
        list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink-soft);font-size:13px">No expenses logged in this group yet. Click "+ Add Expense" to start splitting!</div>`;
        return;
      }

      list.innerHTML = expenses.map(e => {
        const isSettle = e.is_settlement;
        const splitsSummary = e.splits.map(s => `${s.member_name}: ${fmt(s.split_amount)}`).join(', ');

        return `
          <div class="txn-item" style="padding:12px 14px">
            <div class="txn-icon" style="background:${isSettle ? 'var(--forest-tint)' : 'var(--clay-tint)'};color:${isSettle ? 'var(--forest)' : 'var(--clay-dark)'}">
              ${isSettle ? '🤝' : '💸'}
            </div>
            <div class="txn-info" style="flex:1">
              <div class="txn-desc" style="font-weight:600">${e.description}</div>
              <div class="txn-meta" style="font-size:12px;color:var(--ink-soft)">
                <span>Paid by <strong>${e.payer_name}</strong></span> • <span>${e.date}</span>
                <div style="font-size:11px;color:var(--ink-faint);margin-top:2px">Splits: ${splitsSummary}</div>
              </div>
            </div>
            <div style="text-align:right">
              <div class="txn-amount ${isSettle ? 'green' : 'red'}" style="font-weight:700">${fmt(e.amount)}</div>
              <button class="goal-delete" style="margin-top:4px" data-action="delete-group-expense" data-id="${e.id}" title="Delete expense">🗑</button>
            </div>
          </div>
        `;
      }).join('');
    }
  },

  openExpenseModal() {
    if (!this.activeGroupData) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('gExpDesc', '');
    set('gExpAmount', '');
    set('gExpDate', new Date().toISOString().slice(0, 10));

    const pSel = document.getElementById('gExpPayerSelect');
    if (pSel) {
      pSel.innerHTML = this.activeGroupData.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    }

    document.getElementById('groupExpenseModal')?.classList.add('open');
    setTimeout(() => document.getElementById('gExpDesc')?.focus(), 100);
  },

  closeExpenseModal() {
    document.getElementById('groupExpenseModal')?.classList.remove('open');
  },

  async saveExpense() {
    const desc = document.getElementById('gExpDesc')?.value?.trim();
    const amount = parseFloat(document.getElementById('gExpAmount')?.value) || 0;
    const payer_id = document.getElementById('gExpPayerSelect')?.value;
    const category = document.getElementById('gExpCategory')?.value || 'Other';
    const date = document.getElementById('gExpDate')?.value;

    if (!desc || amount <= 0 || !payer_id) {
      UI.toast('⚠ Enter description, positive amount, and payer', 'error');
      return;
    }

    const btn = document.getElementById('saveGroupExpenseBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
      await API.addGroupExpense(this.activeGroupId, { description: desc, amount, payer_id, category, date });
      UI.toast('✓ Shared expense added!', 'success');
      this.closeExpenseModal();
      await this.openGroupDetail(this.activeGroupId);
    } catch (e) {
      UI.toast('⚠ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Shared Expense'; }
    }
  },

  openSettleModal() {
    if (!this.activeGroupData) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('settleAmount', '');

    const fromSel = document.getElementById('settleFromSelect');
    const toSel   = document.getElementById('settleToSelect');
    const members = this.activeGroupData.members;

    if (fromSel) fromSel.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    if (toSel)   toSel.innerHTML   = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Pre-select first settlement debtor/creditor if present
    if (this.activeGroupData.settlements && this.activeGroupData.settlements.length) {
      const s = this.activeGroupData.settlements[0];
      if (fromSel) fromSel.value = s.from_id;
      if (toSel)   toSel.value   = s.to_id;
      set('settleAmount', s.amount);
    }

    document.getElementById('settleModal')?.classList.add('open');
  },

  closeSettleModal() {
    document.getElementById('settleModal')?.classList.remove('open');
  },

  async saveSettle() {
    const from_id = document.getElementById('settleFromSelect')?.value;
    const to_id   = document.getElementById('settleToSelect')?.value;
    const amount  = parseFloat(document.getElementById('settleAmount')?.value) || 0;

    if (!from_id || !to_id || amount <= 0) {
      UI.toast('⚠ Enter valid payer, recipient, and positive amount', 'error');
      return;
    }
    if (from_id === to_id) {
      UI.toast('⚠ Payer and recipient must be different members', 'error');
      return;
    }

    const btn = document.getElementById('saveSettleBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
      await API.settleGroup(this.activeGroupId, { from_id, to_id, amount });
      UI.toast('✓ Settlement recorded!', 'success');
      this.closeSettleModal();
      await this.openGroupDetail(this.activeGroupId);
    } catch (e) {
      UI.toast('⚠ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Record Settlement'; }
    }
  },

  async deleteExpense(expenseId) {
    if (!confirm('Are you sure you want to delete this group expense?')) return;
    try {
      await API.deleteGroupExpense(this.activeGroupId, expenseId);
      UI.toast('✓ Expense deleted', 'success');
      await this.openGroupDetail(this.activeGroupId);
    } catch (e) {
      UI.toast('⚠ ' + e.message, 'error');
    }
  },

  async deleteCurrentGroup() {
    if (!this.activeGroupId) return;
    if (!confirm(`Are you sure you want to delete "${this.activeGroupData?.group?.name}"? All group expenses and split records will be permanently removed.`)) return;

    try {
      await API.deleteGroup(this.activeGroupId);
      UI.toast('✓ Group deleted', 'success');
      this.showListView();
    } catch (e) {
      UI.toast('⚠ ' + e.message, 'error');
    }
  }
};
