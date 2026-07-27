const Recurring = {
  async load() {
    try {
      const items = await API.get('/recurring');
      this.render(items);
    } catch(e) { UI.toast('Error loading recurring transactions', 'error'); }
  },

  render(items) {
    const el = document.getElementById('recurringList');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<div class="empty-state">No recurring transactions. Add one to auto-track regular payments!</div>';
      return;
    }
    const freqLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', yearly:'Yearly' };
    el.innerHTML = items.map(r => `
      <div class="recurring-item ${r.active ? '' : 'inactive'}">
        <div class="rec-dot" style="background:${CAT_COLORS[r.category]||'#94a3b8'}"></div>
        <div class="rec-info">
          <div class="rec-name">${r.description}</div>
          <div class="rec-meta">${freqLabel[r.frequency]||r.frequency} · Next: ${r.next_date} · ${r.category}</div>
        </div>
        <div class="rec-amount ${r.type==='income'?'inc':'exp'}">${r.type==='income'?'+':'-'}${fmt(r.amount)}</div>
        <div class="rec-actions">
          <button class="txn-btn" data-action="toggle-recurring" data-id="${r.id}" data-active="${r.active}" title="${r.active?'Pause':'Resume'}">${r.active?'⏸':'▶'}</button>
          <button class="txn-btn del" data-action="del-recurring" data-id="${r.id}">✕</button>
        </div>
      </div>`).join('');
  },

  async save() {
    const description = document.getElementById('recDesc').value.trim();
    const amount      = parseFloat(document.getElementById('recAmount').value);
    const type        = document.getElementById('recType').value;
    const category    = document.getElementById('recCategory').value;
    const frequency   = document.getElementById('recFrequency').value;
    const next_date   = document.getElementById('recNextDate').value;

    if (!description || !amount || !next_date) { UI.toast('⚠ Fill in all fields', 'error'); return; }

    try {
      await API.post('/recurring', { description, amount, type, category, frequency, next_date });
      UI.toast('✓ Recurring transaction added', 'success');
      document.getElementById('recurringModal').classList.remove('open');
      this.load();
    } catch(e) { UI.toast('Error: ' + e.message, 'error'); }
  },

  async toggle(id, currentActive) {
    try {
      const item = (await API.get('/recurring')).find(r => r.id === id);
      if (!item) return;
      await API.put(`/recurring/${id}`, { ...item, active: currentActive ? 0 : 1 });
      UI.toast(currentActive ? '⏸ Paused' : '▶ Resumed', 'success');
      this.load();
    } catch(e) { UI.toast('Error toggling', 'error'); }
  },

  async delete(id) {
    if (!confirm('Delete this recurring transaction?')) return;
    try {
      await API.del(`/recurring/${id}`);
      UI.toast('✓ Deleted', 'success');
      this.load();
    } catch(e) { UI.toast('Error deleting', 'error'); }
  }
};
