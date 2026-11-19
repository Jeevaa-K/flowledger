import { State } from './state.js';

export const ReportsModule = {
  _auditMonth: null,
  _auditYear: null,
  _auditBound: false,

  async loadAnalytics() {
    try {
      const [summary, txns] = await Promise.all([API.get('/summary'), API.get('/transactions?limit=500')]);
      Charts.renderLine(summary.monthlyTrend);
      UI.renderCatBreakdown(summary.byCategory || []);
      UI.renderTopDays(txns);
    } catch { UI.toast('Error loading analytics', 'error'); }
  },

  initReports() {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];

    this._auditMonth = State.month;
    this._auditYear = State.year;

    const setMonthLabel = () => {
      const el = document.getElementById('auditMonthLabel');
      if (el) el.textContent = months[this._auditMonth - 1] + ' ' + this._auditYear;
    };
    setMonthLabel();

    if (this._auditBound) return;
    this._auditBound = true;

    const hideResults = () => {
      const empty = document.getElementById('auditEmptyState');
      if (empty) empty.style.display = 'flex';
      ['auditKpiRow','auditScoreRow','auditAiCard','auditGrid','auditDownloadCard'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    };

    document.getElementById('auditPrevMonth')?.addEventListener('click', () => {
      this._auditMonth--;
      if (this._auditMonth < 1) { this._auditMonth = 12; this._auditYear--; }
      setMonthLabel();
      hideResults();
    });
    document.getElementById('auditNextMonth')?.addEventListener('click', () => {
      this._auditMonth++;
      if (this._auditMonth > 12) { this._auditMonth = 1; this._auditYear++; }
      setMonthLabel();
      hideResults();
    });

    const generateAudit = async () => {
      const btn = document.getElementById('generateAuditBtn');
      const btn2 = document.getElementById('auditEmptyGenBtn');
      const origText = btn ? btn.textContent : '';
      const origText2 = btn2 ? btn2.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
      if (btn2) { btn2.disabled = true; btn2.textContent = 'Analyzing...'; }
      try {
        const data = await API.get(`/reports/audit?month=${this._auditMonth}&year=${this._auditYear}`);
        this.renderAudit(data);
      } catch (e) {
        console.error('Audit error:', e);
        UI.toast('Error generating audit: ' + e.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
        if (btn2) { btn2.disabled = false; btn2.textContent = origText2; }
      }
    };

    document.getElementById('generateAuditBtn')?.addEventListener('click', generateAudit);
    document.getElementById('auditEmptyGenBtn')?.addEventListener('click', generateAudit);

    const downloadCsv = async () => {
      try {
        const res = await fetch(`/api/export/monthly-csv?month=${this._auditMonth}&year=${this._auditYear}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to download CSV');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `statement-${this._auditYear}-${String(this._auditMonth).padStart(2, '0')}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('✓ CSV downloaded!', 'success');
      } catch (e) { UI.toast('CSV error: ' + e.message, 'error'); }
    };
    document.getElementById('downloadAuditCsvBtn')?.addEventListener('click', downloadCsv);
    document.getElementById('downloadAuditCsvBtn2')?.addEventListener('click', downloadCsv);

    document.getElementById('downloadPdfBtn')?.addEventListener('click', async () => {
      const btn   = document.getElementById('downloadPdfBtn');
      const m     = this._auditMonth;
      const y     = this._auditYear;
      if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }
      try {
        const res = await fetch(`/api/export/pdf?month=${m}&year=${y}`, { credentials: 'same-origin' });
        if (!res.ok) {
          let msg = 'Failed';
          try { const j = await res.json(); msg = j.error || j.details || msg; } catch { }
          throw new Error(msg);
        }
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('Empty PDF received');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flowledger-${y}-${String(m).padStart(2, '0')}.pdf`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('✓ PDF downloaded!', 'success');
      } catch (e) {
        console.error('PDF error:', e);
        UI.toast('PDF error: ' + e.message, 'error');
      } finally {
        if (btn) { btn.textContent = 'Download PDF'; btn.disabled = false; }
      }
    });
  },

  renderAudit(data) {
    const { summary, byCategory, topMerchants, aiAnalysis, periodName,
            healthScore, healthLabel, healthColor, spendTrend } = data;

    document.getElementById('auditEmptyState').style.display = 'none';
    document.getElementById('auditKpiRow').style.display     = 'grid';
    document.getElementById('auditScoreRow').style.display   = '';
    document.getElementById('auditAiCard').style.display     = '';
    document.getElementById('auditGrid').style.display       = 'grid';
    document.getElementById('auditDownloadCard').style.display = '';

    document.getElementById('auditKpiRow').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon kpi-icon-positive">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </div></div>
        <div class="kpi-value green audit-num">${fmt(summary.income)}</div>
        <div class="kpi-label">Total Income</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-icon kpi-icon-negative"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg></div>
          ${summary.momChange !== 0 ? `<span class="audit-mom-badge ${summary.momChange > 0 ? 'up' : 'down'}">${summary.momChange > 0 ? '↑' : '↓'} ${Math.abs(summary.momChange)}% MoM</span>` : ''}
        </div>
        <div class="kpi-value red audit-num">${fmt(summary.expense)}</div>
        <div class="kpi-label">Total Expenses</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon kpi-icon-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div></div>
        <div class="kpi-value ${summary.netSavings >= 0 ? 'green' : 'red'} audit-num">${fmt(summary.netSavings)}</div>
        <div class="kpi-label">Net Savings</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon kpi-icon-highlight"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3.332.83-4.5 2.05C10.832 3.83 9.26 3 7.5 3A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7 7-7z"/></svg></div></div>
        <div class="kpi-value purple audit-num">${summary.savingsRate}%</div>
        <div class="kpi-label">Savings Rate</div>
        <div class="kpi-sub">${summary.txnCount} transactions</div>
      </div>`;

    const score   = healthScore ?? 50;
    const color   = healthColor ?? '#6366F1';
    const label   = healthLabel ?? 'Fair';
    const circ    = 314;
    const offset  = circ - (circ * score / 100);
    const ringFill = document.getElementById('auditRingFill');
    if (ringFill) {
      ringFill.style.stroke = color;
      ringFill.style.strokeDashoffset = circ;
      requestAnimationFrame(() => {
        ringFill.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)';
        ringFill.style.strokeDashoffset = offset;
      });
    }
    const numEl = document.getElementById('auditScoreNum');
    if (numEl) { numEl.textContent = score; numEl.style.color = color; }
    const lblEl = document.getElementById('auditScoreLabel');
    if (lblEl) { lblEl.textContent = label; lblEl.style.color = color; }

    const breakdownEl = document.getElementById('auditScoreBreakdown');
    if (breakdownEl) {
      const rows = [
        { k: 'Savings Rate', v: summary.savingsRate + '%', ok: summary.savingsRate >= 20 },
        { k: 'MoM Trend',    v: summary.momChange > 0 ? '↑ ' + summary.momChange + '% more' : summary.momChange < 0 ? '↓ ' + Math.abs(summary.momChange) + '% less' : 'No change', ok: summary.momChange <= 0 },
        { k: 'Transactions', v: summary.txnCount + ' this month', ok: summary.txnCount >= 5 },
      ];
      breakdownEl.innerHTML = rows.map(r =>
        `<div class="audit-score-row-item">
          <span class="audit-score-pill ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '!'}</span>
          <span class="audit-score-key">${r.k}</span>
          <span class="audit-score-val">${r.v}</span>
        </div>`
      ).join('');
    }

    const trendEl = document.getElementById('auditTrendBody');
    if (trendEl && spendTrend && spendTrend.length) {
      const maxVal = Math.max(...spendTrend.map(d => Math.max(d.expense, d.income)), 1);
      trendEl.innerHTML = `
        <div class="audit-trend-chart">
          ${spendTrend.map(d => {
            const expH = Math.round((d.expense / maxVal) * 100);
            const incH = Math.round((d.income  / maxVal) * 100);
            const isCur = (d.mo === (data.period || ''));
            return `<div class="audit-trend-col ${isCur ? 'current' : ''}">
              <div class="audit-trend-bars">
                <div class="audit-trend-bar income-bar"  style="height:${incH}%" title="Income: ${fmt(d.income)}"></div>
                <div class="audit-trend-bar expense-bar" style="height:${expH}%" title="Expense: ${fmt(d.expense)}"></div>
              </div>
              <div class="audit-trend-label">${d.label}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="audit-trend-legend">
          <span class="audit-trend-dot income-dot"></span> Income
          <span class="audit-trend-dot expense-dot" style="margin-left:12px"></span> Expense
        </div>`;
    }

    const periodEl = document.getElementById('auditAiPeriod');
    if (periodEl) periodEl.textContent = periodName || '';

    const bodyEl = document.getElementById('auditAiBody');
    if (bodyEl && aiAnalysis) {
      bodyEl.innerHTML = aiAnalysis
        .replace(/### (.*)/g, '<h3>$1</h3>')
        .replace(/## (.*)/g, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^• (.*)/gm, '<li>$1</li>')
        .replace(/^- (.*)/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
        .replace(/\n\n/g, '<br>');
    }

    const catColors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#8B5CF6', '#EC4899', '#F97316'];
    document.getElementById('auditCatList').innerHTML = (byCategory || []).length
      ? byCategory.map((c, i) => `
          <div class="audit-cat-row">
            <div style="width:10px;height:10px;border-radius:50%;background:${catColors[i % catColors.length]};flex-shrink:0"></div>
            <div style="flex:1;font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(c.category)}</div>
            <div class="audit-num" style="font-size:12px;color:var(--text-secondary);min-width:60px;text-align:right">${fmt(c.total)}</div>
            <div class="audit-cat-bar-track" style="width:80px">
              <div class="audit-cat-bar-fill" style="width:${c.percent}%;background:${catColors[i % catColors.length]}"></div>
            </div>
            <div class="audit-cat-pct">${c.percent}%</div>
          </div>`).join('')
      : '<div style="padding:20px;text-align:center;color:var(--text-tertiary)">No expense categories this month</div>';

    document.getElementById('auditTopMerchants').innerHTML = (topMerchants || []).length
      ? topMerchants.map((t, i) => `
          <div class="audit-merchant-row">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:22px;height:22px;border-radius:var(--r-sm,6px);background:var(--surface-sunken);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--text-secondary)">${i + 1}</div>
              <div>
                <div style="font-weight:600;color:var(--text-primary)">${escapeHtml(t.description)}</div>
                <div style="font-size:11px;color:var(--text-tertiary)">${escapeHtml(t.category)} · ${escapeHtml(t.date)}</div>
              </div>
            </div>
            <div class="red audit-num" style="font-weight:700">${fmt(t.amount)}</div>
          </div>`).join('')
      : '<div style="padding:20px;text-align:center;color:var(--text-tertiary)">No transactions this month</div>';
  }
};

export default ReportsModule;
