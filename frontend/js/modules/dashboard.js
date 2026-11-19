import { State } from './state.js';

export const DashboardModule = {
  async loadDashboard() {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ml = document.getElementById('monthLabel');
    const cl = document.getElementById('currentMonthLabel');
    if (ml) ml.textContent = months[State.month - 1];
    if (cl) cl.textContent = `${months[State.month - 1]} ${State.year}`;

    const kpiIds = ['kpiBalance', 'kpiIncome', 'kpiExpense', 'kpiSavings'];
    kpiIds.forEach(id => document.getElementById(id)?.classList.add('is-loading'));

    try {
      const isCurrentMonth = State.month === (new Date().getMonth() + 1) && State.year === new Date().getFullYear();
      const [summary, txns, budgets] = await Promise.all([
        API.get(`/summary?month=${State.month}&year=${State.year}`),
        API.get('/transactions?limit=6&sort=created_desc'),
        isCurrentMonth ? API.get('/budgets') : Promise.resolve([])
      ]);
      State.summary = summary;
      State.transactions = txns;

      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      setText('kpiBalance', fmt(summary.balance));
      const balEl = document.getElementById('kpiBalance');
      if (balEl) balEl.classList.toggle('negative', summary.balance < 0);
      setText('kpiIncome', fmt(summary.income));
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
      this.updateHealthScore(summary, budgets, State.accounts);
      this.loadBurnRate();
      this.loadCashflowForecast();
      UI.renderTxnList(txns, 'recentTxns', 6, false);
      UI.renderTopCats(summary.byCategory || []);

      const inTxns = txns.filter(t => t.type === 'income').length;
      const exTxns = txns.filter(t => t.type === 'expense').length;
      setText('incomeCount', `${inTxns} transaction${inTxns !== 1 ? 's' : ''}`);
      setText('expenseCount', `${exTxns} transaction${exTxns !== 1 ? 's' : ''}`);

    } catch (e) {
      console.error('Dashboard error:', e);
      kpiIds.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));
      UI.toast('⚠ Could not load data. Is the server running?', 'error');
    }
  },

  updateAIStats(summary) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('aiStatInc', fmt(summary.income || 0));
    set('aiStatExp', fmt(summary.expense || 0));
    set('aiStatSav', fmt((summary.income || 0) - (summary.expense || 0)));
  },

  renderBudgetAlert(budgets) {
    const over = (budgets || []).filter(b => b.percent >= 100);
    const nearing = (budgets || []).filter(b => b.percent >= 80 && b.percent < 100);
    const items = [
      ...over.map(b => ({
        icon: '🚨', level: '',
        title: `Over budget: ${b.category}`,
        sub: `Spent ${fmt(b.spent)} of ${fmt(b.monthly_limit)} limit (${b.percent}%)`
      })),
      ...nearing.map(b => ({
        icon: '⚠️', level: 'warn',
        title: `Approaching limit: ${b.category}`,
        sub: `Spent ${fmt(b.spent)} of ${fmt(b.monthly_limit)} limit (${b.percent}%)`
      }))
    ];
    if (typeof Notifications !== 'undefined' && Notifications.setBudgetAlerts) {
      Notifications.setBudgetAlerts(items);
    }
  },

  async updateNavCount() {
    try {
      const txns = await API.get('/transactions?limit=500');
      const el = document.getElementById('txn-count');
      if (el) el.textContent = txns.length;
    } catch { }
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

  updateHealthScore(summary, budgets, accounts) {
    const card = document.getElementById('healthScoreCard');
    if (!card) return;

    const income = summary.income || 0;
    const expense = summary.expense || 0;
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;

    let savingsScore = 0;
    if (savingsRate >= 30) savingsScore = 40;
    else if (savingsRate >= 20) savingsScore = 32 + Math.round(((savingsRate - 20) / 10) * 8);
    else if (savingsRate >= 10) savingsScore = 20 + Math.round(((savingsRate - 10) / 10) * 12);
    else if (savingsRate > 0) savingsScore = Math.max(5, Math.round((savingsRate / 10) * 20));

    let budgetScore = 20;
    let budgetRatioText = 'No budgets defined (setup budgets for +10 pts)';
    if (budgets && budgets.length > 0) {
      const underCount = budgets.filter(b => (b.percent || 0) <= 100).length;
      const overCount = budgets.length - underCount;
      const ratio = underCount / budgets.length;
      budgetScore = Math.round(ratio * 30);
      budgetRatioText = overCount > 0
        ? `${underCount}/${budgets.length} budgets on track (${overCount} over limit)`
        : `All ${budgets.length} active category budgets on track!`;
    }

    let totalLiquidity = 0;
    if (accounts && accounts.length > 0) {
      totalLiquidity = accounts.reduce((acc, a) => acc + (parseFloat(a.balance) || 0), 0);
    } else {
      totalLiquidity = Math.max(0, summary.balance || 0);
    }

    let cushionScore = 0;
    let cushionMonths = 0;
    if (expense > 0) {
      cushionMonths = totalLiquidity / expense;
      if (cushionMonths >= 3) cushionScore = 30;
      else if (cushionMonths >= 1) cushionScore = 15 + Math.round(((cushionMonths - 1) / 2) * 15);
      else if (cushionMonths > 0) cushionScore = Math.max(5, Math.round(cushionMonths * 15));
    } else {
      cushionScore = totalLiquidity > 0 ? 30 : 15;
      cushionMonths = 3;
    }

    const totalScore = Math.min(100, Math.max(0, savingsScore + budgetScore + cushionScore));

    let grade = '';
    let badgeClass = '';
    let gaugeColor = '#6366F1';
    let tipText = '';

    if (totalScore >= 85) {
      grade = 'Excellent'; badgeClass = 'status-excellent'; gaugeColor = '#10B981';
      tipText = `Outstanding financial posture! You're saving ${savingsRate.toFixed(0)}% of income with healthy liquid runway. Consider investing surplus funds into your long-term goals.`;
    } else if (totalScore >= 70) {
      grade = 'Healthy'; badgeClass = 'status-healthy'; gaugeColor = '#06B6D4';
      tipText = savingsScore < 25
        ? `Good overall health! Boosting your monthly savings rate closer to 20% would push your score past 85.`
        : `Strong financial discipline! Review categories nearing budget limits to keep expenses balanced.`;
    } else if (totalScore >= 50) {
      grade = 'Fair'; badgeClass = 'status-fair'; gaugeColor = '#F59E0B';
      tipText = budgetScore < 20
        ? `Some category budgets have exceeded limits. Consider setting stricter limits or trimming discretionary spend.`
        : `Your liquid reserves are currently below recommended 2 months of expenses. Focus on building an emergency cushion.`;
    } else {
      grade = 'Needs Attention'; badgeClass = 'status-needs-attention'; gaugeColor = '#EF4444';
      tipText = savingsRate <= 0
        ? `Expenses are currently outpacing your income this month. Check your high-burn categories to halt cash drain.`
        : `Take immediate steps to curb non-essential purchases and build at least 1 month of emergency reserve.`;
    }

    const badgeEl = document.getElementById('healthScoreBadge');
    if (badgeEl) {
      badgeEl.textContent = `${grade} (${totalScore}/100)`;
      badgeEl.className = `health-score-badge ${badgeClass}`;
    }

    const valEl = document.getElementById('healthScoreVal');
    if (valEl) valEl.textContent = totalScore;

    const gradeLabel = document.getElementById('healthGradeLabel');
    if (gradeLabel) gradeLabel.textContent = grade;

    const gaugeBar = document.getElementById('healthGaugeBar');
    if (gaugeBar) {
      const circ = 339.29;
      const offset = circ - (circ * (totalScore / 100));
      gaugeBar.style.strokeDasharray = `${circ}`;
      gaugeBar.style.strokeDashoffset = `${offset}`;
      gaugeBar.style.stroke = gaugeColor;
    }

    const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

    setHtml('healthMetricSavings', `${savingsScore} <span style="font-size:11px;color:var(--text-tertiary)">/ 40 pts</span>`);
    setStyle('healthBarSavings', 'width', `${(savingsScore / 40) * 100}%`);
    setHtml('healthDescSavings', `Savings Rate: <strong>${savingsRate.toFixed(1)}%</strong> of income`);

    setHtml('healthMetricBudget', `${budgetScore} <span style="font-size:11px;color:var(--text-tertiary)">/ 30 pts</span>`);
    setStyle('healthBarBudget', 'width', `${(budgetScore / 30) * 100}%`);
    setHtml('healthDescBudget', budgetRatioText);

    setHtml('healthMetricCushion', `${cushionScore} <span style="font-size:11px;color:var(--text-tertiary)">/ 30 pts</span>`);
    setStyle('healthBarCushion', 'width', `${(cushionScore / 30) * 100}%`);
    setHtml('healthDescCushion', `Emergency Runway: <strong>${cushionMonths.toFixed(1)} months</strong> (${fmt(totalLiquidity)} liquid)`);

    setHtml('healthScoreTip', tipText);
  },

  async loadBurnRate() {
    try {
      const data = await API.get(`/burnrate?month=${State.month}&year=${State.year}`);
      const card = document.getElementById('burnRateCard');
      if (!card) return;
      card.style.display = '';

      const { income, expense, dailyRate, projectedExpense, projectedSavings,
        daysLeft, safeDaily, pace, isCurrentMonth } = data;

      const badge = document.getElementById('burnPaceBadge');
      const gauge = document.getElementById('burnGaugeFill');
      const paceVal = document.getElementById('burnPaceVal');
      const sub = document.getElementById('burnSubtext');
      const proj = document.getElementById('burnProjected');
      const safe = document.getElementById('burnSafePace');
      const daily = document.getElementById('burnDailyRate');
      const days = document.getElementById('burnDaysLeft');

      if (daily) daily.textContent = fmt(dailyRate) + '/day';
      if (days) days.textContent = isCurrentMonth ? `${daysLeft} days left` : 'Past month';
      if (proj) proj.textContent = fmt(projectedExpense);
      if (safe) safe.textContent = income > 0 ? fmt(safeDaily) + '/day' : 'N/A';

      if (pace === 'ok') {
        if (badge) { badge.textContent = 'On Track'; badge.className = 'burn-pace-badge pace-ok'; }
        if (gauge) { gauge.style.width = '35%'; gauge.style.background = 'var(--accent-teal)'; }
        if (paceVal) paceVal.textContent = 'Pace: Safe';
        if (sub) sub.textContent = projectedSavings >= 0
          ? `Projected surplus of ${fmt(projectedSavings)} if current burn rate continues.`
          : 'Spending within bounds.';
      } else if (pace === 'warning') {
        if (badge) { badge.textContent = 'Accelerating'; badge.className = 'burn-pace-badge pace-warning'; }
        if (gauge) { gauge.style.width = '70%'; gauge.style.background = 'var(--accent-coral)'; }
        if (paceVal) paceVal.textContent = 'Pace: Moderate';
        if (sub) sub.textContent = `Burn rate is high. Safe limit is ${fmt(safeDaily)}/day to keep savings positive.`;
      } else {
        if (badge) { badge.textContent = 'Over Pace'; badge.className = 'burn-pace-badge pace-danger'; }
        if (gauge) { gauge.style.width = '100%'; gauge.style.background = 'var(--text-danger)'; }
        if (paceVal) paceVal.textContent = 'Pace: Over budget';
        const deficit = Math.abs(projectedSavings);
        const msg = `Burn rate alert: projected to overspend by ${fmt(deficit)} this month at current daily pace of ${fmt(dailyRate)}.`;
        if (sub) sub.textContent = msg;

        const existing = (State.burnAlert || '');
        if (existing !== msg) {
          if (typeof Notifications !== 'undefined' && Notifications.setBurnRateAlert) {
            Notifications.setBurnRateAlert([{
              icon: '🔥',
              level: 'danger',
              title: 'High Burn Rate',
              sub: msg
            }]);
          }
          State.burnAlert = msg;
        }
      }
    } catch (e) {
      console.warn('Could not load burn rate:', e);
    }
  },

  bindCashflowRadar() {
    const toggle = document.getElementById('cashflowDaysToggle');
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill-btn');
        if (!btn || !btn.dataset.days) return;
        const days = parseInt(btn.dataset.days);
        if (days === State.cashflowDays) return;
        toggle.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.cashflowDays = days;
        const horizon = document.getElementById('cfHorizonLabel');
        if (horizon) horizon.textContent = `${days} Days`;
        this.loadCashflowForecast();
      });
    }

    const accSelect = document.getElementById('cashflowAccountSelect');
    if (accSelect) {
      accSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        State.cashflowAccountId = val ? parseInt(val) : null;
        this.loadCashflowForecast();
      });
    }
  },

  async loadCashflowForecast() {
    const card = document.getElementById('cashflowRadarCard');
    if (!card) return;
    try {
      const days = State.cashflowDays || 30;
      const accountId = State.cashflowAccountId || null;
      const data = await API.getCashflowForecast(days, accountId);
      if (!data) return;
      State.cashflowData = data;

      const accSelect = document.getElementById('cashflowAccountSelect');
      if (accSelect && data.accounts) {
        const currentVal = accSelect.value;
        const options = ['<option value="">All Accounts (Net Liquid)</option>'];
        for (const acc of data.accounts) {
          const selected = String(acc.id) === String(accountId) ? 'selected' : '';
          options.push(`<option value="${acc.id}" ${selected}>${acc.name} (${acc.type})</option>`);
        }
        accSelect.innerHTML = options.join('');
      }

      const balEl = document.getElementById('cfCurrentBalance');
      const inEl = document.getElementById('cfProjectedIn');
      const outEl = document.getElementById('cfProjectedOut');
      const lowEl = document.getElementById('cfLowestProjected');

      if (balEl) balEl.textContent = fmt(data.currentBalance);
      if (inEl) inEl.textContent = `+${fmt(data.projectedInflow)}`;
      if (outEl) outEl.textContent = `-${fmt(data.projectedOutflow)}`;
      if (lowEl) {
        lowEl.textContent = fmt(data.lowestProjectedBalance);
        lowEl.classList.toggle('negative', data.lowestProjectedBalance < 0);
      }

      const banner = document.getElementById('cfOverdraftBanner');
      const sub = document.getElementById('cfOverdraftSub');
      const alertBadge = document.getElementById('cfAlertBadge');

      if (data.overdraftRisk) {
        if (banner) banner.style.display = 'flex';
        if (alertBadge) alertBadge.style.display = 'inline-flex';
        const msg = `Projected deficit of ${fmt(Math.abs(data.lowestProjectedBalance))} on ${data.overdraftDate} (${data.daysUntilOverdraft} days away). Adjust discretionary spending or transfer funds.`;
        if (sub) sub.textContent = msg;

        const notifId = `overdraft-${data.overdraftDate}-${Math.round(data.lowestProjectedBalance)}`;
        if (State.lastOverdraftAlert !== notifId) {
          if (typeof Notifications !== 'undefined' && Notifications.setCashflowAlert) {
            Notifications.setCashflowAlert([{
              icon: '⚡',
              level: 'danger',
              title: `Overdraft Risk in ${data.daysUntilOverdraft} Days`,
              sub: msg
            }]);
          }
          State.lastOverdraftAlert = notifId;
        }
      } else {
        if (banner) banner.style.display = 'none';
        if (alertBadge) alertBadge.style.display = 'none';
        if (typeof Notifications !== 'undefined' && Notifications.setCashflowAlert) {
          Notifications.setCashflowAlert([]);
        }
      }

      if (typeof Charts !== 'undefined' && Charts.renderCashflowForecast) {
        Charts.renderCashflowForecast(data.forecast, data.overdraftRisk);
      }
    } catch (e) {
      console.warn('Could not load cashflow forecast:', e);
    }
  }
};

export default DashboardModule;
