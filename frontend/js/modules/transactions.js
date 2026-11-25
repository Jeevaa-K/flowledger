import { State } from './state.js';

export const TransactionsModule = {
  async loadTransactions(filters = {}, resetPage = true) {
    const list = document.getElementById('allTxns');
    list?.classList.add('is-fetching');
    if (resetPage) State.txnPage = 1;
    try {
      const qs = new URLSearchParams();
      if (filters.type) qs.set('type', filters.type);
      if (filters.category) qs.set('category', filters.category);
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.account_id) qs.set('account_id', filters.account_id);
      if (filters.tag) qs.set('tag', filters.tag);
      if (filters.search) qs.set('search', filters.search);
      if (filters.min_amount) qs.set('min_amount', filters.min_amount);
      if (filters.max_amount) qs.set('max_amount', filters.max_amount);
      if (filters.sort) qs.set('sort', filters.sort);
      qs.set('limit', State.txnPageSize);
      qs.set('page', State.txnPage);
      const { data: txns, total } = await API.getWithCount('/transactions?' + qs);
      State.transactions = txns;
      State.txnTotal = total;
      State.lastTxnFilters = filters;
      UI.renderTxnList(txns, 'allTxns', null, true);
      this.renderTxnPagination();
      this.updateTxnFilterResultsBar(filters, total, txns);
    } catch { UI.toast('Error loading transactions', 'error'); }
    finally { list?.classList.remove('is-fetching'); }
  },

  renderTxnPagination() {
    const totalPages = Math.max(Math.ceil(State.txnTotal / State.txnPageSize), 1);
    const label = document.getElementById('txnPageLabel');
    const prev = document.getElementById('txnPrevPage');
    const next = document.getElementById('txnNextPage');
    if (label) label.textContent = `Page ${State.txnPage} of ${totalPages} (${State.txnTotal} total)`;
    if (prev) prev.disabled = State.txnPage <= 1;
    if (next) next.disabled = State.txnPage >= totalPages;
  },

  async saveTxn() {
    const descEl = document.getElementById('txnDesc');
    const amtEl = document.getElementById('txnAmount');
    const dateEl = document.getElementById('txnDate');
    const catEl  = document.getElementById('txnCategory');
    const accEl  = document.getElementById('txnAccount');
    if (!descEl || !amtEl || !dateEl) { UI.toast('Something went wrong loading the form', 'error'); return; }

    const desc       = descEl.value.trim();
    const amount     = parseFloat(amtEl.value);
    const date       = dateEl.value;
    const type       = UI.currentType;
    const account_id = accEl?.value || null;
    const tags       = typeof Tags !== 'undefined' && Tags.getPills ? Tags.getPills() : [];
    if (!desc || !amount || !date) { UI.toast('Fill in description, amount, and date', 'error'); return; }
    if (amount <= 0) { UI.toast('Amount must be greater than 0', 'error'); return; }

    // Handle Split Transaction Mode
    if (UI.isSplitMode) {
      if (!Array.isArray(UI.splitRows) || UI.splitRows.length < 2) {
        UI.toast('Split requires at least 2 category parts', 'error');
        return;
      }
      let allocatedSum = 0;
      for (const s of UI.splitRows) {
        const pAmt = parseFloat(s.amount);
        if (!pAmt || isNaN(pAmt) || pAmt <= 0) {
          UI.toast(`Enter a valid amount for category "${s.category || 'Split'}"`, 'error');
          return;
        }
        if (!s.category) {
          UI.toast('Select a category for every split item', 'error');
          return;
        }
        allocatedSum += pAmt;
      }
      if (Math.abs(allocatedSum - amount) > 0.05) {
        UI.toast(`Split total (${typeof fmt === 'function' ? fmt(allocatedSum) : '₹' + allocatedSum.toFixed(2)}) must equal bill amount (${typeof fmt === 'function' ? fmt(amount) : '₹' + amount.toFixed(2)})`, 'error');
        return;
      }

      const btn = document.getElementById('saveTxnBtn');
      if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving Split...'; }
      try {
        await API.createSplitTransaction({
          description: desc,
          total_amount: amount,
          type,
          date,
          account_id,
          tags,
          splits: UI.splitRows
        });
        UI.toast(`Split transaction saved across ${UI.splitRows.length} categories!`, 'success');
        UI.closeAddModal();
        if (typeof this.updateNavCount === 'function') this.updateNavCount();
        if (typeof Tags !== 'undefined' && Tags.populateFilterSelect) Tags.populateFilterSelect();
        if (typeof this.loadAccounts === 'function') this.loadAccounts(State.page === 'accounts');
        if (typeof this.loadDashboard === 'function') await this.loadDashboard();
        if (typeof this.getTxnActiveFilters === 'function') {
          await this.loadTransactions(this.getTxnActiveFilters());
        } else {
          await this.loadTransactions();
        }
      } catch (err) {
        UI.toast(err.message || 'Failed to save split transaction', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save'; }
      }
      return;
    }

    // Standard Single Category Transaction
    const category = catEl?.value;
    if (!category) { UI.toast('Please select a category', 'error'); return; }

    const btn = document.getElementById('saveTxnBtn');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Saving...'; }
    try {
      let budgetToastShown = false;
      const currEl = document.getElementById('txnCurrency');
      const rateEl = document.getElementById('txnCustomRate');
      const currency = currEl?.value || undefined;
      const customRate = (rateEl?.value && !isNaN(parseFloat(rateEl.value))) ? parseFloat(rateEl.value) : undefined;

      if (UI.editId) {
        await API.put(`/transactions/${UI.editId}`, {
          description: desc,
          amount,
          type,
          category,
          date,
          account_id,
          tags,
          currency,
          original_amount: amount,
          exchange_rate: customRate
        });
        UI.toast('Transaction updated', 'success');
      } else {
        await API.post('/transactions', {
          description: desc,
          amount,
          type,
          category,
          date,
          account_id,
          tags,
          currency,
          original_amount: amount,
          exchange_rate: customRate
        });
        const isCurrentMonth = new Date(date).toISOString().slice(0,7) === new Date().toISOString().slice(0,7);
        if (type === 'expense' && isCurrentMonth) {
          budgetToastShown = await this.checkBudgetAfterSave(category);
        }
        if (!budgetToastShown) UI.toast('Transaction added', 'success');
      }
      UI.closeAddModal();
      if (typeof this.updateNavCount === 'function') this.updateNavCount();
      if (typeof Tags !== 'undefined' && Tags.populateFilterSelect) Tags.populateFilterSelect();
      if (typeof this.loadAccounts === 'function') this.loadAccounts(State.page === 'accounts');
      if (typeof this.loadDashboard === 'function') await this.loadDashboard();
      if (typeof this.getTxnActiveFilters === 'function') {
        await this.loadTransactions(this.getTxnActiveFilters());
      } else {
        await this.loadTransactions();
      }
    } catch(e) { UI.toast(e.message.match(/^\d+:/) ? 'Error: ' + e.message : e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Save'; } }
  },

  async checkBudgetAfterSave(category) {
    try {
      const budgets = await API.get('/budgets');
      const match = budgets.find(b => b.category === category);
      if (!match) return false;
      if (match.percent >= 100) {
        UI.toast(`Over budget for ${category} (${match.percent}%)`, 'error', 4000);
        return true;
      }
      if (match.percent >= 80) {
        UI.toast(`${category} budget at ${match.percent}%`, 'error', 3500);
        return true;
      }
      return false;
    } catch { return false; }
  },

  async editTxn(id) {
    try {
      const txn = await API.get(`/transactions/${id}`);
      UI.openAddModal(txn);
    } catch { UI.toast('Could not load transaction', 'error'); }
  },

  async deleteTxn(id) {
    try {
      const txn = await API.get(`/transactions/${id}`).catch(() => null);
      if (txn && txn.split_id) {
        if (confirm('This transaction is part of a split bill.\nClick OK to delete ALL parts of this split bill.')) {
          await API.deleteSplitGroup(txn.split_id);
          UI.toast('Deleted entire split group', 'success');
          if (typeof this.updateNavCount === 'function') this.updateNavCount();
          if (typeof this.loadAccounts === 'function') this.loadAccounts(State.page === 'accounts');
          if (State.page === 'transactions') await this.loadTransactions();
          else if (typeof this.loadDashboard === 'function') await this.loadDashboard();
        }
        return;
      }

      if (!confirm('Delete this transaction?')) return;
      await API.del(`/transactions/${id}`);
      UI.toast('Deleted', 'success');
      if (typeof this.updateNavCount === 'function') this.updateNavCount();
      if (typeof this.loadAccounts === 'function') this.loadAccounts(State.page === 'accounts');
      if (State.page === 'transactions') await this.loadTransactions();
      else if (typeof this.loadDashboard === 'function') await this.loadDashboard();
    } catch { UI.toast('Error deleting', 'error'); }
  },

  getTxnActiveFilters() {
    const searchVal = document.getElementById('txnLiveSearch')?.value?.trim() || '';
    const sortVal = document.getElementById('txnSortSelect')?.value || 'date_desc';
    const typeVal = document.getElementById('filterType')?.value || '';
    const catVal = document.getElementById('filterCategory')?.value || '';
    const accVal = document.getElementById('filterAccount')?.value || '';
    const tagVal = document.getElementById('filterTag')?.value || '';
    const fromVal = document.getElementById('filterFrom')?.value || '';
    const toVal = document.getElementById('filterTo')?.value || '';
    const minVal = document.getElementById('filterMinAmount')?.value || '';
    const maxVal = document.getElementById('filterMaxAmount')?.value || '';

    return {
      search: searchVal,
      sort: sortVal,
      type: typeVal,
      category: catVal,
      account_id: accVal,
      tag: tagVal,
      from: fromVal,
      to: toVal,
      min_amount: minVal,
      max_amount: maxVal
    };
  },

  updateTxnFilterResultsBar(filters, total, txns) {
    const bar = document.getElementById('txnResultsBar');
    const info = document.getElementById('txnResultsInfo');
    const badge = document.getElementById('advFilterBadge');
    if (!bar || !info) return;

    let activeAdvCount = 0;
    if (filters.type) activeAdvCount++;
    if (filters.category) activeAdvCount++;
    if (filters.account_id) activeAdvCount++;
    if (filters.tag) activeAdvCount++;
    if (filters.from || filters.to) activeAdvCount++;
    if (filters.min_amount || filters.max_amount) activeAdvCount++;

    if (badge) {
      badge.textContent = activeAdvCount;
      badge.style.display = activeAdvCount > 0 ? 'inline-flex' : 'none';
    }

    const hasFilters = Boolean(
      filters.search || activeAdvCount > 0 || (filters.sort && filters.sort !== 'date_desc')
    );

    if (!hasFilters) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    const parts = [];
    if (filters.search) parts.push(`matching "<strong>${escapeHtml(filters.search)}</strong>"`);
    if (filters.type) parts.push(`type: <strong>${escapeHtml(filters.type)}</strong>`);
    if (filters.category) parts.push(`category: <strong>${escapeHtml(filters.category)}</strong>`);
    if (filters.from && filters.to) parts.push(`date: <strong>${escapeHtml(filters.from)} to ${escapeHtml(filters.to)}</strong>`);
    else if (filters.from) parts.push(`after: <strong>${escapeHtml(filters.from)}</strong>`);
    else if (filters.to) parts.push(`before: <strong>${escapeHtml(filters.to)}</strong>`);
    if (filters.min_amount) parts.push(`min: <strong>₹${escapeHtml(filters.min_amount)}</strong>`);
    if (filters.max_amount) parts.push(`max: <strong>₹${escapeHtml(filters.max_amount)}</strong>`);

    const filterDesc = parts.length > 0 ? parts.join(', ') : 'Applied filters';
    const sumOnPage = (txns || []).reduce((acc, t) => acc + (t.type === 'expense' ? -parseFloat(t.amount) : parseFloat(t.amount)), 0);

    info.innerHTML = `Found <strong>${total}</strong> transaction${total === 1 ? '' : 's'} (${filterDesc}) • Page net: <strong>${fmt(sumOnPage)}</strong>`;
  },

  bindFilters() {
    let searchDebounceTimer = null;
    const searchInput = document.getElementById('txnLiveSearch');
    const clearSearchBtn = document.getElementById('txnClearSearch');
    const sortSelect = document.getElementById('txnSortSelect');
    const advToggleBtn = document.getElementById('toggleAdvFiltersBtn');
    const advDrawer = document.getElementById('txnAdvancedDrawer');
    const applyAdvBtn = document.getElementById('applyAdvFilters');
    const exportBtn = document.getElementById('exportTxnCsvBtn');
    const resetResultsBtn = document.getElementById('resetResultsBtn');

    const triggerSearch = () => {
      const filters = this.getTxnActiveFilters();
      this.loadTransactions(filters, true);
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'flex' : 'none';
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(triggerSearch, 250);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchDebounceTimer);
          triggerSearch();
        }
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        triggerSearch();
      });
    }

    sortSelect?.addEventListener('change', triggerSearch);

    const sortBtn    = document.getElementById('txnSortBtn');
    const sortMenu   = document.getElementById('txnSortMenu');
    const sortLabel  = document.getElementById('txnSortLabel');

    if (sortBtn && sortMenu && sortSelect) {
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sortMenu.style.display !== 'none';
        sortMenu.style.display = isOpen ? 'none' : 'block';
        sortBtn.setAttribute('aria-expanded', String(!isOpen));
      });

      sortMenu.querySelectorAll('.sort-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const val   = opt.dataset.sort;
          const label = opt.dataset.label;
          sortSelect.value = val;

          const btnIcon = sortBtn.querySelector('.sort-btn-icon');
          const optIcon = opt.querySelector('.sort-opt-icon');
          if (btnIcon && optIcon) btnIcon.innerHTML = optIcon.innerHTML;
          if (sortLabel) sortLabel.textContent = label;

          sortMenu.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');

          sortMenu.style.display = 'none';
          sortBtn.setAttribute('aria-expanded', 'false');
          triggerSearch();
        });
      });

      document.addEventListener('click', (e) => {
        if (!sortBtn.closest('#sortDropdownWrap')?.contains(e.target)) {
          sortMenu.style.display = 'none';
          sortBtn.setAttribute('aria-expanded', 'false');
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sortMenu.style.display !== 'none') {
          sortMenu.style.display = 'none';
          sortBtn.setAttribute('aria-expanded', 'false');
          sortBtn.focus();
        }
      });
    }

    advToggleBtn?.addEventListener('click', () => {
      if (!advDrawer) return;
      const isHidden = advDrawer.style.display === 'none';
      advDrawer.style.display = isHidden ? 'block' : 'none';
    });

    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const preset = chip.dataset.preset;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        ['filterType', 'filterCategory', 'filterAccount', 'filterTag', 'filterFrom', 'filterTo', 'filterMinAmount', 'filterMaxAmount'].forEach(id => setVal(id, ''));

        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

        if (preset === 'this_month') {
          setVal('filterFrom', `${y}-${m}-01`);
          setVal('filterTo', `${y}-${m}-${String(lastDay).padStart(2, '0')}`);
        } else if (preset === 'expense') {
          setVal('filterType', 'expense');
        } else if (preset === 'income') {
          setVal('filterType', 'income');
        } else if (preset === 'high_value') {
          setVal('filterMinAmount', '2000');
        } else if (preset === 'food') {
          setVal('filterCategory', 'Food');
        } else if (preset === 'shopping') {
          setVal('filterCategory', 'Shopping');
        } else if (preset === 'bills') {
          setVal('filterCategory', 'Bills');
        }

        triggerSearch();
      });
    });

    applyAdvBtn?.addEventListener('click', () => {
      triggerSearch();
      if (advDrawer) advDrawer.style.display = 'none';
    });

    ['filterType', 'filterCategory', 'filterAccount', 'filterTag', 'filterFrom', 'filterTo', 'filterMinAmount', 'filterMaxAmount'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', triggerSearch);
    });

    const clearAll = () => {
      ['filterType', 'filterCategory', 'filterAccount', 'filterTag', 'filterFrom', 'filterTo', 'filterMinAmount', 'filterMaxAmount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (searchInput) searchInput.value = '';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      if (sortSelect) sortSelect.value = 'date_desc';

      const firstOpt     = document.querySelector('#txnSortMenu .sort-option[data-sort="date_desc"]');
      const sortBtnIcon  = document.querySelector('#txnSortBtn .sort-btn-icon');
      const sortBtnLabel = document.getElementById('txnSortLabel');
      if (sortBtnLabel) sortBtnLabel.textContent = 'Newest First';
      if (sortBtnIcon && firstOpt) {
        const optIcon = firstOpt.querySelector('.sort-opt-icon');
        if (optIcon) sortBtnIcon.innerHTML = optIcon.innerHTML;
      }
      document.querySelectorAll('#txnSortMenu .sort-option').forEach(o => {
        o.classList.toggle('active', o.dataset.sort === 'date_desc');
      });

      document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
      document.querySelector('.quick-chip[data-preset="all"]')?.classList.add('active');

      this.loadTransactions({}, true);
    };

    const clearBtn = document.getElementById('clearFilters');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    resetResultsBtn?.addEventListener('click', clearAll);

    exportBtn?.addEventListener('click', async () => {
      const filters = this.getTxnActiveFilters();
      const qs = new URLSearchParams();
      if (filters.search) qs.set('search', filters.search);
      if (filters.type) qs.set('type', filters.type);
      if (filters.category) qs.set('category', filters.category);
      if (filters.account_id) qs.set('account_id', filters.account_id);
      if (filters.tag) qs.set('tag', filters.tag);
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.min_amount) qs.set('min_amount', filters.min_amount);
      if (filters.max_amount) qs.set('max_amount', filters.max_amount);
      if (filters.sort) qs.set('sort', filters.sort);

      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';
      try {
        const res = await fetch(`/api/transactions/export-csv?${qs}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transactions-export-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('Filtered transactions exported to CSV!', 'success');
      } catch (err) {
        UI.toast('Export error: ' + (err.message || 'Failed'), 'error');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export CSV';
      }
    });

    const prevBtn = document.getElementById('txnPrevPage');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (State.txnPage <= 1) return;
        State.txnPage--;
        this.loadTransactions(State.lastTxnFilters || {}, false);
      });
    }

    const nextBtn = document.getElementById('txnNextPage');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const totalPages = Math.max(Math.ceil(State.txnTotal / State.txnPageSize), 1);
        if (State.txnPage >= totalPages) return;
        State.txnPage++;
        this.loadTransactions(State.lastTxnFilters || {}, false);
      });
    }
  }
};

export default TransactionsModule;
