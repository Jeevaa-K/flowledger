export const BudgetsModule = {
  _budgetSuggestions: [],

  async loadBudgets() {
    try { UI.renderBudgets(await API.get('/budgets')); }
    catch { UI.toast('Error loading budgets', 'error'); }
  },

  async saveBudget() {
    const catEl = document.getElementById('budgetCategory');
    const limEl = document.getElementById('budgetLimit');
    if (!catEl || !limEl) { UI.toast('Something went wrong loading the form', 'error'); return; }
    const category = catEl.value;
    const monthly_limit = parseFloat(limEl.value);
    if (!monthly_limit || monthly_limit <= 0) { UI.toast('Enter a valid limit', 'error'); return; }
    const btn = document.getElementById('saveBudgetBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      await API.post('/budgets', { category, monthly_limit });
      UI.toast('✓ Budget saved', 'success');
      UI.closeBudgetModal();
      await this.loadBudgets();
    } catch { UI.toast('Error saving budget', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save Budget'; } }
  },

  async deleteBudget(id) {
    if (!confirm('Remove this budget?')) return;
    try { await API.del(`/budgets/${id}`); UI.toast('✓ Removed', 'success'); await this.loadBudgets(); }
    catch { UI.toast('Error removing budget', 'error'); }
  },

  async openAutoBudgetPlanner() {
    const panel = document.getElementById('autoBudgetPanel');
    if (!panel) return;
    panel.style.display = '';
    await this.fetchBudgetSuggestions();
  },

  closeAutoBudgetPlanner() {
    const panel = document.getElementById('autoBudgetPanel');
    if (panel) panel.style.display = 'none';
  },

  async fetchBudgetSuggestions() {
    const refreshBtn = document.getElementById('refreshAutoBudgetBtn');
    const bannerText = document.getElementById('autoBudgetAiText');
    const list = document.getElementById('autoBudgetList');
    if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = 'Analyzing...'; }
    if (bannerText) bannerText.textContent = 'Analyzing your 90-day spending velocity across categories...';
    if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">Running AI spending diagnosis and computing realistic caps...</div>';

    try {
      const data = await API.get('/budgets/suggest');
      this._budgetSuggestions = data.suggestions || [];
      this.renderBudgetSuggestions(data);
    } catch (e) {
      console.error('Auto budget error:', e);
      UI.toast('Could not generate budget suggestions: ' + (e.message || 'Error'), 'error');
      if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--expense)">Failed to load suggestions. Please try again.</div>';
    } finally {
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = 'Re-analyze'; }
    }
  },

  renderBudgetSuggestions(data) {
    const { suggestions, totalSuggested, totalCurrent, aiSummary } = data;
    const bannerText = document.getElementById('autoBudgetAiText');
    if (bannerText) bannerText.innerHTML = (aiSummary || 'Personalized budget targets calculated based on spending history.').replace(/\n/g, '<br>');

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('abStatCategories', (suggestions || []).length);
    setText('abStatCurrent', fmt(totalCurrent || 0));
    setText('abStatSuggested', fmt(totalSuggested || 0));

    const list = document.getElementById('autoBudgetList');
    if (!list) return;

    if (!suggestions || suggestions.length === 0) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">No spending categories detected yet. Add transactions to generate personalized limits!</div>';
      return;
    }

    list.innerHTML = suggestions.map((s, idx) => {
      const color = (typeof CAT_COLORS !== 'undefined' && CAT_COLORS[s.category]) || '#6366F1';
      const emoji = (typeof CAT_EMOJIS !== 'undefined' && CAT_EMOJIS[s.category]) || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
      const trendLabel = s.trend === 'increasing' ? '↗ Trending +15%' : s.trend === 'decreasing' ? '↘ Downward' : s.trend === 'starter' ? 'Recommended Starter' : '➡ Stable';

      return `
        <div class="ab-item-row" id="abRow_${idx}" data-idx="${idx}">
          <div class="ab-item-check">
            <input type="checkbox" class="ab-row-check" data-idx="${idx}" checked />
          </div>
          <div class="ab-cat-cell">
            <div class="ab-cat-badge" style="background:${color}"></div>
            <div>
              <div class="ab-cat-name">${emoji} ${s.category}</div>
              <div class="ab-cat-meta">${s.avgMonthlySpend > 0 ? `Avg: ${fmt(s.avgMonthlySpend)}/mo` : 'No history yet'}</div>
            </div>
          </div>
          <div class="ab-reason-cell">
            <span class="ab-trend-pill ${s.trend}">${trendLabel}</span>
            <span>${s.reason}</span>
          </div>
          <div class="ab-input-cell">
            <div class="ab-input-wrap">
              <span class="ab-curr-sym">₹</span>
              <input type="number" class="ab-input-field" id="abInput_${idx}" data-idx="${idx}" value="${s.suggestedLimit}" min="50" step="50" />
            </div>
            <div class="ab-prev-limit">${s.currentLimit ? `Current: ${fmt(s.currentLimit)}` : 'No current limit'}</div>
          </div>
          <div class="ab-action-cell">
            <button class="btn-ghost btn-sm" data-action="apply-single-budget" data-idx="${idx}" type="button">Apply</button>
          </div>
        </div>
      `;
    }).join('');

    this.updateAutoBudgetSelectionSummary();
    this.bindAutoBudgetEvents();
  },

  updateAutoBudgetSelectionSummary() {
    const checks = document.querySelectorAll('.ab-row-check');
    let count = 0;
    let total = 0;

    checks.forEach(chk => {
      const idx = parseInt(chk.dataset.idx);
      const row = document.getElementById(`abRow_${idx}`);
      const input = document.getElementById(`abInput_${idx}`);
      const val = input ? (parseFloat(input.value) || 0) : 0;

      if (chk.checked) {
        count++;
        total += val;
        if (row) row.classList.remove('excluded');
      } else {
        if (row) row.classList.add('excluded');
      }
    });

    const countEl = document.getElementById('abSelectedCount');
    const totalEl = document.getElementById('abSelectedTotal');
    const applyBtn = document.getElementById('applyAutoBudgetsBtn');
    if (countEl) countEl.textContent = count;
    if (totalEl) totalEl.textContent = fmt(total);
    if (applyBtn) {
      applyBtn.disabled = (count === 0);
      applyBtn.textContent = `Apply Selected Budgets (${count})`;
    }
  },

  bindAutoBudgetEvents() {
    const selectAll = document.getElementById('abSelectAll');
    if (selectAll) {
      selectAll.onchange = (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.ab-row-check').forEach(chk => { chk.checked = isChecked; });
        this.updateAutoBudgetSelectionSummary();
      };
    }

    document.querySelectorAll('.ab-row-check').forEach(chk => {
      chk.onchange = () => {
        this.updateAutoBudgetSelectionSummary();
      };
    });

    document.querySelectorAll('.ab-input-field').forEach(inp => {
      inp.oninput = () => {
        this.updateAutoBudgetSelectionSummary();
      };
    });
  },

  async applySelectedBudgets() {
    if (!this._budgetSuggestions || this._budgetSuggestions.length === 0) return;
    const checks = document.querySelectorAll('.ab-row-check:checked');
    if (checks.length === 0) {
      UI.toast('Please select at least one budget suggestion', 'error');
      return;
    }

    const budgetsToApply = [];
    checks.forEach(chk => {
      const idx = parseInt(chk.dataset.idx);
      const s = this._budgetSuggestions[idx];
      const inp = document.getElementById(`abInput_${idx}`);
      const limit = inp ? parseFloat(inp.value) : (s ? s.suggestedLimit : 0);
      if (s && limit > 0) {
        budgetsToApply.push({
          category: s.category,
          monthly_limit: limit
        });
      }
    });

    const btn = document.getElementById('applyAutoBudgetsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }

    try {
      const res = await API.post('/budgets/apply-suggestions', { budgets: budgetsToApply });
      UI.toast(`✓ Successfully set ${res.count || budgetsToApply.length} category budgets!`, 'success');
      this.closeAutoBudgetPlanner();
      await this.loadBudgets();
    } catch (e) {
      console.error('Apply budgets error:', e);
      UI.toast('Failed to apply budgets: ' + (e.message || 'Error'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply Selected Budgets'; }
    }
  },

  async applySingleBudget(idx) {
    if (!this._budgetSuggestions || !this._budgetSuggestions[idx]) return;
    const s = this._budgetSuggestions[idx];
    const inp = document.getElementById(`abInput_${idx}`);
    const limit = inp ? parseFloat(inp.value) : s.suggestedLimit;
    if (!limit || limit <= 0) {
      UI.toast('Please enter a valid monthly limit', 'error');
      return;
    }

    try {
      await API.post('/budgets', { category: s.category, monthly_limit: limit });
      UI.toast(`✓ Saved budget for ${s.category}: ${fmt(limit)}`, 'success');
      const prevEl = inp.parentElement?.parentElement?.querySelector('.ab-prev-limit');
      if (prevEl) prevEl.textContent = `Current: ${fmt(limit)}`;
      await this.loadBudgets();
    } catch (e) {
      UI.toast('Failed to save budget: ' + (e.message || 'Error'), 'error');
    }
  }
};

export default BudgetsModule;
