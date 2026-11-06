const Recurring = {
  items: [],
  filter: 'all',
  detected: [],
  initialized: false,

  // Calendar State
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(), // 0-indexed (0=Jan, 11=Dec)
  selectedDay: null, // null = All Month, or integer 1..31 for specific day
  activeTab: 'calendar',

  MONTH_NAMES: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],

  SERVICE_ICONS: {
    'netflix':     { icon: '🎬', color: '#E50914' },
    'spotify':     { icon: '🎵', color: '#1DB954' },
    'prime':       { icon: '📦', color: '#00A8E1' },
    'amazon':      { icon: '📦', color: '#FF9900' },
    'youtube':     { icon: '▶️', color: '#FF0000' },
    'hotstar':     { icon: '⭐', color: '#0C111B' },
    'disney':      { icon: '🏰', color: '#113CCF' },
    'apple':       { icon: '🍏', color: '#A2AAAD' },
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

    // View tab switching
    const tabCal = document.getElementById('subTabCalendar');
    const tabList = document.getElementById('subTabList');
    tabCal?.addEventListener('click', () => this.switchTab('calendar'));
    tabList?.addEventListener('click', () => this.switchTab('list'));

    // Calendar navigation
    document.getElementById('subCalPrevMonth')?.addEventListener('click', () => this.prevMonth());
    document.getElementById('subCalNextMonth')?.addEventListener('click', () => this.nextMonth());
    document.getElementById('subCalTodayBtn')?.addEventListener('click', () => this.resetToToday());
    document.getElementById('subCalShowAllBtn')?.addEventListener('click', () => {
      this.selectedDay = null;
      this.renderCalendar();
    });

    // Day Breakdown Modal close handlers (if used)
    document.getElementById('closeSubDayModal')?.addEventListener('click', () => this.closeDayModal());
    document.getElementById('subDayCloseBtn')?.addEventListener('click', () => this.closeDayModal());
    document.getElementById('subDayModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'subDayModal') this.closeDayModal();
    });

    // Filter pills in page-recurring (List view)
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

  switchTab(tab) {
    this.activeTab = tab;
    const tabCal = document.getElementById('subTabCalendar');
    const tabList = document.getElementById('subTabList');
    const secCal = document.getElementById('subCalendarSection');
    const secList = document.getElementById('subListSection');

    if (tab === 'calendar') {
      tabCal?.classList.add('active');
      tabList?.classList.remove('active');
      if (secCal) secCal.style.display = 'block';
      if (secList) secList.style.display = 'none';
      this.renderCalendar();
    } else {
      tabList?.classList.add('active');
      tabCal?.classList.remove('active');
      if (secList) secList.style.display = 'block';
      if (secCal) secCal.style.display = 'none';
      this.renderList();
    }
  },

  prevMonth() {
    this.calMonth--;
    if (this.calMonth < 0) {
      this.calMonth = 11;
      this.calYear--;
    }
    this.selectedDay = null;
    this.renderCalendar();
  },

  nextMonth() {
    this.calMonth++;
    if (this.calMonth > 11) {
      this.calMonth = 0;
      this.calYear++;
    }
    this.selectedDay = null;
    this.renderCalendar();
  },

  resetToToday() {
    const now = new Date();
    this.calYear = now.getFullYear();
    this.calMonth = now.getMonth();
    this.selectedDay = now.getDate();
    this.renderCalendar();
  },

  closeDayModal() {
    document.getElementById('subDayModal')?.classList.remove('open');
  },

  async load() {
    this.init();
    try {
      this.items = await API.get('/recurring');
      this.updateKPIs();
      this.renderCalendar();
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

  /* ─── Recurrence Engine for Any Month ─── */
  calculateMonthOccurrences(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun .. 6=Sat

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const occurrencesByDay = {};
    for (let d = 1; d <= daysInMonth; d++) {
      occurrencesByDay[d] = [];
    }

    let totalIncome = 0;
    let totalBills = 0;
    let totalBillsCount = 0;
    let pendingDue = 0;

    for (const r of this.items) {
      const amt = parseFloat(r.amount) || 0;
      if (!r.next_date || amt <= 0) continue;

      const [ny, nm, nd] = r.next_date.split('-').map(Number);
      const itemDays = [];

      if (r.frequency === 'monthly') {
        const targetDay = Math.min(nd, daysInMonth);
        itemDays.push(targetDay);
      } else if (r.frequency === 'yearly') {
        if ((nm - 1) === month) {
          const targetDay = Math.min(nd, daysInMonth);
          itemDays.push(targetDay);
        }
      } else if (r.frequency === 'weekly') {
        const dow = new Date(ny, nm - 1, nd).getDay();
        for (let d = 1; d <= daysInMonth; d++) {
          if (new Date(year, month, d).getDay() === dow) {
            itemDays.push(d);
          }
        }
      } else if (r.frequency === 'daily') {
        for (let d = 1; d <= daysInMonth; d++) {
          itemDays.push(d);
        }
      }

      for (const d of itemDays) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const occDate = new Date(year, month, d);
        occDate.setHours(0, 0, 0, 0);
        const diffDays = Math.round((occDate - today) / (1000 * 60 * 60 * 24));
        const isToday = (diffDays === 0);
        const isPast = (diffDays < 0);
        const isDueSoon = (diffDays > 0 && diffDays <= 3);

        occurrencesByDay[d].push({
          item: r,
          dateStr,
          day: d,
          diffDays,
          isToday,
          isPast,
          isDueSoon
        });

        if (r.active) {
          if (r.type === 'income') {
            totalIncome += amt;
          } else {
            totalBills += amt;
            totalBillsCount++;
            if (!isPast) {
              pendingDue += amt;
            }
          }
        }
      }
    }

    const netCashflow = totalIncome - totalBills;
    const commitmentRatio = totalIncome > 0
      ? Math.min(100, Math.round((totalBills / totalIncome) * 100))
      : (totalBills > 0 ? 100 : 0);

    return {
      daysInMonth,
      firstDayOfWeek,
      occurrencesByDay,
      stats: {
        totalIncome,
        totalBills,
        totalBillsCount,
        netCashflow,
        pendingDue,
        commitmentRatio
      }
    };
  },

  /* ─── Render Sleek Mini-Calendar & Dynamic Feed ─── */
  renderCalendar() {
    const gridEl = document.getElementById('subCalendarGrid');
    if (!gridEl) return;

    const { daysInMonth, firstDayOfWeek, occurrencesByDay, stats } = this.calculateMonthOccurrences(this.calYear, this.calMonth);

    // 1. Update Month Header Title
    const monthTitleEl = document.getElementById('calMonthYearDisplay');
    if (monthTitleEl) {
      monthTitleEl.textContent = `${this.MONTH_NAMES[this.calMonth]} ${this.calYear}`;
    }

    // 2. Update Forecast KPI Badges
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('calForecastIncome', `+${fmt(Math.round(stats.totalIncome))}`);
    set('calForecastBills', `-${fmt(Math.round(stats.totalBills))}`);

    const netEl = document.getElementById('calForecastNet');
    if (netEl) {
      const isPositive = stats.netCashflow >= 0;
      netEl.textContent = `${isPositive ? '+' : ''}${fmt(Math.round(stats.netCashflow))}`;
      netEl.className = `hub-kpi-val ${isPositive ? 'income' : 'expense'}`;
    }

    set('calForecastPending', fmt(Math.round(stats.pendingDue)));

    // 3. Update Runway Commitment Bar
    const barEl = document.getElementById('calCommitmentBar');
    const textEl = document.getElementById('calCommitmentText');
    if (barEl) barEl.style.width = `${stats.commitmentRatio}%`;
    if (textEl) {
      if (stats.totalIncome > 0) {
        const badge = stats.commitmentRatio <= 30
          ? '🟢 Healthy (<30%)'
          : stats.commitmentRatio <= 50
          ? '🟡 Moderate'
          : '⚠️ High ratio (>50%)';
        textEl.textContent = `${stats.commitmentRatio}% of income committed · ${badge}`;
      } else {
        textEl.innerHTML = stats.totalBills > 0 ? `<span class="hub-kpi-val expense">${fmt(stats.totalBills)}</span> monthly commitments` : 'No commitments scheduled';
      }
    }

    // 4. Update "All Month" Button Active State
    const allBtn = document.getElementById('subCalShowAllBtn');
    if (allBtn) {
      if (this.selectedDay === null) allBtn.classList.add('active');
      else allBtn.classList.remove('active');
    }

    // 5. Build Mini Calendar Grid (7 columns x 5-6 rows of compact 36px cells)
    const today = new Date();
    const isCurrentViewingMonth = (today.getFullYear() === this.calYear && today.getMonth() === this.calMonth);
    const todayDateNum = today.getDate();

    let cellsHtml = '';

    // Trailing days from previous month
    const prevMonthDays = new Date(this.calYear, this.calMonth, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const prevD = prevMonthDays - i;
      cellsHtml += `<div class="mini-day-cell other-month">${prevD}</div>`;
    }

    // Days of current month
    for (let d = 1; d <= daysInMonth; d++) {
      const occurrences = occurrencesByDay[d] || [];
      const hasExpense = occurrences.some(o => o.item.type === 'expense');
      const hasIncome = occurrences.some(o => o.item.type === 'income');
      const isToday = isCurrentViewingMonth && (d === todayDateNum);
      const isSelected = (this.selectedDay === d);

      let dotsHtml = '';
      if (hasExpense || hasIncome) {
        dotsHtml = '<div class="mini-day-dots">';
        if (hasExpense) dotsHtml += '<span class="mini-dot expense"></span>';
        if (hasIncome) dotsHtml += '<span class="mini-dot income"></span>';
        dotsHtml += '</div>';
      }

      cellsHtml += `
        <div class="mini-day-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'selected' : ''}"
             data-mini-day="${d}"
             title="${occurrences.length ? `${occurrences.length} renewal(s) on ${d} ${this.MONTH_NAMES[this.calMonth]}` : `${d} ${this.MONTH_NAMES[this.calMonth]}`}">
          <span>${d}</span>
          ${dotsHtml}
        </div>
      `;
    }

    // Leading days from next month
    const totalRendered = firstDayOfWeek + daysInMonth;
    const nextDaysNeeded = (totalRendered % 7 === 0) ? 0 : 7 - (totalRendered % 7);
    for (let n = 1; n <= nextDaysNeeded; n++) {
      cellsHtml += `<div class="mini-day-cell other-month">${n}</div>`;
    }

    gridEl.innerHTML = cellsHtml;

    // Bind click events on mini calendar days
    gridEl.querySelectorAll('.mini-day-cell[data-mini-day]').forEach(cell => {
      const d = parseInt(cell.dataset.miniDay);
      cell.addEventListener('click', () => {
        if (this.selectedDay === d) {
          this.selectedDay = null; // Toggle back to all month
        } else {
          this.selectedDay = d;
        }
        this.renderCalendar();
      });
    });

    // 6. Render Dynamic Feed in Right Panel
    this.renderFeed(occurrencesByDay, stats);
  },

  /* ─── Render Dynamic Action Feed in Right Panel ─── */
  renderFeed(occurrencesByDay, stats) {
    const listEl = document.getElementById('subFeedList');
    const titleEl = document.getElementById('subFeedTitle');
    const subEl = document.getElementById('subFeedSub');
    const countEl = document.getElementById('subFeedCount');
    if (!listEl) return;

    let itemsToDisplay = [];
    const monthName = this.MONTH_NAMES[this.calMonth];

    if (this.selectedDay !== null) {
      // Filtered to single selected date
      itemsToDisplay = occurrencesByDay[this.selectedDay] || [];
      const dateObj = new Date(this.calYear, this.calMonth, this.selectedDay);
      const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

      if (titleEl) titleEl.innerHTML = `📍 <span>${weekdayName}, ${this.selectedDay} ${monthName}</span>`;
      if (subEl) subEl.textContent = `${itemsToDisplay.length} commitment${itemsToDisplay.length !== 1 ? 's' : ''} on this date`;
      if (countEl) countEl.textContent = `${itemsToDisplay.length} on ${this.selectedDay}th`;
    } else {
      // All month view: collect all items across all days in order
      for (let d = 1; d <= 31; d++) {
        if (occurrencesByDay[d] && occurrencesByDay[d].length > 0) {
          itemsToDisplay.push(...occurrencesByDay[d]);
        }
      }
      if (titleEl) titleEl.innerHTML = `📅 <span>${monthName} ${this.calYear} Commitments</span>`;
      if (subEl) subEl.textContent = `Showing all scheduled renewals sorted chronologically`;
      if (countEl) countEl.textContent = `${itemsToDisplay.length} items`;
    }

    if (!itemsToDisplay.length) {
      const emptyMsg = (this.selectedDay !== null)
        ? `No subscriptions or bills due on <strong>${this.selectedDay} ${monthName}</strong>.`
        : `No subscriptions or bills scheduled for <strong>${monthName} ${this.calYear}</strong>.`;

      const targetDateStr = this.selectedDay
        ? `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}-${String(this.selectedDay).padStart(2, '0')}`
        : '';

      listEl.innerHTML = `
        <div class="sub-feed-empty">
          <div class="sub-feed-empty-icon">📅</div>
          <div>${emptyMsg}</div>
          <button class="sub-feed-btn primary" style="margin-top:6px" onclick="Recurring.openAddForDate('${targetDateStr}')">
            + Add Subscription
          </button>
        </div>
      `;
      return;
    }

    listEl.innerHTML = itemsToDisplay.map(o => {
      const item = o.item;
      const meta = this.getServiceMeta(item.description, item.category);
      const isExp = item.type === 'expense';
      const isPaused = !item.active;
      const dateStr = o.dateStr;

      const statusBadge = o.isToday
        ? '<span style="font-size:10.5px;font-weight:700;color:var(--expense);background:rgba(239,68,68,0.12);padding:1px 6px;border-radius:8px">🚨 Today</span>'
        : o.isDueSoon
        ? `<span style="font-size:10.5px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,0.12);padding:1px 6px;border-radius:8px">⚠️ In ${o.diffDays}d</span>`
        : o.isPast
        ? '<span style="font-size:10.5px;font-weight:500;color:var(--text-tertiary)">✓ Past</span>'
        : `<span style="font-size:10.5px;font-weight:500;color:var(--text-secondary)">In ${o.diffDays}d</span>`;

      return `
        <div class="sub-feed-item ${isPaused ? 'inactive' : ''}">
          <div class="sub-feed-item-left">
            <div class="sub-feed-icon">${meta.icon}</div>
            <div class="sub-feed-info">
              <div class="sub-feed-name" style="${isPaused ? 'text-decoration:line-through;opacity:0.6' : ''}">
                ${item.description}
                ${isPaused ? '<span style="font-size:10px;color:var(--text-tertiary);margin-left:4px">(Paused)</span>' : ''}
              </div>
              <div class="sub-feed-meta">
                <span class="sub-feed-day-tag">${monthName.slice(0, 3)} ${o.day}</span>
                <span>${item.category}</span>
                <span>·</span>
                ${statusBadge}
              </div>
            </div>
          </div>

          <div class="sub-feed-item-right">
            <div class="sub-feed-amt ${isExp ? 'expense' : 'income'}">
              ${isExp ? '-' : '+'}${fmt(item.amount)}
            </div>
            <div class="sub-feed-actions">
              <button class="sub-feed-btn primary" title="Instant Log to Transactions" onclick="Recurring.quickLogTxn(${item.id}, '${dateStr}')">
                ⚡ Log
              </button>
              <button class="sub-feed-btn" title="Review in Form" onclick="Recurring.openInTxnModal(${item.id}, '${dateStr}')">
                ✏️ Edit
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  openAddForDate(dateStr) {
    this.closeDayModal();
    const dateInput = document.getElementById('recNextDate');
    if (dateInput && dateStr) dateInput.value = dateStr;
    document.getElementById('recurringModal')?.classList.add('open');
  },

  /* ─── Instant One-Click Payment / Transaction Logger ─── */
  async quickLogTxn(itemId, dateStr) {
    const item = this.items.find(r => r.id === itemId);
    if (!item) return;

    try {
      const defaultAcc = (typeof State !== 'undefined' && Array.isArray(State.accounts) && State.accounts[0])
        ? State.accounts[0].id
        : null;

      await API.post('/transactions', {
        description: item.description,
        amount: parseFloat(item.amount),
        type: item.type || 'expense',
        category: item.category || 'Bills',
        date: dateStr,
        account_id: defaultAcc
      });

      UI.toast(`✓ Logged ${item.description} (${fmt(item.amount)}) to Transactions!`, 'success');
      this.closeDayModal();

      // Refresh app data in background
      if (typeof App !== 'undefined') {
        if (typeof App.loadTransactions === 'function') App.loadTransactions();
        if (typeof App.loadDashboard === 'function') App.loadDashboard();
      }
    } catch (err) {
      UI.toast('Failed to log payment: ' + (err.message || 'Unknown error'), 'error');
    }
  },

  openInTxnModal(itemId, dateStr) {
    const item = this.items.find(r => r.id === itemId);
    if (!item) return;
    this.closeDayModal();

    if (typeof UI !== 'undefined' && UI.openAddModal) {
      UI.openAddModal({
        description: item.description,
        amount: item.amount,
        type: item.type || 'expense',
        category: item.category || 'Bills',
        date: dateStr
      });
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
      UI.toast('⚠️ Something went wrong loading the form', 'error'); return;
    }

    const description = descEl.value.trim();
    const amount      = parseFloat(amtEl.value);
    const type        = typeEl.value;
    const category    = catEl.value;
    const frequency   = freqEl.value;
    const next_date   = dateEl.value;

    if (!description || !amount || !next_date) { UI.toast('⚠️ Fill in all fields', 'error'); return; }
    if (amount <= 0) { UI.toast('⚠️ Amount must be greater than 0', 'error'); return; }

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
