const Importer = {
  parsed: [],
  rawRows: [],       // holds {..., _rawDate} so changing date format can re-parse without re-reading the file
  dateFormat: 'auto', // 'auto' | 'dmy' | 'mdy'

  init() {
    // Always rebind — remove old listeners by cloning elements
    const oldDropzone = document.getElementById('csvDropzone');
    const oldInput    = document.getElementById('csvFileInput');
    if (!oldDropzone || !oldInput) return;

    // Clone to remove all old listeners
    const dropzone = oldDropzone.cloneNode(true);
    const fileInput = oldInput.cloneNode(true);
    oldDropzone.replaceWith(dropzone);
    oldInput.replaceWith(fileInput);

    // Date-format radios — re-parse in place when the user picks a format,
    // no need to re-read the file since rawRows keeps the original strings.
    document.querySelectorAll('input[name="dateFormat"]').forEach(el => {
      el.addEventListener('change', () => {
        this.dateFormat = document.querySelector('input[name="dateFormat"]:checked')?.value || 'auto';
        this.reparseDates();
      });
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleFile(file);
    });

    // Drag and drop
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });

    // Click to browse. The file input now lives OUTSIDE the dropzone in the
    // DOM (previously nested inside it), so this click can never bubble
    // back into a listener on the input itself — no double-open risk.
    // Uses the `fileInput` reference from this same init() call (not a
    // fresh getElementById) so it's guaranteed to be the element that
    // actually has the change listener bound just above.
    dropzone.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    console.log('✅ Importer initialized');
  },

  handleFile(file) {
    console.log('📂 File received:', file.name, file.size);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      UI.toast('⚠ Please upload a .csv file', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => this.parseCSV(e.target.result);
    reader.onerror = () => UI.toast('⚠ Could not read file', 'error');
    reader.readAsText(file);
  },

  parseCSV(text) {
    console.log('📊 Parsing CSV, length:', text.length);
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      UI.toast('⚠ CSV has no data rows', 'error');
      return;
    }

    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    console.log('Headers found:', headers);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = this.splitLine(lines[i]);
      const row  = {};
      headers.forEach((h, idx) => row[h] = (vals[idx] || '').trim().replace(/"/g, ''));

      const amount = Math.abs(parseFloat(
        row.amount || row.debit || row.credit || row.value || 0
      ));
      if (!amount || isNaN(amount)) continue;

      rows.push({
        description: row.description || row.desc || row.name || row.narration || row.particulars || `Row ${i}`,
        amount,
        type: this.detectType(row),
        category: row.category || 'Other',
        _rawDate: row.date || row.txn_date || row.transaction_date || ''
      });
    }

    console.log('✅ Parsed rows:', rows.length);
    if (!rows.length) { UI.toast('⚠ No valid rows found. Check your CSV format.', 'error'); return; }

    this.rawRows = rows;
    this.dateFormat = 'auto';
    const auto = document.querySelector('input[name="dateFormat"][value="auto"]');
    if (auto) auto.checked = true;
    this.reparseDates();
  },

  // Re-derives `date` on every row from `_rawDate` using the currently
  // selected format. Called on initial parse and whenever the user
  // switches the date-format radio, so no re-read of the file is needed.
  reparseDates() {
    const rows = this.rawRows.map(r => ({ ...r, date: this.parseDate(r._rawDate) }));
    this.parsed = rows;
    this.updateAmbiguityWarning();
    this.showPreview(rows);
  },

  // A slash-separated date like 03/04/2025 is ambiguous only when BOTH
  // parts could be a day (i.e. both ≤ 12) — 25/03/2025 is unambiguous
  // (25 can't be a month) and doesn't need a warning.
  isAmbiguousDate(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec((s || '').trim());
    if (!m) return false;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    return a <= 12 && b <= 12 && a !== b;
  },

  updateAmbiguityWarning() {
    const warning = document.getElementById('dateFormatWarning');
    if (!warning) return;
    const anyAmbiguous = this.rawRows.some(r => this.isAmbiguousDate(r._rawDate));
    warning.style.display = anyAmbiguous ? 'block' : 'none';
  },

  detectType(row) {
    if (row.type) {
      const t = row.type.toLowerCase().trim();
      if (t === 'income' || t === 'credit') return 'income';
      return 'expense';
    }
    if (parseFloat(row.credit) > 0 && !parseFloat(row.debit)) return 'income';
    return 'expense';
  },

  splitLine(line) {
    const result = []; let cur = ''; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur);
    return result;
  },

  // format: 'auto' (day-first when ambiguous — matches most non-US bank
  // exports), 'dmy' (always day/month/year), or 'mdy' (always month/day/
  // year, US-style). ISO (YYYY-MM-DD) and DD-MM-YYYY are unambiguous and
  // ignore the format setting.
  parseDate(s, format = this.dateFormat) {
    if (!s) return new Date().toISOString().slice(0, 10);
    s = s.trim().replace(/"/g, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
      const [d, m, y] = s.split('-');
      return `${y}-${m}-${d}`;
    }
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (slash) {
      let [, a, b, y] = slash;
      // a/b are ambiguous when both ≤ 12 unless the user picked a format.
      // If one side is > 12 it can only be the day, regardless of format.
      const aNum = parseInt(a, 10), bNum = parseInt(b, 10);
      let day, month;
      if (aNum > 12)      { day = a; month = b; }        // a can't be a month
      else if (bNum > 12) { day = b; month = a; }        // b can't be a month
      else if (format === 'mdy') { month = a; day = b; }
      else                { day = a; month = b; }         // 'auto' and 'dmy' both default day-first
      return `${y}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    }
    try { const d = new Date(s); if (!isNaN(d)) return d.toISOString().slice(0,10); } catch {}
    return new Date().toISOString().slice(0, 10);
  },

  showPreview(rows) {
    const section = document.getElementById('importPreviewSection');
    const preview = document.getElementById('csvPreview');
    const btn     = document.getElementById('importBtn');
    if (section) section.style.display = 'block';
    if (!preview) return;

    preview.innerHTML = `
      <div class="import-summary">✅ Found <strong>${rows.length}</strong> transactions ready to import</div>
      <div style="max-height:280px;overflow-y:auto;margin-top:10px">
        ${rows.slice(0, 15).map(r => `
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #EFE8D8">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.description}</div>
              <div style="font-size:11px;color:#A79C8C">${r.category} · ${r.date} · ${r.type}</div>
            </div>
            <div style="font-size:13px;font-family:monospace;font-weight:600;color:${r.type==='income'?'#3E6154':'#A6402F'};flex-shrink:0">
              ${r.type==='income'?'+':'-'}${fmt(r.amount)}
            </div>
          </div>`).join('')}
        ${rows.length > 15 ? `<div style="text-align:center;padding:10px;color:#A79C8C;font-size:12px">...and ${rows.length-15} more</div>` : ''}
      </div>`;

    if (btn) btn.disabled = false;
  },

  async importAll() {
    if (!this.parsed.length) { UI.toast('⚠ No transactions to import', 'error'); return; }
    const btn = document.getElementById('importBtn');
    if (btn) { btn.textContent = 'Importing...'; btn.disabled = true; }
    try {
      const accEl = document.getElementById('importAccount');
      const result = await API.post('/transactions/import', { transactions: this.parsed, account_id: accEl?.value || null });
      const skipped = result.skipped || 0;
      UI.toast(
        skipped > 0
          ? `✓ Imported ${result.imported}, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`
          : `✓ Imported ${result.imported} transactions!`,
        'success', skipped > 0 ? 4000 : 2800
      );
      App.loadAccounts(State.page === 'accounts');
      this.parsed = [];
      this.rawRows = [];
      const section = document.getElementById('importPreviewSection');
      const preview = document.getElementById('csvPreview');
      const fi      = document.getElementById('csvFileInput');
      const warning = document.getElementById('dateFormatWarning');
      if (section) section.style.display = 'none';
      if (preview) preview.innerHTML = '';
      if (fi)      fi.value = '';
      if (warning) warning.style.display = 'none';
      if (btn)     { btn.textContent = 'Import All'; btn.disabled = true; }
    } catch(e) {
      UI.toast('Error: ' + e.message, 'error');
      if (btn) { btn.textContent = 'Import All'; btn.disabled = false; }
    }
  }
};