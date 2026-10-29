const Groups = {
  activeGroupId: null,
  activeGroupData: null,
  activeQrSettlement: null,
  qrCodeInstance: null,

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

    // Scan & Pay QR Modal
    on('closeSettleQrModal',   'click', () => this.closeSettleQrModal());
    on('settleQrModal',        'click', e => { if (e.target.id === 'settleQrModal') this.closeSettleQrModal(); });
    on('qrMarkSettledBtn',     'click', () => this.confirmQrSettled());

    // Live update when recipient UPI ID is edited
    const upiInput = document.getElementById('qrUpiInput');
    let upiTimer = null;
    upiInput?.addEventListener('input', () => {
      clearTimeout(upiTimer);
      upiTimer = setTimeout(() => {
        if (!this.activeQrSettlement) return;
        const newUpi = upiInput.value.trim();
        if (newUpi) {
          localStorage.setItem('fl_upi_' + this.activeQrSettlement.toId, newUpi);
          const status = document.getElementById('upiSaveStatus');
          if (status) {
            status.textContent = 'Saved ✓';
            setTimeout(() => { if (status) status.textContent = 'Auto-saved'; }, 2000);
          }
          this.generateQr(newUpi, this.activeQrSettlement.toName, this.activeQrSettlement.amount);
        }
      }, 300);
    });

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
      } else if (action === 'open-settle-qr') {
        const fromId = parseInt(target.dataset.fromId);
        const toId = parseInt(target.dataset.toId);
        const fromName = target.dataset.fromName;
        const toName = target.dataset.toName;
        const amount = parseFloat(target.dataset.amount);
        this.openSettleQr(fromId, toId, fromName, toName, amount);
      } else if (action === 'open-settle-form') {
        const fromId = parseInt(target.dataset.fromId);
        const toId = parseInt(target.dataset.toId);
        const amount = parseFloat(target.dataset.amount);
        this.openSettleModal(fromId, toId, amount);
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
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px">No Groups Created Yet</div>
          <div style="font-size:13px;color:var(--text-secondary);max-width:340px;margin:0 auto 20px">
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
            <div style="font-size:17px;font-weight:700;color:var(--text-primary)">${g.name}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${g.description || 'Shared Expense Ledger'}</div>
          </div>
          <span class="res-badge">👥 ${g.member_count} Members</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--border-soft)">
          <span style="font-size:12px;color:var(--text-secondary)">Total Spent:</span>
          <strong style="font-size:15px;color:var(--text-primary)">${fmt(g.total_expenses || 0)}</strong>
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

    // Render Settlement Grid with Instant Scan & Pay buttons
    const setGrid = document.getElementById('settlementGrid');
    if (setGrid) {
      if (!settlements.length && (!expenses.length || balances.every(b => Math.abs(b.net) < 0.01))) {
        setGrid.innerHTML = `
          <div style="font-size:13px;color:var(--income);font-weight:600;padding:12px 0">
            🎉 Everyone is all settled up! No pending balances.
          </div>
        `;
      } else {
        setGrid.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
            ${settlements.map(s => `
              <div class="settlement-card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary)">
                    🔴 <strong style="color:var(--expense)">${s.from_name}</strong> owes <strong style="color:var(--income)">${s.to_name}</strong>
                  </div>
                </div>
                <div style="font-size:22px;font-weight:800;color:var(--text-primary)">
                  ${fmt(s.amount)}
                </div>
                <div class="settlement-actions-row">
                  <button class="settle-action-btn pay-qr-btn" data-action="open-settle-qr"
                    data-from-id="${s.from_id}"
                    data-to-id="${s.to_id}"
                    data-from-name="${s.from_name}"
                    data-to-name="${s.to_name}"
                    data-amount="${s.amount}"
                    title="Generate instant UPI payment QR code">
                    <span>📱</span> Scan to Pay
                  </button>
                  <button class="settle-action-btn" data-action="open-settle-form"
                    data-from-id="${s.from_id}"
                    data-to-id="${s.to_id}"
                    data-amount="${s.amount}"
                    title="Record a payment settlement">
                    <span>🤝</span> Settle Up
                  </button>
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
        list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-tertiary);font-size:13px">No expenses logged in this group yet. Click "+ Add Expense" to start splitting!</div>`;
        return;
      }

      list.innerHTML = expenses.map(e => {
        const isSettle = e.is_settlement;
        const splitsSummary = e.splits.map(s => `${s.member_name}: ${fmt(s.split_amount)}`).join(', ');

        return `
          <div class="txn-item" style="padding:12px 14px">
            <div class="txn-icon" style="background:${isSettle ? 'var(--income-tint)' : 'var(--brand-tint)'};color:${isSettle ? 'var(--income)' : 'var(--brand)'}">
              ${isSettle ? '🤝' : '💸'}
            </div>
            <div class="txn-info" style="flex:1">
              <div class="txn-desc" style="font-weight:600">${e.description}</div>
              <div class="txn-meta" style="font-size:12px;color:var(--text-secondary)">
                <span>Paid by <strong>${e.payer_name}</strong></span> • <span>${e.date}</span>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Splits: ${splitsSummary}</div>
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

  openSettleQr(fromId, toId, fromName, toName, amount) {
    this.activeQrSettlement = { fromId, toId, fromName, toName, amount };

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('qrFromMember', fromName);
    set('qrToMember', toName);
    set('qrAmountDisplay', fmt(amount));
    set('qrGroupNote', `Settlement for ${this.activeGroupData?.group?.name || 'Group Expense'}`);

    const defaultUpi = `${toName.toLowerCase().replace(/[^a-z0-9]/g, '')}@upi`;
    const savedUpi = localStorage.getItem('fl_upi_' + toId) || defaultUpi;

    const upiInput = document.getElementById('qrUpiInput');
    if (upiInput) upiInput.value = savedUpi;

    this.generateQr(savedUpi, toName, amount);
    document.getElementById('settleQrModal')?.classList.add('open');
  },

  generateQr(upiId, toName, amount) {
    const container = document.getElementById('settleQrCodeContainer');
    if (!container) return;

    container.innerHTML = '';
    const note = `FlowLedger - ${this.activeGroupData?.group?.name || 'Settlement'}`;
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(toName)}&am=${parseFloat(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

    if (typeof QRCode !== 'undefined') {
      try {
        this.qrCodeInstance = new QRCode(container, {
          text: upiUri,
          width: 190,
          height: 190,
          colorDark: '#0F172A',
          colorLight: '#FFFFFF',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.error('QR code generation error:', e);
        container.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary);padding:20px">Error rendering QR</div>`;
      }
    }

    const deepLink = document.getElementById('qrDeepLinkBtn');
    if (deepLink) deepLink.setAttribute('href', upiUri);
  },

  closeSettleQrModal() {
    document.getElementById('settleQrModal')?.classList.remove('open');
    this.activeQrSettlement = null;
  },

  async confirmQrSettled() {
    if (!this.activeQrSettlement || !this.activeGroupId) return;

    const { fromId, toId, amount } = this.activeQrSettlement;
    const btn = document.getElementById('qrMarkSettledBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Recording...'; }

    try {
      await API.settleGroup(this.activeGroupId, { from_id: fromId, to_id: toId, amount });
      UI.toast(`✓ Settlement of ${fmt(amount)} recorded!`, 'success');
      this.closeSettleQrModal();
      await this.openGroupDetail(this.activeGroupId);
    } catch (e) {
      UI.toast('⚠ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>✓</span> Mark as Settled'; }
    }
  },

  openExpenseModal() {
    if (!this.activeGroupData) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('gExpDesc', '');
    set('gExpAmount', '');
    set('gExpDate', new Date().toISOString().slice(0, 10));

    const payerSel = document.getElementById('gExpPayerSelect');
    if (payerSel && this.activeGroupData.members) {
      payerSel.innerHTML = this.activeGroupData.members.map(m =>
        `<option value="${m.id}">${m.name}</option>`
      ).join('');
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

    if (!desc) { UI.toast('⚠ Enter an expense description', 'error'); return; }
    if (!amount || amount <= 0) { UI.toast('⚠ Enter a valid amount greater than 0', 'error'); return; }
    if (!payer_id) { UI.toast('⚠ Select who paid for this expense', 'error'); return; }

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

  openSettleModal(prefillFromId = null, prefillToId = null, prefillAmount = null) {
    if (!this.activeGroupData) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('settleAmount', '');

    const fromSel = document.getElementById('settleFromSelect');
    const toSel   = document.getElementById('settleToSelect');
    const members = this.activeGroupData.members;

    if (fromSel) fromSel.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    if (toSel)   toSel.innerHTML   = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Pre-select debtor/creditor if arguments provided or from first settlement
    if (prefillFromId && prefillToId && prefillAmount) {
      if (fromSel) fromSel.value = prefillFromId;
      if (toSel)   toSel.value   = prefillToId;
      set('settleAmount', prefillAmount);
    } else if (this.activeGroupData.settlements && this.activeGroupData.settlements.length) {
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
