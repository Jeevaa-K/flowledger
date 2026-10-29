const Recurring = {
  items: [],
  filter: 'all',
  detected: [],
  initialized: false,

  SERVICE_ICONS: {
    'netflix':     { icon: '🎬', color: '#E50914' },
    'spotify':     { icon: '🎵', color: '#1DB954' },
    'prime':       { icon: '📦', color: '#00A8E1' },
    'amazon':      { icon: '📦', color: '#FF9900' },
    'youtube':     { icon: '▶️', color: '#FF0000' },
    'hotstar':     { icon: '⭐', color: '#0C111B' },
    'disney':      { icon: '🏰', color: '#113CCF' },
    'apple':       { icon: '🍎', color: '#A2AAAD' },
    'icloud':      { icon: '☁️', color: '#3B82F6' },
    'google':      { icon: '🔍', color: '#4285F4' },
    'gym':         { icon: '💪', color: '#EC4899' },
    'fitness':     { icon: '🏋️', color: '#F97316' },
    'rent':        { icon: '🏠', color: '#6366F1' },
    'wifi':        { icon: '📡', color: '#06B6D4' },
    'broadband':   { icon: '🌐', color: '#0EA5E9' },
    'airtel':      { icon: '📱', color: '#EF4444' },
    'jio':         { icon: '📶', color: '#2563EB' },
    'adobe':       { icon: '🎨', color: '#FF0000' },
    'chatgpt':     { icon: '🤖', color: '#10A37F' },
    'openai':      { icon: '🧠', color: '#10A37F' },
    'github':      { icon: '🐙', color: '#24292F' },
    'swiggy':      { icon: '🍔', color: '#FC8019' },
    'zomato':      { icon: '🍕', color: '#E23744' },
    'electricity': { icon: '⚡', color: '#F59E0B' },
    'water':       { icon: '💧', color: '#3B82F6' },
    'salary':      { icon: '💼', color: '#10B981' }
  },

  getServiceMeta(desc, cat) {
    const text = (desc || '').toLowerCase();
    for (const [key, val] of Object.entries(this.SERVICE_ICONS)) {
      if (text.includes(key)) return val;
    }
    return { icon: (typeof CAT_EMOJIS !== 'undefined' && CAT_EMOJIS[cat]) || '💳', color: 'var(--brand)' };
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Filter pills in page-recurring
    document.querySelectorAll('[data-sub-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-sub-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.dataset.subFilter;
        this.renderList();
      });
    });

    // Auto-detect button
    const detectBtn = document.getElementById('detectSubsBtn');
    detectBtn?.addEventListener('click', () => this.detectSubscriptions(true));

    // View detected button from banner
    const viewBtn = document.getElementById('viewDetectedSubsBtn');
    viewBtn?.addEventListener('click', () => {
      const card = document.getElementById('subDetectedCard');
      if (card) {
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Dismiss detected banner
    const dismissBtn = document.getElementById('dismissDetectedSubsBtn');
    dismissBtn?.addEventListener('click', () => {
      const banner = document.getElementById('subDetectBanner');
      if (banner) banner.style.display = 'none';
    });

    // Close detected card
    const closeCardBtn = document.getElementById('closeDetectedCardBtn');
    closeCardBtn?.addEventListener('click', () => {
      const card = document.getElementById('subDetectedCard');
      if (card) card.style.display = 'none';
    });
  },

  async load() {
    this.init();
    try {
      this.items = await API.get('/recurring');
      this.updateKPIs();
      this.renderTimeline();
      this.renderList();
      // Check detected in the background silently
      this.checkDetectedBackground();
    } catch(e) {
      console.error('Error loading subscriptions:', e);
      UI.toast('Error loading subscriptions & recurring', 'error');
    }
  },

  updateKPIs() {
    let monthlyExp = 0;
    let activeCount = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let nextDueItem = null;
    let minDays = Infinity;

    this.items.forEach(r => {
      if (!r.active) return;
      if (r.type === 'expense') {
        activeCount++;
        const amt = parseFloat(r.amount) || 0;
        if (r.frequency === 'daily')        monthlyExp += amt * 30;
        else if (r.frequency === 'weekly')  monthlyExp += amt * 4.33;
        else if (r.frequency === 'monthly') monthlyExp += amt;
        else if (r.frequency === 'yearly')  monthlyExp += amt / 12;

        if (r.next_date) {
          const due = new Date(r.next_date);
          due.setHours(0, 0, 0, 0);
          const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays < minDays) {
            minDays = diffDays;
            nextDueItem = { ...r, diffDays };
          }
        }
      }
    });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('subMonthlyTotal', fmt(Math.round(monthlyExp)));
    set('subYearlyTotal',  fmt(Math.round(monthlyExp * 12)));
    set('subActiveCountTag', `${activeCount} Active`);

    if (nextDueItem) {
      set('subNextService', nextDueItem.description);
      const countdownTag = nextDueItem.diffDays === 0
        ? '🚨 Due Today'
        : nextDueItem.diffDays === 1
        ? '⚠️ Tomorrow'
        : `In ${nextDueItem.diffDays} days`;
      set('subNextCountdown', countdownTag);
      set('subNextDetail', `${fmt(nextDueItem.amount)} · ${nextDueItem.next_date}`);
    } else {
      set('subNextService', 'None due soon');
      set('subNextCountdown', 'No renewals');
      set('subNextDetail', 'Next Due Renewal');
    }
  },

  renderTimeline() {
    const strip = document.getElementById('subRenewalsStrip');
    if (!strip) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = this.items
      .filter(r => r.active && r.type === 'expense' && r.next_date)
      .map(r => {
        const due = new Date(r.next_date);
        due.setHours(0, 0, 0, 0);
        const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
        return { ...r, diffDays };
      })
      .filter(r => r.diffDays >= 0)
      .sort((a, b) => a.diffDays - b.diffDays)
      .slice(0, 8);

    if (!upcoming.length) {
      strip.innerHTML = '<div class="sub-empty-hint">No active subscriptions due in upcoming weeks 🎉</div>';
      return;
    }

    // Feed alerts for renewals within 3 days into notification dropdown
    const imminent = upcoming.filter(r => r.diffDays <= 3);
    if (imminent.length && typeof Notifications !== 'undefined' && Notifications.setRecurringAlerts) {
      Notifications.setRecurringAlerts(imminent);
    }

    strip.innerHTML = upcoming.map(r => {
      const meta = this.getServiceMeta(r.description, r.category);
      const isUrgent = r.diffDays <= 1;
      const isSoon   = r.diffDays <= 3;
      const chipClass = isUrgent ? 'chip-urgent' : isSoon ? 'chip-soon' : '';
      const badgeClass = isUrgent ? 'urgent' : isSoon ? 'soon' : 'normal';
      const badgeText = r.diffDays === 0 ? 'Today' : r.diffDays === 1 ? 'Tomorrow' : `In ${r.diffDays}d`;

      return `
        <div class="renewal-chip ${chipClass}">
          <div class="rc-top">
            <div class="rc-logo-group">
              <span class="rc-icon">${meta.icon}</span>
              <span class="rc-name" title="${r.description}">${r.description}</span>
            </div>
            <span class="rc-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="rc-bottom">
            <span class="rc-amt">${fmt(r.amount)}</span>
            <span class="rc-date">${r.next_date}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  renderList() {
    const el = document.getElementById('recurringList');
    if (!el) return;

    let filtered = [...this.items];
    if (this.filter === 'expense') filtered = filtered.filter(r => r.type === 'expense');
    else if (this.filter === 'income') filtered = filtered.filter(r => r.type === 'income');
    else if (this.filter === 'paused') filtered = filtered.filter(r => !r.active);

    if (!filtered.length) {
      el.innerHTML = '<div class="empty-state">No matching subscriptions found. Click "+ Add Subscription" to start tracking!</div>';
      return;
    }

    const freqLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', yearly:'Yearly' };

    el.innerHTML = filtered.map(r => {
      const meta = this.getServiceMeta(r.description, r.category);
      const isPaused = !r.active;

      return `
        <div class="recurring-item ${isPaused ? 'inactive' : ''}">
          <div class="ds-logo" style="margin-right:4px">${meta.icon}</div>
          <div class="rec-info">
            <div class="rec-name" style="display:flex;align-items:center">
              <span>${r.description}</span>
              <span class="sub-status-pill ${r.active ? 'active' : 'paused'}">${r.active ? 'Active' : 'Paused'}</span>
            </div>
            <div class="rec-meta">${freqLabel[r.frequency] || r.frequency} · Next: ${r.next_date} · ${r.category}</div>
          </div>
          <div class="rec-amount ${r.type === 'income' ? 'inc' : 'exp'}">${r.type === 'income' ? '+' : '-'}${fmt(r.amount)}</div>
          <div class="rec-actions">
            <button class="txn-btn" data-action="toggle-recurring" data-id="${r.id}" data-active="${r.active}" title="${r.active ? 'Pause auto-tracking' : 'Resume auto-tracking'}">${r.active ? '⏸' : '▶'}</button>
            <button class="txn-btn del" data-action="del-recurring" data-id="${r.id}" title="Remove subscription">✕</button>
          </div>
        </div>
      `;
    }).join('');
  },

  async checkDetectedBackground() {
    try {
      const candidates = await API.get('/recurring/detect');
      this.detected = candidates || [];
      const banner = document.getElementById('subDetectBanner');
      const viewBtn = document.getElementById('viewDetectedSubsBtn');
      const title = document.getElementById('subDetectTitle');

      if (this.detected.length > 0) {
        if (title) title.textContent = `AI found ${this.detected.length} potential recurring subscription${this.detected.length > 1 ? 's' : ''}`;
        if (viewBtn) viewBtn.textContent = `Review (${this.detected.length})`;
        if (banner) banner.style.display = 'flex';
        this.renderDetectedGrid();
      } else {
        if (banner) banner.style.display = 'none';
      }
    } catch (e) {
      // Non-critical background check
    }
  },

  async detectSubscriptions(manualTrigger = false) {
    const btn = document.getElementById('detectSubsBtn');
    if (btn) { btn.disabled = true; btn.textContent = '✨ Scanning...'; }
    try {
      const candidates = await API.get('/recurring/detect');
      this.detected = candidates || [];

      const card = document.getElementById('subDetectedCard');
      const banner = document.getElementById('subDetectBanner');

      if (!this.detected.length) {
        if (manualTrigger) UI.toast('✓ All subscriptions in your transaction history are already tracked!', 'success');
        if (card) card.style.display = 'none';
        if (banner) banner.style.display = 'none';
        return;
      }

      this.renderDetectedGrid();
      if (card) {
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (manualTrigger) UI.toast(`✨ Found ${this.detected.length} potential subscriptions!`, 'success');
    } catch (e) {
      UI.toast('Could not scan subscriptions: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Auto-Detect'; }
    }
  },

  renderDetectedGrid() {
    const grid = document.getElementById('subDetectedGrid');
    if (!grid) return;

    if (!this.detected.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-tertiary)">No pending subscriptions to review.</div>';
      return;
    }

    grid.innerHTML = this.detected.map((d, idx) => {
      const meta = this.getServiceMeta(d.description, d.category);
      return `
        <div class="detected-sub-item">
          <div class="ds-left">
            <div class="ds-logo">${meta.icon}</div>
            <div class="ds-info">
              <div class="ds-name">${d.description}</div>
              <div class="ds-meta">${d.category} · Next: ${d.next_date}</div>
            </div>
          </div>
          <div class="ds-right">
            <div class="ds-amt">${fmt(d.amount)}</div>
            <button class="ds-btn" onclick="Recurring.addDetected(${idx})">+ Track</button>
          </div>
        </div>
      `;
    }).join('');
  },

  async addDetected(idx) {
    const item = this.detected[idx];
    if (!item) return;

    try {
      await API.post('/recurring', {
        description: item.description,
        amount: item.amount,
        type: item.type || 'expense',
        category: item.category || 'Bills',
        frequency: item.frequency || 'monthly',
        next_date: item.next_date
      });

      UI.toast(`✓ Added ${item.description} to tracked subscriptions`, 'success');
      this.detected.splice(idx, 1);
      this.renderDetectedGrid();

      const banner = document.getElementById('subDetectBanner');
      const viewBtn = document.getElementById('viewDetectedSubsBtn');
      if (this.detected.length === 0) {
        if (banner) banner.style.display = 'none';
        const card = document.getElementById('subDetectedCard');
        if (card) card.style.display = 'none';
      } else {
        if (viewBtn) viewBtn.textContent = `Review (${this.detected.length})`;
      }

      await this.load();
    } catch (e) {
      UI.toast('Error adding subscription: ' + e.message, 'error');
    }
  },

  async save() {
    const descEl = document.getElementById('recDesc');
    const amtEl  = document.getElementById('recAmount');
    const typeEl = document.getElementById('recType');
    const catEl  = document.getElementById('recCategory');
    const freqEl = document.getElementById('recFrequency');
    const dateEl = document.getElementById('recNextDate');
    if (!descEl || !amtEl || !typeEl || !catEl || !freqEl || !dateEl) {
      UI.toast('⚠ Something went wrong loading the form', 'error'); return;
    }

    const description = descEl.value.trim();
    const amount      = parseFloat(amtEl.value);
    const type        = typeEl.value;
    const category    = catEl.value;
    const frequency   = freqEl.value;
    const next_date   = dateEl.value;

    if (!description || !amount || !next_date) { UI.toast('⚠ Fill in all fields', 'error'); return; }
    if (amount <= 0) { UI.toast('⚠ Amount must be greater than 0', 'error'); return; }

    const btn = document.getElementById('saveRecurringBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      await API.post('/recurring', { description, amount, type, category, frequency, next_date });
      UI.toast('✓ Subscription added to tracking', 'success');
      document.getElementById('recurringModal')?.classList.remove('open');
      this.load();
    } catch(e) {
      UI.toast(e.message.match(/^\d+:/) ? 'Error: ' + e.message : e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save Recurring'; }
    }
  },

  async toggle(id, currentActive) {
    try {
      const item = (await API.get('/recurring')).find(r => r.id === id);
      if (!item) return;
      await API.put(`/recurring/${id}`, { ...item, active: currentActive ? 0 : 1 });
      UI.toast(currentActive ? '⏸ Subscription paused' : '▶ Subscription resumed', 'success');
      this.load();
    } catch(e) { UI.toast('Error toggling subscription', 'error'); }
  },

  async delete(id) {
    if (!confirm('Remove this subscription from tracking?')) return;
    try {
      await API.del(`/recurring/${id}`);
      UI.toast('✓ Removed from subscriptions', 'success');
      this.load();
    } catch(e) { UI.toast('Error removing subscription', 'error'); }
  }
};
