// ── Application State Module ──────────────────────────────────
export const State = {
  page: 'dashboard',
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  transactions: [],
  summary: {},
  goals: [],
  accounts: [],
  txnPage: 1,
  txnPageSize: 50,
  txnTotal: 0,
  aiModel: (localStorage.getItem('fl_ai_model') === 'chatgpt' || localStorage.getItem('fl_ai_model') === 'claude') ? 'llama' : (localStorage.getItem('fl_ai_model') || 'llama'),
  aiSessionId: null,
  aiSessions: [],
  cashflowDays: 30,
  cashflowAccountId: null,
  cashflowData: null
};

if (typeof window !== 'undefined') {
  window.State = State;
}

export default State;
