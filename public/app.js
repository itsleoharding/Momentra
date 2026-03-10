'use strict';

// ── State ─────────────────────────────────────────────────────────────────

let sessionId    = null;
let isWaiting    = false;
let intakeAnswers = {};

// ── Intake question definitions ───────────────────────────────────────────

const INTAKE_QUESTIONS = [
  {
    field:   'revenueRange',
    label:   'Monthly revenue range',
    options: ['Under $5K', '$5K-$15K', '$15K-$30K', '$30K-$60K', '$60K-$100K', '$100K+'],
  },
  {
    field:   'niche',
    label:   'Your niche',
    options: ['Health and fitness', 'Business and finance', 'Relationships', 'Personal development', 'Parenting', 'Other'],
  },
  {
    field:   'paidAdvertising',
    label:   'Are you running paid advertising?',
    options: ['Yes', 'No', 'Planning to'],
  },
  {
    field:   'organicContent',
    label:   'Are you primarily doing organic content?',
    options: ['Yes', 'No', 'Both paid and organic'],
  },
  {
    field:   'youtubeAudience',
    label:   'YouTube audience size',
    options: ['Under 1K', '1K-10K', '10K-50K', '50K-100K', '100K+', 'Not on YouTube'],
  },
  {
    field:   'instagramAudience',
    label:   'Instagram audience size',
    options: ['Under 1K', '1K-10K', '10K-50K', '50K-100K', '100K+', 'Not on Instagram'],
  },
  {
    field:   'youtubeImpressions',
    label:   'Monthly YouTube impressions',
    options: ['Under 10K', '10K-100K', '100K-500K', '500K-1M', '1M+', 'Not on YouTube'],
  },
  {
    field:   'instagramImpressions',
    label:   'Monthly Instagram impressions',
    options: ['Under 10K', '10K-100K', '100K-500K', '500K-1M', '1M+', 'Not on Instagram'],
  },
];

// ── DOM refs ──────────────────────────────────────────────────────────────

const formView     = document.getElementById('form-view');
const chatWrapper  = document.getElementById('chat-wrapper');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn      = document.getElementById('send-btn');
const inputBar     = document.getElementById('input-bar');

// ── Utilities ─────────────────────────────────────────────────────────────

function scrollToBottom() {
  chatWrapper.scrollTop = chatWrapper.scrollHeight;
}

function setInputEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

// ── HTML escaping ─────────────────────────────────────────────────────────

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Markdown parser ───────────────────────────────────────────────────────

function parseMarkdown(text, isModel) {
  function processLine(line) {
    // Escape HTML first so any angle brackets in source are safe
    let s = escHtml(line);

    // Model only: a line that is entirely **bold** becomes a Roboto Slab header
    if (isModel && /^\*\*[^*]+\*\*$/.test(s)) {
      const inner = s.slice(2, -2);
      return '<span class="model-header">' + inner + '</span>';
    }

    // Inline bold: **text** → <strong>text</strong>
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return s;
  }

  // Split into paragraph blocks on double (or more) newlines
  const blocks = text.split(/\n{2,}/);
  let html = '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');

    // Ordered list: every line starts with "N. "
    if (lines.every(l => /^\d+\.\s+/.test(l.trim()))) {
      const items = lines.map(l => {
        const content = l.replace(/^\d+\.\s+/, '');
        return '<li>' + processLine(content) + '</li>';
      }).join('');
      html += '<ol>' + items + '</ol>';
    } else {
      // Regular paragraph — single newlines become <br>
      const content = lines.map(processLine).join('<br>');
      html += '<p>' + content + '</p>';
    }
  }

  return html;
}

// ── Message rendering ─────────────────────────────────────────────────────

