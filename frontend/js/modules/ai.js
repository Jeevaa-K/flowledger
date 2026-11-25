import { State } from './state.js';

export const AIModule = {
  AI_WELCOME_HTML: `
    <div class="chat-msg assistant">
      <div class="msg-avatar">AI</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <strong>Welcome to your AI Financial Advisor!</strong><br><br>
          Powered by open-source models with free Groq API keys. I have full context of your financial transactions, accounts, and group splits. Choose your preferred AI engine above:
          <ul style="margin: 8px 0 0 18px; line-height: 1.6;">
            <li><strong>Strategic AI</strong>: Proactive wealth strategies, income compounding, and personalized advisory.</li>
            <li><strong>Deep Reasoning</strong>: Methodical budget scrutiny, expense audits, and structured reasoning.</li>
            <li><strong>Groq Fast</strong>: Instant, rapid queries and balance math.</li>
          </ul>
        </div>
        <div class="msg-time">Just now</div>
      </div>
    </div>`,

  formatMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^\s*[-•*]\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    return html;
  },

  async loadAI() {
    if (typeof this.updateAIStats === 'function') this.updateAIStats(State.summary);
    this.selectAiModel(State.aiModel);
    await this.loadAiSessions();

    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (State.aiSessionId) {
      await this.switchAiSession(State.aiSessionId);
    } else {
      container.innerHTML = this.AI_WELCOME_HTML;
    }
  },

  async loadAiSessions() {
    const listEl = document.getElementById('aiSessionList');
    const badgeEl = document.getElementById('aiSessionCount');
    if (!listEl) return;
    try {
      const sessions = await API.get('/ai/sessions');
      State.aiSessions = sessions || [];
      if (badgeEl) badgeEl.textContent = State.aiSessions.length;
      if (!State.aiSessions.length) {
        listEl.innerHTML = '<div class="ai-session-empty">No saved chats yet.</div>';
        return;
      }

      listEl.innerHTML = State.aiSessions.map(s => {
        const isActive = State.aiSessionId === s.id;
        const icon = (s.model === 'deepseek' || s.model === 'claude') ? 'AI' : s.model === 'fast' ? 'AI' : 'AI';
        const d = s.updated_at ? new Date(s.updated_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : '';
        return `
          <div class="ai-session-item ${isActive ? 'active' : ''}" data-session-id="${s.id}">
            <div class="ai-session-meta">
              <div class="ai-session-title">${icon} ${escapeHtml(s.title || 'Conversation')}</div>
              <div class="ai-session-date">${d} · ${s.message_count || 0} msgs</div>
            </div>
            <button class="ai-session-del" data-action="del-session" data-session-id="${s.id}" title="Delete conversation">✕</button>
          </div>`;
      }).join('');

      listEl.querySelectorAll('.ai-session-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.ai-session-del')) return;
          this.switchAiSession(parseInt(item.dataset.sessionId));
        });
      });

      listEl.querySelectorAll('.ai-session-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteAiSession(parseInt(btn.dataset.sessionId));
        });
      });
    } catch (e) {
      console.warn('Could not load AI sessions:', e);
    }
  },

  async switchAiSession(sessionId) {
    State.aiSessionId = sessionId;
    const session = State.aiSessions.find(s => s.id === sessionId);
    if (session && session.model) {
      this.selectAiModel(session.model);
    }
    const titleEl = document.getElementById('chatSessionTitle');
    if (titleEl) titleEl.textContent = session ? session.title : 'Conversation';

    document.querySelectorAll('.ai-session-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.sessionId) === sessionId);
    });

    const c = document.getElementById('chatMessages');
    if (c) c.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px">Loading conversation...</div>';

    try {
      const data = await API.get(`/ai/sessions/${sessionId}`);
      c.innerHTML = '';
      if (!data.messages || !data.messages.length) {
        c.innerHTML = this.AI_WELCOME_HTML;
        return;
      }
      data.messages.forEach(m => this.appendMsg(m.role, m.content, m.model || State.aiModel));
      c.scrollTop = c.scrollHeight;
    } catch (e) {
      UI.toast('Failed to load chat: ' + e.message, 'error');
    }
  },

  startNewAiChat() {
    State.aiSessionId = null;
    const titleEl = document.getElementById('chatSessionTitle');
    if (titleEl) titleEl.textContent = 'New Conversation';
    document.querySelectorAll('.ai-session-item').forEach(el => el.classList.remove('active'));
    const c = document.getElementById('chatMessages');
    if (c) c.innerHTML = this.AI_WELCOME_HTML;
    document.getElementById('chatInput')?.focus();
  },

  async deleteAiSession(sessionId) {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      await API.del(`/ai/sessions/${sessionId}`);
      if (State.aiSessionId === sessionId) {
        this.startNewAiChat();
      }
      await this.loadAiSessions();
      UI.toast('Conversation deleted', 'success');
    } catch (e) {
      UI.toast('Failed to delete: ' + e.message, 'error');
    }
  },

  selectAiModel(model) {
    State.aiModel = model;
    localStorage.setItem('fl_ai_model', model);

    document.querySelectorAll('.ai-model-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.model === model);
    });

    const banner = document.getElementById('chatModelBanner');
    const label = document.getElementById('chatModelLabel');
    if (banner) {
      banner.className = `chat-model-banner ${model}`;
    }
    if (label) {
      if (model === 'deepseek' || model === 'claude') label.textContent = 'Deep Reasoning Mode';
      else if (model === 'fast') label.textContent = 'Groq Fast Mode';
      else label.textContent = 'Strategic AI Mode';
    }
  },

  appendMsg(role, content, model = null) {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    const isAssistant = role === 'assistant';
    const activeModel = model || State.aiModel;
    const avatarText = isAssistant ? ((activeModel === 'deepseek' || activeModel === 'claude') ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0h10m-10 0a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2m-10 0V9m10 5V9m0 0H9"/></svg>' : activeModel === 'fast' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="15" x2="8.01" y2="15"/><line x1="16" y1="15" x2="16.01" y2="15"/></svg>') : 'You';
    const formattedHtml = isAssistant ? this.formatMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>');

    const d = document.createElement('div');
    d.className = `chat-msg ${role}`;
    d.innerHTML = `
      <div class="msg-avatar">${avatarText}</div>
      <div class="msg-content">
        <div class="msg-bubble">${formattedHtml}</div>
        <div class="msg-meta-row">
          <div class="msg-time">${new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</div>
          ${isAssistant ? `<button type="button" class="msg-copy-btn" title="Copy response">Copy</button>` : ''}
        </div>
      </div>`;

    if (isAssistant) {
      const copyBtn = d.querySelector('.msg-copy-btn');
      copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        }).catch(() => UI.toast('Copy failed', 'error'));
      });
    }

    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },

  appendTyping() {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    const activeModel = State.aiModel;
    const avatarText = (activeModel === 'deepseek' || activeModel === 'claude') ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0h10m-10 0a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2m-10 0V9m10 5V9m0 0H9"/></svg>' : activeModel === 'fast' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="15" x2="8.01" y2="15"/><line x1="16" y1="15" x2="16.01" y2="15"/></svg>';
    const d = document.createElement('div');
    d.className = 'chat-msg assistant'; d.id = 'typingIndicator';
    d.innerHTML = `
      <div class="msg-avatar">${avatarText}</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },

  async sendChat(msg) {
    if (!msg || !msg.trim()) return;
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSend');
    if (input) input.value = '';
    if (btn) btn.disabled = true;

    this.appendMsg('user', msg);
    this.appendTyping();

    try {
      const res = await API.post('/ai/chat', {
        message: msg,
        model: State.aiModel,
        session_id: State.aiSessionId
      });
      document.getElementById('typingIndicator')?.remove();

      if (res && res.session_id && !State.aiSessionId) {
        State.aiSessionId = res.session_id;
        await this.loadAiSessions();
      }
      this.appendMsg('assistant', res.reply, res.model || State.aiModel);

      if (res.action?.type === 'transaction_proposed' && res.action.transaction) {
        UI.openAddModal(res.action.transaction);
        UI.toast('Review and confirm the proposed transaction', 'info');
      }
    } catch(e) {
      document.getElementById('typingIndicator')?.remove();
      this.appendMsg('assistant', 'Error: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
      input?.focus();
    }
  },

  bindChat() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSend');
    btn?.addEventListener('click', () => this.sendChat(input.value));
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChat(input.value);
      }
    });

    document.querySelectorAll('.ai-model-btn').forEach(b => {
      b.addEventListener('click', () => {
        this.selectAiModel(b.dataset.model);
      });
    });

    const newBtn = document.getElementById('newChatBtn');
    if (newBtn) newBtn.addEventListener('click', () => this.startNewAiChat());

    document.querySelectorAll('.sug-btn').forEach(b => b.addEventListener('click', () => this.sendChat(b.dataset.prompt)));

    const clearBtn = document.getElementById('clearChat');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        clearBtn.disabled = true;
        try {
          if (State.aiSessionId) {
            await API.del(`/ai/sessions/${State.aiSessionId}`);
            await this.loadAiSessions();
          } else {
            await API.del('/ai/history');
          }
          this.startNewAiChat();
          UI.toast('✓ Chat cleared', 'success');
        } catch (e) {
          UI.toast('Could not clear chat: ' + e.message.replace(/^\d+:\s*/, ''), 'error');
        } finally {
          clearBtn.disabled = false;
        }
      });
    }
  },

  bindVoiceInput() {
    const micBtn = document.getElementById('voiceQuickBtn');
    const input  = document.getElementById('aiQuickInput');
    if (!micBtn || !input) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      micBtn.title = 'Voice input requires Chrome, Edge, or Safari';
      micBtn.addEventListener('click', () => {
        UI.toast('Voice input is supported in Chrome, Edge, and Safari.', 'error');
      });
      return;
    }

    let isListening = false;

    function createRecognition() {
      const rec = new SpeechRec();
      rec.continuous     = false;
      rec.interimResults = true;
      rec.lang           = navigator.language || 'en-IN';

      rec.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        micBtn.title = 'Click to stop listening';
        input.placeholder = 'Listening… say your transaction (e.g. "Spent ₹450 on lunch today")';
        UI.toast('Listening — speak your transaction now', 'info');
      };

      rec.onresult = (event) => {
        let interim = '';
        let final   = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        input.value = final || interim;
      };

      rec.onerror = (event) => {
        isListening = false;
        micBtn.classList.remove('listening');
        micBtn.title = 'Click to speak';
        input.placeholder = 'Enter transaction details...';
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          UI.toast('Microphone access denied — please allow it in your browser settings.', 'error');
        } else if (event.error === 'network') {
          UI.toast('Network error during voice recognition. Check your connection.', 'error');
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          UI.toast(`Voice error: ${event.error}`, 'error');
        }
      };

      rec.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        micBtn.title = 'Click to speak';
        input.placeholder = 'Enter transaction details...';
        const transcript = input.value.trim();
        if (transcript) {
          UI.toast(`Heard: "${transcript}"`, 'success');
          const quickBtn = document.getElementById('aiQuickSubmitBtn');
          setTimeout(() => quickBtn?.click(), 300);
        }
      };

      return rec;
    }

    micBtn.addEventListener('click', () => {
      if (isListening) {
        isListening = false;
        try { micBtn._rec?.stop(); } catch (_) {}
      } else {
        const rec = createRecognition();
        micBtn._rec = rec;
        try {
          rec.start();
        } catch (err) {
          isListening = false;
          micBtn.classList.remove('listening');
          console.warn('Voice start error:', err);
          UI.toast('Could not start voice input. Try refreshing the page.', 'error');
        }
      }
    });
  },

  bindAISmartTools() {
    const quickInput = document.getElementById('aiQuickInput');
    const quickBtn = document.getElementById('aiQuickSubmitBtn');

    const handleQuickAdd = async () => {
      const text = quickInput?.value?.trim();
      if (!text) {
        UI.toast('Please enter a transaction sentence or paste bank SMS', 'error');
        return;
      }

      if (quickBtn) { quickBtn.disabled = true; quickBtn.textContent = 'Extracting...'; }
      try {
        const isSmsLike = /(?:debited|credited|a\/c|acct|ending in|upi|vpa|avl\s+bal|txn\s+id|ref\s+no)/i.test(text);
        const res = isSmsLike ? await API.parseBankSms(text) : await API.parseNaturalLanguage(text);
        if (res && res.result) {
          const r = res.result;
          UI.toast(isSmsLike ? 'AI parsed bank SMS details!' : 'AI extracted transaction details!', 'success');
          UI.openAddModal({
            description: r.description || r.merchant || text,
            amount: r.amount || '',
            type: r.type || 'expense',
            category: r.category || 'Other',
            date: r.date || (typeof getLocalDateString === 'function' ? getLocalDateString() : new Date().toISOString().slice(0, 10)),
            account_id: r.account_id || '',
            tags: r.tags || ['quick-add']
          });
          if (quickInput) quickInput.value = '';
        }
      } catch (err) {
        UI.toast(err.message || 'Failed to parse input', 'error');
      } finally {
        if (quickBtn) { quickBtn.disabled = false; quickBtn.textContent = 'Extract'; }
      }
    };

    if (quickBtn) quickBtn.addEventListener('click', handleQuickAdd);
    if (quickInput) {
      quickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleQuickAdd();
      });
    }

    const btnScan = document.getElementById('btnScanReceipt');
    const btnScanTxn = document.getElementById('btnScanReceiptTxn');
    const receiptModal = document.getElementById('receiptModal');
    const closeReceiptBtn = document.getElementById('closeReceiptModal');
    const cancelReceiptBtn = document.getElementById('cancelReceiptBtn');
    const dropzone = document.getElementById('receiptDropzone');
    const fileInput = document.getElementById('receiptFileInput');
    const previewWrap = document.getElementById('receiptPreviewWrap');
    const previewImg = document.getElementById('receiptPreviewImg');
    const dropContent = document.getElementById('dropzoneContent');
    const laserLine = document.getElementById('scanLaserLine');
    const statusArea = document.getElementById('receiptStatusArea');
    const loader = document.getElementById('receiptLoader');
    const resultCard = document.getElementById('receiptResultCard');
    const useBtn = document.getElementById('useReceiptDataBtn');
    const rescanBtn = document.getElementById('rescanReceiptBtn');

    let currentExtractedData = null;

    const resetReceiptModal = () => {
      currentExtractedData = null;
      if (fileInput) fileInput.value = '';
      if (previewWrap) previewWrap.style.display = 'none';
      if (dropContent) dropContent.style.display = 'block';
      if (laserLine) laserLine.style.display = 'none';
      if (statusArea) statusArea.style.display = 'none';
      if (loader) loader.style.display = 'none';
      if (resultCard) resultCard.style.display = 'none';
      if (useBtn) useBtn.style.display = 'none';
      if (rescanBtn) rescanBtn.style.display = 'none';
    };

    const openReceiptModal = () => {
      resetReceiptModal();
      if (receiptModal) receiptModal.classList.add('open');
    };

    const closeReceiptModal = () => {
      if (receiptModal) receiptModal.classList.remove('open');
      resetReceiptModal();
    };

    if (btnScan) btnScan.addEventListener('click', openReceiptModal);
    if (btnScanTxn) btnScanTxn.addEventListener('click', openReceiptModal);
    if (closeReceiptBtn) closeReceiptBtn.addEventListener('click', closeReceiptModal);
    if (cancelReceiptBtn) cancelReceiptBtn.addEventListener('click', closeReceiptModal);
    if (rescanBtn) rescanBtn.addEventListener('click', resetReceiptModal);

    if (dropzone) {
      dropzone.addEventListener('click', (e) => {
        if (e.target !== fileInput) fileInput.click();
      });
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processReceiptFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          processReceiptFile(e.target.files[0]);
        }
      });
    }

    const processReceiptFile = (file) => {
      if (!file.type.startsWith('image/')) {
        UI.toast('Please select an image file (PNG, JPG, WebP)', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        UI.toast('File size exceeds 5MB limit', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target.result;
        if (previewImg) previewImg.src = base64;
        if (dropContent) dropContent.style.display = 'none';
        if (previewWrap) previewWrap.style.display = 'block';
        if (laserLine) laserLine.style.display = 'block';
        if (statusArea) statusArea.style.display = 'block';
        if (loader) loader.style.display = 'flex';
        if (resultCard) resultCard.style.display = 'none';
        if (useBtn) useBtn.style.display = 'none';

        try {
          const res = await API.scanReceipt(base64);
          if (res && res.result) {
            currentExtractedData = res.result;
            if (laserLine) laserLine.style.display = 'none';
            if (loader) loader.style.display = 'none';
            if (resultCard) resultCard.style.display = 'block';

            const m = document.getElementById('resMerchant');
            const a = document.getElementById('resAmount');
            const c = document.getElementById('resCategory');
            const d = document.getElementById('resDate');

            if (m) m.textContent = currentExtractedData.merchant || 'Store Receipt';
            if (a) a.textContent = typeof fmt === 'function' ? fmt(currentExtractedData.amount || 0) : `₹${currentExtractedData.amount || 0}`;
            if (c) c.textContent = currentExtractedData.category || 'Other';
            if (d) d.textContent = currentExtractedData.date || (typeof getLocalDateString === 'function' ? getLocalDateString() : new Date().toISOString().slice(0, 10));

            const itemsWrap = document.getElementById('resLineItemsWrap');
            if (itemsWrap) {
              if (currentExtractedData.line_items && currentExtractedData.line_items.length) {
                itemsWrap.innerHTML = '<strong>Items:</strong> ' + currentExtractedData.line_items.slice(0, 5).map(escapeHtml).join(', ');
              } else {
                itemsWrap.innerHTML = '';
              }
            }

            if (useBtn) useBtn.style.display = 'inline-block';
            if (rescanBtn) rescanBtn.style.display = 'inline-block';
            UI.toast('Receipt scanned successfully!', 'success');
          }
        } catch (err) {
          if (laserLine) laserLine.style.display = 'none';
          if (loader) loader.style.display = 'none';
          if (rescanBtn) rescanBtn.style.display = 'inline-block';
          UI.toast(err.message || 'Failed to scan receipt image', 'error');
        }
      };
      reader.readAsDataURL(file);
    };

    if (useBtn) {
      useBtn.addEventListener('click', () => {
        if (!currentExtractedData) return;
        const data = { ...currentExtractedData };
        if (receiptModal) receiptModal.classList.remove('open');
        resetReceiptModal();

        let dateStr = new Date().toISOString().slice(0, 10);
        let hasCustomDate = false;
        if (data.date) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
            dateStr = data.date;
            hasCustomDate = true;
          } else {
            try {
              const p = new Date(data.date);
              if (!isNaN(p.getTime())) {
                dateStr = p.toISOString().slice(0, 10);
                hasCustomDate = true;
              }
            } catch {}
          }
        }

        UI.openAddModal({
          description: data.merchant || 'Receipt Expense',
          amount: data.amount || '',
          type: 'expense',
          category: data.category || 'Other',
          date: dateStr,
          tags: Array.isArray(data.tags) && data.tags.length ? data.tags : ['receipt']
        });
        const currentYear = new Date().getFullYear();
        const receiptYear = parseInt(dateStr.slice(0, 4), 10);
        if (hasCustomDate && receiptYear < currentYear) {
          UI.toast(`✓ Form pre-filled from receipt! Note: Date is ${dateStr} (past year). Change to Today if you want it in this month's stats.`, 'info', 5000);
        } else {
          UI.toast('✓ Form pre-filled from receipt!', 'success');
        }
      });
    }

    const btnOpenSms = document.getElementById('btnOpenSmsModal');
    const smsModal = document.getElementById('smsParserModal');
    const closeSmsBtn = document.getElementById('closeSmsModal');
    const cancelSmsBtn = document.getElementById('cancelSmsBtn');
    const smsInput = document.getElementById('smsInputText');
    const btnExtractSms = document.getElementById('btnExtractSms');
    const btnPasteClip = document.getElementById('btnPasteFromClipboard');
    const btnOpenInForm = document.getElementById('btnOpenSmsInForm');
    const btnSaveDirect = document.getElementById('btnSaveSmsDirect');
    const smsStatusArea = document.getElementById('smsStatusArea');
    const smsLoader = document.getElementById('smsLoader');
    const smsResultCard = document.getElementById('smsResultCard');

    let currentSmsParsedData = null;

    const resetSmsModal = () => {
      if (smsInput) smsInput.value = '';
      if (smsStatusArea) smsStatusArea.style.display = 'none';
      if (smsLoader) smsLoader.style.display = 'none';
      if (smsResultCard) smsResultCard.style.display = 'none';
      if (btnOpenInForm) btnOpenInForm.style.display = 'none';
      if (btnSaveDirect) btnSaveDirect.style.display = 'none';
      if (btnExtractSms) {
        btnExtractSms.style.display = 'inline-block';
        btnExtractSms.disabled = false;
        btnExtractSms.textContent = 'Extract Data';
      }
      currentSmsParsedData = null;
    };

    if (btnOpenSms && smsModal) {
      btnOpenSms.addEventListener('click', () => {
        resetSmsModal();
        smsModal.classList.add('open');
        setTimeout(() => smsInput?.focus(), 100);
      });
    }

    const closeSms = () => {
      if (smsModal) smsModal.classList.remove('open');
      resetSmsModal();
    };
    if (closeSmsBtn) closeSmsBtn.addEventListener('click', closeSms);
    if (cancelSmsBtn) cancelSmsBtn.addEventListener('click', closeSms);

    document.querySelectorAll('.sms-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const sample = chip.dataset.sample;
        if (smsInput && sample) {
          smsInput.value = sample;
          executeSmsParse();
        }
      });
    });

    if (btnPasteClip && smsInput) {
      btnPasteClip.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const clipText = await navigator.clipboard.readText();
            if (clipText && clipText.trim()) {
              smsInput.value = clipText.trim();
              UI.toast('Pasted from clipboard!', 'info');
              executeSmsParse();
              return;
            }
          }
          smsInput.focus();
          UI.toast('Please press Ctrl+V to paste your SMS', 'info');
        } catch (_) {
          smsInput.focus();
          UI.toast('Clipboard permission not granted. Press Ctrl+V to paste', 'info');
        }
      });
    }

    const executeSmsParse = async () => {
      const text = smsInput?.value?.trim();
      if (!text) {
        UI.toast('Please enter or paste a bank SMS message first', 'error');
        return;
      }

      if (smsStatusArea) smsStatusArea.style.display = 'block';
      if (smsLoader) smsLoader.style.display = 'flex';
      if (smsResultCard) smsResultCard.style.display = 'none';
      if (btnExtractSms) {
        btnExtractSms.disabled = true;
        btnExtractSms.textContent = 'Analyzing...';
      }

      try {
        const res = await API.parseBankSms(text);
        if (res && res.result) {
          currentSmsParsedData = res.result;

          if (smsLoader) smsLoader.style.display = 'none';
          if (smsResultCard) smsResultCard.style.display = 'block';

          const typeBadge = document.getElementById('smsTypeBadge');
          const isIncome = currentSmsParsedData.type === 'income';
          if (typeBadge) {
            typeBadge.textContent = isIncome ? 'Income / Credit' : 'Expense / Debit';
            typeBadge.style.background = isIncome ? 'var(--income-tint)' : 'var(--expense-tint)';
            typeBadge.style.color = isIncome ? 'var(--income)' : 'var(--expense)';
          }

          const m = document.getElementById('smsResMerchant');
          const a = document.getElementById('smsResAmount');
          const c = document.getElementById('smsResCategory');
          const d = document.getElementById('smsResDate');

          if (m) m.textContent = currentSmsParsedData.merchant || currentSmsParsedData.description || 'Bank Alert';
          if (a) {
            a.textContent = (isIncome ? '+' : '-') + (typeof fmt === 'function' ? fmt(currentSmsParsedData.amount || 0) : `₹${currentSmsParsedData.amount || 0}`);
            a.className = isIncome ? 'green' : 'red';
          }
          if (c) c.textContent = currentSmsParsedData.category || 'Other';
          if (d) d.textContent = currentSmsParsedData.date || new Date().toISOString().slice(0, 10);

          const accSpan = document.getElementById('smsResAccount');
          if (accSpan) {
            if (currentSmsParsedData.account_id && Array.isArray(State.accounts)) {
              const matchedAcc = State.accounts.find(acc => acc.id === currentSmsParsedData.account_id);
              accSpan.innerHTML = matchedAcc ? `<strong style="color:var(--brand)">✓ ${escapeHtml(matchedAcc.name)}</strong>` : 'Detected';
            } else {
              accSpan.textContent = 'None matched (will use default)';
            }
          }

          const refWrap = document.getElementById('smsResRefWrap');
          const refSpan = document.getElementById('smsResRef');
          if (refWrap && refSpan) {
            if (currentSmsParsedData.reference_no) {
              refWrap.style.display = 'block';
              refSpan.textContent = currentSmsParsedData.reference_no;
            } else {
              refWrap.style.display = 'none';
            }
          }

          const balWrap = document.getElementById('smsResBalWrap');
          const balSpan = document.getElementById('smsResBal');
          if (balWrap && balSpan) {
            if (currentSmsParsedData.balance) {
              balWrap.style.display = 'block';
              balSpan.textContent = typeof fmt === 'function' ? fmt(currentSmsParsedData.balance) : `₹${currentSmsParsedData.balance}`;
            } else {
              balWrap.style.display = 'none';
            }
          }

          if (btnOpenInForm) btnOpenInForm.style.display = 'inline-block';
          if (btnSaveDirect) btnSaveDirect.style.display = 'inline-block';
          UI.toast('Bank SMS parsed successfully!', 'success');
        }
      } catch (err) {
        if (smsLoader) smsLoader.style.display = 'none';
        UI.toast(err.message || 'Failed to parse bank SMS. Try entering manually.', 'error');
      } finally {
        if (btnExtractSms) {
          btnExtractSms.disabled = false;
          btnExtractSms.textContent = 'Re-parse';
        }
      }
    };

    if (btnExtractSms) btnExtractSms.addEventListener('click', executeSmsParse);

    if (btnOpenInForm) {
      btnOpenInForm.addEventListener('click', () => {
        if (!currentSmsParsedData) return;
        const data = { ...currentSmsParsedData };
        closeSms();
        UI.openAddModal({
          description: data.description || data.merchant || 'Bank Transaction',
          amount: data.amount || '',
          type: data.type || 'expense',
          category: data.category || 'Other',
          date: data.date || new Date().toISOString().slice(0, 10),
          account_id: data.account_id || '',
          tags: Array.isArray(data.tags) ? data.tags : ['bank-sms']
        });
        UI.toast('Form pre-filled from bank alert!', 'info');
      });
    }

    if (btnSaveDirect) {
      btnSaveDirect.addEventListener('click', async () => {
        if (!currentSmsParsedData) return;
        btnSaveDirect.disabled = true;
        btnSaveDirect.textContent = 'Saving...';
        try {
          const saved = await API.post('/transactions', {
            description: currentSmsParsedData.description || currentSmsParsedData.merchant || 'Bank Transaction',
            amount: currentSmsParsedData.amount,
            type: currentSmsParsedData.type || 'expense',
            category: currentSmsParsedData.category || 'Other',
            date: currentSmsParsedData.date || new Date().toISOString().slice(0, 10),
            account_id: currentSmsParsedData.account_id || null,
            tags: Array.isArray(currentSmsParsedData.tags) ? currentSmsParsedData.tags : ['bank-sms']
          });
          if (saved && saved.id) {
            UI.toast(`Saved ${typeof fmt === 'function' ? fmt(currentSmsParsedData.amount) : '₹' + currentSmsParsedData.amount} (${currentSmsParsedData.merchant || currentSmsParsedData.category})`, 'success');
            closeSms();
            if (typeof this.loadDashboard === 'function') await this.loadDashboard();
            if (typeof this.loadTransactions === 'function') await this.loadTransactions({});
            if (typeof this.loadAccounts === 'function') await this.loadAccounts(false);
          } else {
            throw new Error('Could not save transaction');
          }
        } catch (err) {
          UI.toast(err.message || 'Failed to direct-save transaction', 'error');
        } finally {
          btnSaveDirect.disabled = false;
          btnSaveDirect.textContent = 'Save Directly';
        }
      });
    }
  }
};

export default AIModule;
