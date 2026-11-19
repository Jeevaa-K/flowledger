export const Notifications = {
  items: [],
  budgetItems: [],
  recurringItems: [],
  cashflowItems: [],
  burnRateItems: [],
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
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      level: r.diffDays <= 1 ? 'danger' : 'warning',
      title: `Upcoming Renewal: ${r.description}`,
      sub: `${r.diffDays === 0 ? 'Due today' : r.diffDays === 1 ? 'Due tomorrow' : 'Renews in ' + r.diffDays + ' days'} · ${fmt(r.amount)}`,
      key: `rec_${r.id}_${r.next_date}`,
      action: 'goto-recurring'
    }));
    this.recompute();
  },

  setCashflowAlert(alerts) {
    this.cashflowItems = (alerts || []).map(a => ({ ...a, key: a.title, action: 'goto-dashboard' }));
    this.recompute();
  },

  setBurnRateAlert(alerts) {
    this.burnRateItems = (alerts || []).map(a => ({ ...a, key: a.title, action: 'goto-dashboard' }));
    this.recompute();
  },

  recompute() {
    this.items = [...this.budgetItems, ...this.recurringItems, ...this.cashflowItems, ...this.burnRateItems];
    const activeKeys = new Set(this.items.map(i => i.key));
    this.clearedKeys = new Set([...this.clearedKeys].filter(k => activeKeys.has(k)));
    this.persist();
    this.render();
  },

  render() {
    const visible = this.items.filter(i => !this.clearedKeys.has(i.key));
    const list = document.getElementById('notifList');
    const dot = document.getElementById('notifDot');
    if (dot) dot.style.display = visible.length ? 'block' : 'none';
    if (!list) return;

    if (!visible.length) {
      list.innerHTML = `<div class="notif-empty">You're all caught up</div>`;
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

if (typeof window !== 'undefined') {
  window.Notifications = Notifications;
}

export default Notifications;
