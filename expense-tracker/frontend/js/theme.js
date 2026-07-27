const Theme = {
  current: 'light',

  init() {
    const saved = localStorage.getItem('fl_theme') || 'light';
    this.apply(saved);
  },

  apply(theme) {
    this.current = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fl_theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  },

  toggle() {
    this.apply(this.current === 'dark' ? 'light' : 'dark');
  }
};

// Apply theme immediately before render
Theme.init();
