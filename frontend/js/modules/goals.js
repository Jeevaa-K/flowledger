import { State } from './state.js';

export const GoalsModule = {
  async loadGoals() {
    try {
      State.goals = await API.get('/goals');
      UI.renderGoals(State.goals);
    } catch (e) {
      console.error('Load goals error:', e);
      UI.toast('Could not load goals', 'error');
    }
  },

  async saveGoal() {
    const nameEl = document.getElementById('goalName');
    const targetEl = document.getElementById('goalTarget');
    const savedEl = document.getElementById('goalSaved');
    const dateEl = document.getElementById('goalDate');
    const editIdEl = document.getElementById('goalEditId');
    if (!nameEl || !targetEl || !savedEl || !dateEl || !editIdEl) { UI.toast('Something went wrong loading the form', 'error'); return; }

    const name = nameEl.value.trim();
    const target = parseFloat(targetEl.value);
    const saved = parseFloat(savedEl.value) || 0;
    const date = dateEl.value;
    const editId = editIdEl.value;
    if (!name || !target) { UI.toast('Fill in goal name and target', 'error'); return; }

    const btn = document.getElementById('saveGoalBtn');
    if (btn) btn.disabled = true;
    try {
      if (editId) {
        await API.put(`/goals/${editId}`, { name, target, saved, date });
        UI.toast('Goal updated', 'success');
      } else {
        await API.post('/goals', { name, target, saved, date });
        UI.toast('Goal added', 'success');
      }
      UI.closeGoalModal();
      await this.loadGoals();
    } catch (e) {
      UI.toast('' + e.message.replace(/^\d+:\s*/, ''), 'error');
    } finally { if (btn) btn.disabled = false; }
  },

  editGoal(id) {
    const goal = State.goals.find(g => g.id === id);
    if (goal) UI.openGoalModal(goal);
  },

  addSavings(id) {
    const goal = State.goals.find(g => g.id === id);
    if (!goal) return;
    UI.openAddSavingsModal(goal);
  },

  async submitSavingsDeposit() {
    const goalId = parseInt(document.getElementById('asGoalId')?.value);
    const goal = State.goals.find(g => g.id === goalId);
    if (!goal) {
      UI.toast('Goal not found', 'error');
      return;
    }

    const amtInput = document.getElementById('asAmount');
    const amount = parseFloat(amtInput?.value);
    if (!amount || isNaN(amount) || amount <= 0) {
      UI.toast('Please enter a valid amount greater than 0', 'error');
      amtInput?.focus();
      return;
    }

    const mode = UI.savingsMode || 'deposit';
    const isDeposit = mode === 'deposit';
    const currentSaved = Number(goal.saved) || 0;
    const target = Number(goal.target) || 0;

    if (!isDeposit && amount > currentSaved) {
      UI.toast(`Cannot withdraw more than saved balance (${fmt(currentSaved)})`, 'error');
      return;
    }

    const newSaved = isDeposit ? (currentSaved + amount) : Math.max(0, currentSaved - amount);
    const dateVal = document.getElementById('asDate')?.value || new Date().toISOString().slice(0, 10);
    const noteVal = document.getElementById('asNote')?.value.trim();
    const accountVal = document.getElementById('asSourceAccount')?.value;
    const logTxn = document.getElementById('asLogTxn')?.checked;

    const btn = document.getElementById('asSubmitBtn');
    if (btn) {
      btn.disabled = true;
      btn.dataset.origText = btn.textContent;
      btn.textContent = 'Processing...';
    }

    try {
      await API.put(`/goals/${goal.id}`, {
        name: goal.name,
        target: goal.target,
        saved: newSaved,
        date: goal.date
      });

      if (logTxn) {
        const txnDescription = noteVal || (isDeposit ? `Savings: ${goal.name}` : `Withdrawal: ${goal.name}`);
        const txnType = isDeposit ? 'expense' : 'income';
        const txnCategory = isDeposit ? 'Investment' : 'Savings';
        const accountId = accountVal ? parseInt(accountVal) : null;

        await API.post('/transactions', {
          description: txnDescription,
          amount: amount,
          type: txnType,
          category: txnCategory,
          date: dateVal,
          account_id: accountId
        });
      }

      const newPct = target > 0 ? Math.min(Math.round((newSaved / target) * 100), 100) : 0;
      if (isDeposit && newSaved >= target) {
        UI.toast(`Congratulations! You reached your goal for "${goal.name}"!`, 'success');
      } else if (isDeposit) {
        UI.toast(`Added ${fmt(amount)} to "${goal.name}" (${newPct}% reached)`, 'success');
      } else {
        UI.toast(`Withdrew ${fmt(amount)} from "${goal.name}" (${newPct}% remaining)`, 'success');
      }

      UI.closeAddSavingsModal();

      await this.loadGoals();
      if (logTxn) {
        if (typeof this.loadAccounts === 'function') await this.loadAccounts();
        if (typeof this.loadDashboard === 'function') await this.loadDashboard();
        if (State.page === 'transactions' && typeof this.loadTransactions === 'function') await this.loadTransactions();
      }
    } catch (e) {
      UI.toast('' + e.message.replace(/^\d+:\s*/, ''), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.origText || 'Deposit Savings';
      }
    }
  },

  async deleteGoal(id) {
    if (!confirm('Delete this goal?')) return;
    try {
      await API.del(`/goals/${id}`);
      UI.toast('Goal removed', 'success');
      await this.loadGoals();
    } catch (e) {
      UI.toast('' + e.message.replace(/^\d+:\s*/, ''), 'error');
    }
  }
};

export default GoalsModule;