function appendMessage(content, type, isModel) {
  const div = document.createElement('div');
  const classes = ['message', type];
  if (isModel) classes.push('model');
  div.className = classes.join(' ');

  if (type === 'user') {
    // Plain text only; newlines become <br>
    div.innerHTML = escHtml(content).replace(/\n/g, '<br>');
  } else {
    div.innerHTML = parseMarkdown(content, !!isModel);
  }

  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function appendErrorMessage(text) {
  const div = document.createElement('div');
  div.className = 'message assistant error-msg';
  div.textContent = text;
  chatMessages.appendChild(div);
  scrollToBottom();
}

// ── Typing indicator ──────────────────────────────────────────────────────

function showTypingIndicator() {
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'message assistant typing-indicator';
  div.innerHTML =
    '<span class="dot"></span>' +
    '<span class="dot"></span>' +
    '<span class="dot"></span>';
  chatMessages.appendChild(div);
  scrollToBottom();
}

function hideTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// ── Completion state ──────────────────────────────────────────────────────

function showCompletionState() {
  inputBar.innerHTML = '<div class="completion-text">Diagnostic complete</div>';
}

// ── Slide 1: Contact form ─────────────────────────────────────────────────

function renderContactForm() {
  formView.innerHTML = `
    <div class="slide-content">
      <p class="slide-step">Step 1 of 2</p>
      <h2 class="slide-title">Offer Ecosystem Diagnostic</h2>
      <p class="slide-subtitle">Answer a few questions and receive a personalized dynamic model for your coaching business.</p>
      <div class="form-group">
        <label for="c-name">Full name</label>
        <input type="text" id="c-name" placeholder="Jane Smith" autocomplete="name">
      </div>
      <div class="form-group">
        <label for="c-email">Email</label>
        <input type="email" id="c-email" placeholder="jane@example.com" autocomplete="email">
      </div>
      <div class="form-group">
        <label for="c-instagram">Instagram handle <span class="optional">(optional)</span></label>
        <input type="text" id="c-instagram" placeholder="@yourhandle" autocomplete="off">
      </div>
      <div class="form-group">
        <label for="c-phone">Phone <span class="optional">(optional)</span></label>
        <input type="tel" id="c-phone" placeholder="+1 555 000 0000" autocomplete="tel">
      </div>
      <div id="contact-error" class="form-error"></div>
      <button id="contact-submit" class="slide-btn">Continue &rarr;</button>
    </div>
  `;

  document.getElementById('contact-submit').addEventListener('click', handleContactSubmit);

  // Allow Enter to advance between fields or submit
  document.getElementById('c-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('c-email').focus(); }
  });
  document.getElementById('c-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('c-instagram').focus(); }
  });
  document.getElementById('c-instagram').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('c-phone').focus(); }
  });
  document.getElementById('c-phone').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleContactSubmit(); }
  });

  document.getElementById('c-name').focus();
}

async function handleContactSubmit() {
  const name      = document.getElementById('c-name').value.trim();
  const email     = document.getElementById('c-email').value.trim();
  const instagram = document.getElementById('c-instagram').value.trim();
  const phone     = document.getElementById('c-phone').value.trim();
  const errorEl   = document.getElementById('contact-error');

  if (!name) { errorEl.textContent = 'Full name is required.'; return; }
  if (!email || !email.includes('@')) { errorEl.textContent = 'A valid email is required.'; return; }
  errorEl.textContent = '';

  const submitBtn = document.getElementById('contact-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const refSource = new URLSearchParams(window.location.search).get('ref');
    const res = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact: {
          fullName:        name,
          email:           email,
          instagramHandle: instagram || null,
          phone:           phone || null,
        },
        referralSource: refSource,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Something went wrong. Please try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue \u2192';
      return;
    }

    sessionId = data.sessionId;
    intakeAnswers = {};
    renderIntakeForm();

  } catch (err) {
    errorEl.textContent = 'Could not connect. Please check your connection and try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Continue \u2192';
  }
}

// ── Slide 2: Intake form ──────────────────────────────────────────────────

