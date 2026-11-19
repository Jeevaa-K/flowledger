export const SubscriptionsModule = {
  async loadSubscriptions() {
    if (typeof Recurring !== 'undefined' && typeof Recurring.load === 'function') {
      return await Recurring.load();
    }
  },

  async initSubscriptions() {
    if (typeof Recurring !== 'undefined' && typeof Recurring.init === 'function') {
      return await Recurring.init();
    }
  },

  async detectSubscriptions(manual = false) {
    if (typeof Recurring !== 'undefined' && typeof Recurring.detectSubscriptions === 'function') {
      return await Recurring.detectSubscriptions(manual);
    }
  }
};

export default SubscriptionsModule;
