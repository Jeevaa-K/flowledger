const Importer = {
  parsed: [],

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

    // Click to browse
    dropzone.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('csvFileInput').click();
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
        date: this.parseDate(row.date || row.txn_date || row.transaction_date || '')
      });
    }

    console.log('✅ Parsed rows:', rows.length);
    if (!rows.length) { UI.toast('⚠ No valid rows found. Check your CSV format.', 'error'); return; }

    this.parsed = rows;
    this.showPreview(rows);
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

  parseDate(s) {
    if (!s) return new Date().toISOString().slice(0, 10);
    s = s.trim().replace(/"/g, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split('/');
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      const p = s.split('/');
      return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
    }
    if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
      const [d, m, y] = s.split('-');
      return `${y}-${m}-${d}`;
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
              ${r.type==='income'?'+':'-'}₹${r.amount.toLocaleString('en-IN')}
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
      const result = await API.post('/transactions/import', { transactions: this.parsed });
      UI.toast(`✓ Imported ${result.imported} transactions!`, 'success');
      this.parsed = [];
      const section = document.getElementById('importPreviewSection');
      const preview = document.getElementById('csvPreview');
      const fi      = document.getElementById('csvFileInput');
      if (section) section.style.display = 'none';
      if (preview) preview.innerHTML = '';
      if (fi)      fi.value = '';
      if (btn)     { btn.textContent = 'Import All'; btn.disabled = true; }
    } catch(e) {
      UI.toast('Error: ' + e.message, 'error');
      if (btn) { btn.textContent = 'Import All'; btn.disabled = false; }
    }
  }
};