function renderIntakeForm() {
  let questionsHtml = '';
  for (const q of INTAKE_QUESTIONS) {
    const optionsHtml = q.options.map(opt =>
      `<button class="option-btn" data-field="${q.field}" data-value="${opt}">${opt}</button>`
    ).join('');
    questionsHtml += `
      <div class="question-block">
        <div class="question-label">${q.label}</div>
        <div class="option-group">${optionsHtml}</div>
      </div>`;
  }

  formView.innerHTML = `
    <div class="slide-content">
      <p class="slide-step">Step 2 of 2</p>
      <h2 class="slide-title">About your business</h2>
      <p class="slide-subtitle">Select one answer per question. This shapes your diagnostic.</p>
      ${questionsHtml}
      <div id="intake-error" class="form-error"></div>
      <button id="intake-submit" class="slide-btn">Start diagnostic &rarr;</button>
      <button class="back-link" id="intake-back">&larr; Back</button>
    </div>
  `;

  // Restore any previously selected answers (if user pressed Back)
  for (const [field, value] of Object.entries(intakeAnswers)) {
    const btn = formView.querySelector(`.option-btn[data-field="${field}"][data-value="${value}"]`);
    if (btn) btn.classList.add('selected');
  }

  formView.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      formView.querySelectorAll(`.option-btn[data-field="${btn.dataset.field}"]`)
        .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      intakeAnswers[btn.dataset.field] = btn.dataset.value;
    });
  });

  document.getElementById('intake-submit').addEventListener('click', handleIntakeSubmit);
  document.getElementById('intake-back').addEventListener('click', renderContactForm);
  formView.scrollTop = 0;
}

async function handleIntakeSubmit() {
  const errorEl = document.getElementById('intake-error');

  const missing = INTAKE_QUESTIONS.filter(q => !intakeAnswers[q.field]);
  if (missing.length > 0) {
    errorEl.textContent = `Please answer all questions (${missing.length} remaining).`;
    const firstMissing = formView.querySelector(`.option-btn[data-field="${missing[0].field}"]`);
    if (firstMissing) firstMissing.closest('.question-block').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  errorEl.textContent = '';

  const submitBtn = document.getElementById('intake-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Starting...';

  try {
    const res = await fetch('/api/intake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId,
      },
      body: JSON.stringify({ answers: intakeAnswers }),
    });

    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Something went wrong. Please try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start diagnostic \u2192';
      return;
    }

    startChat();

  } catch (err) {
    errorEl.textContent = 'Could not connect. Please check your connection and try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start diagnostic \u2192';
  }
}

// ── Start chat (after intake complete) ───────────────────────────────────

async function startChat() {
  formView.style.display = 'none';
  chatWrapper.style.display = '';
  inputBar.style.display = '';

  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-msg';
  loadingDiv.className = 'loading-msg';
  loadingDiv.textContent = 'Building your diagnostic...';
  chatMessages.appendChild(loadingDiv);

  try {
    const chatRes = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId,
      },
      body: JSON.stringify({ message: 'hello' }),
    });

    if (!chatRes.ok) throw new Error('Initial chat failed');
    const chatData = await chatRes.json();

    document.getElementById('loading-msg')?.remove();
    appendMessage(chatData.response, 'assistant');
    setInputEnabled(true);
    messageInput.focus();

  } catch (err) {
    const loadEl = document.getElementById('loading-msg');
    if (loadEl) loadEl.textContent = 'Failed to connect. Please refresh the page.';
  }
}

// ── Send message ──────────────────────────────────────────────────────────

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isWaiting) return;

  appendMessage(text, 'user');
  messageInput.value = '';
  messageInput.style.height = 'auto';
  setInputEnabled(false);
  isWaiting = true;
  showTypingIndicator();
  scrollToBottom();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId,
      },
      body: JSON.stringify({ message: text }),
    });

    const data = await res.json();
    hideTypingIndicator();

    if (!res.ok) {
      const expired = data.code === 'SESSION_EXPIRED';
      appendErrorMessage(
        expired
          ? 'Your session has expired. Please refresh to start a new conversation.'
          : (data.error || 'Something went wrong. Please try again.')
      );
      if (!expired) {
        setInputEnabled(true);
        messageInput.focus();
      }
      return;
    }

    appendMessage(data.response, 'assistant', data.isModel);

    if (data.isModel) {
      showCompletionState();
      setTimeout(() => {
        fetch('/api/session/end', {
          method: 'POST',
          headers: { 'X-Session-ID': sessionId },
        }).catch(() => {});
      }, 2000);
    } else {
      setInputEnabled(true);
      messageInput.focus();
    }

  } catch (err) {
    hideTypingIndicator();
    appendErrorMessage('Something went wrong. Please try again.');
    setInputEnabled(true);
    messageInput.focus();
  } finally {
    isWaiting = false;
  }
}

// ── Event listeners ───────────────────────────────────────────────────────

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 96) + 'px';
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// Script is at bottom of body — DOM is ready, render first slide
renderContactForm();
