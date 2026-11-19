export const Tags = {
  pills: [],
  known: [],
  activeSuggestion: -1,

  async init() {
    try { this.known = await API.get('/tags'); } catch { this.known = []; }
    this.populateFilterSelect();

    const input = document.getElementById('tagInput');
    const box = document.getElementById('tagSuggestions');
    if (!input) return;

    input.addEventListener('input', () => this.showSuggestions(input.value));
    input.addEventListener('keydown', e => {
      const items = box ? [...box.querySelectorAll('.tag-suggestion-item')] : [];
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        this.activeSuggestion = Math.min(this.activeSuggestion + 1, items.length - 1);
        this.highlightSuggestion(items);
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault();
        this.activeSuggestion = Math.max(this.activeSuggestion - 1, 0);
        this.highlightSuggestion(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.activeSuggestion >= 0 && items[this.activeSuggestion]) {
          this.addPill(items[this.activeSuggestion].textContent);
        } else if (input.value.trim()) {
          this.addPill(input.value);
        }
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
      } else if (e.key === 'Backspace' && !input.value && this.pills.length) {
        this.removePill(this.pills.length - 1);
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#tagInputWrap')) this.hideSuggestions();
    });
  },

  populateFilterSelect() {
    const sel = document.getElementById('filterTag');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Tags</option>' +
      this.known.map(t => `<option value="${escapeHtml(t)}">#${escapeHtml(t)}</option>`).join('');
    sel.value = current;
  },

  showSuggestions(query) {
    const box = document.getElementById('tagSuggestions');
    if (!box) return;
    const q = query.trim().toLowerCase();
    this.activeSuggestion = -1;
    const matches = this.known
      .filter(t => !this.pills.includes(t) && (!q || t.includes(q)))
      .slice(0, 8);
    if (!matches.length) { this.hideSuggestions(); return; }
    box.innerHTML = matches.map(t => `<div class="tag-suggestion-item">${escapeHtml(t)}</div>`).join('');
    box.classList.add('show');
    box.querySelectorAll('.tag-suggestion-item').forEach(el =>
      el.addEventListener('mousedown', ev => { ev.preventDefault(); this.addPill(el.textContent); }));
  },

  highlightSuggestion(items) {
    items.forEach((el, idx) => el.classList.toggle('active', idx === this.activeSuggestion));
  },

  hideSuggestions() {
    const box = document.getElementById('tagSuggestions');
    box?.classList.remove('show');
    this.activeSuggestion = -1;
  },

  addPill(raw) {
    const tag = raw.trim().toLowerCase().slice(0, 30);
    const input = document.getElementById('tagInput');
    if (input) input.value = '';
    this.hideSuggestions();
    if (!tag || this.pills.includes(tag) || this.pills.length >= 15) return;
    this.pills.push(tag);
    if (!this.known.includes(tag)) this.known.push(tag);
    this.renderPills();
  },

  removePill(index) {
    this.pills.splice(index, 1);
    this.renderPills();
  },

  renderPills() {
    const el = document.getElementById('tagPills');
    if (!el) return;
    el.innerHTML = this.pills.map((t, idx) => `
      <span class="tag-pill">#${escapeHtml(t)}
        <button type="button" class="tag-pill-remove" data-tag-idx="${idx}" aria-label="Remove tag ${escapeHtml(t)}">×</button>
      </span>`).join('');
    el.querySelectorAll('.tag-pill-remove').forEach(btn =>
      btn.addEventListener('click', () => this.removePill(parseInt(btn.dataset.tagIdx))));
  },

  setPills(tags) {
    this.pills = [...(tags || [])];
    this.renderPills();
    const input = document.getElementById('tagInput');
    if (input) input.value = '';
    this.hideSuggestions();
  },

  getPills() { return [...this.pills]; }
};

if (typeof window !== 'undefined') {
  window.Tags = Tags;
}

export default Tags;
