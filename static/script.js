/**
 * FX JOURNAL — Professional Trading Dashboard
 * script.js
 *
 * Connects to Flask backend via REST API.
 * All API calls use fetch() with async/await.
 * Modular, clean, well-commented code.
 */

'use strict';

// ============================================================
// CONFIG
// ============================================================

// Relative URLs work for both local Flask and deployed Railway/Render
const API_BASE = '';

// ============================================================
// STATE
// ============================================================

const state = {
  accounts: [],
  trades: [],
  selectedAccountId: null,
  sortCol: 'date',
  sortDir: 'desc',
  equityChart: null,
  winLossChart: null,
  monthlyChart: null,
  pairChart: null,
  sessionChart: null,
  rrChart: null,
  emotionChart: null,
  tradeSearchQuery: '',
  pendingDeleteFn: null,
  settings: {
    name: 'Trader',
    risk: 1,
    strategies: 'Breakout,Pullback,Reversal,Scalp,Swing',
  }
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/** Format a number as currency */
const fmt = (n, dec = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(dec)}`;
};

/** Format plain number (no sign/dollar) */
const fmtNum = (n, dec = 2) => (isNaN(n) || n === null) ? '—' : Number(n).toFixed(dec);

/** Round to N decimals */
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Sleep helper for animations */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Get local datetime string for input defaults */
const localNow = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

/**
 * Show a toast notification.
 * @param {string} msg - Message text
 * @param {'success'|'error'|'info'} type - Toast type
 */
function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ============================================================
// LOADING STATE
// ============================================================

const showLoading = () => document.getElementById('loadingOverlay').classList.add('active');
const hideLoading = () => document.getElementById('loadingOverlay').classList.remove('active');

// ============================================================
// API HELPERS
// ============================================================

/**
 * Generic fetch wrapper with error handling.
 * Falls back to mock data if backend is unavailable.
 */
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // Backend not running — use local mock data silently
    console.warn(`API unavailable (${path}): ${err.message}. Using mock data.`);
    return null;
  }
}

// ---- Accounts API ----

async function fetchAccounts() {
  const data = await apiFetch('/api/accounts');
  if (data) return data.map(a => ({ ...a, type: a.account_type || a.type || 'Live' }));
  return state.accounts.length ? state.accounts : [];
}

async function createAccount(payload) {
  const data = await apiFetch('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name:         payload.name,
      broker:       payload.broker,
      balance:      payload.balance,
      account_type: payload.type || payload.account_type || 'Live',
      currency:     payload.currency,
    }),
  });
  if (data) return { ...data, type: data.account_type };
  // Mock: assign local ID
  const mock = { id: Date.now(), ...payload };
  state.accounts.push(mock);
  return mock;
}

async function deleteAccountApi(id) {
  const data = await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
  if (data) return data;
  state.accounts = state.accounts.filter(a => a.id !== id);
  return { deleted: true };
}

// ---- Trades API ----

async function fetchTrades(accId) {
  if (!accId) return [];
  const data = await apiFetch(`/api/trades/${accId}`);
  if (data) return data;
  return state.trades.filter(t => t.account_id === accId);
}

async function createTrade(payload) {
  const data = await apiFetch('/api/trades', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (data) return data;
  const mock = { id: Date.now(), ...payload };
  state.trades.push(mock);
  return mock;
}

async function updateTrade(id, payload) {
  const data = await apiFetch(`/api/trades/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (data) return data;
  const idx = state.trades.findIndex(t => t.id === id);
  if (idx !== -1) state.trades[idx] = { id, ...payload };
  return { id, ...payload };
}

async function deleteTradeApi(id) {
  const data = await apiFetch(`/api/trades/${id}`, { method: 'DELETE' });
  if (data) return data;
  state.trades = state.trades.filter(t => t.id !== id);
  return { deleted: true };
}

// ============================================================
// DATETIME TICKER
// ============================================================

function startClock() {
  const el = document.getElementById('datetimeBlock');
  const tick = () => {
    const now = new Date();
    const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    el.innerHTML = `
      <div style="font-size:0.85rem;color:var(--text);font-weight:600">
        ${now.toLocaleTimeString('en-US', { hour12: false })}
      </div>
      <div>${now.toLocaleDateString('en-US', opts)}</div>
    `;
  };
  tick();
  setInterval(tick, 1000);
}

// ============================================================
// SIDEBAR NAVIGATION
// ============================================================

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const section = item.dataset.section;
      activateSection(section);

      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('open');
      }
    });
  });

  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
  });
  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
  });
}

function activateSection(name) {
  // Deactivate all
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const sec = document.getElementById(`section-${name}`);
  const nav = document.querySelector(`[data-section="${name}"]`);
  if (sec) sec.classList.add('active');
  if (nav) nav.classList.add('active');

  // Lazy-render sections that need data
  if (name === 'analytics') renderAnalytics();
  if (name === 'psychology') renderPsychology();
}

// ============================================================
// ACCOUNT MANAGEMENT
// ============================================================

async function loadAccounts() {
  const data = await fetchAccounts();
  if (data) state.accounts = data;
  renderAccountSelector();
  renderAccountsSection();
}

function renderAccountSelector() {
  const sel = document.getElementById('accountSelect');
  sel.innerHTML = '<option value="">— Select Account —</option>';
  state.accounts.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.id;
    opt.textContent = `${acc.name} (${acc.type || 'Live'})`;
    if (String(acc.id) === String(state.selectedAccountId)) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderAccountsSection() {
  const grid = document.getElementById('accountsGrid');
  if (!state.accounts.length) {
    grid.innerHTML = `<div class="empty-state"><p>No accounts yet. Create your first account.</p></div>`;
    return;
  }
  grid.innerHTML = state.accounts.map(acc => `
    <div class="account-card ${String(acc.id) === String(state.selectedAccountId) ? 'selected' : ''}">
      <div class="acc-type-badge type-${acc.type || 'Live'}">${acc.type || 'Live'}</div>
      <div class="acc-name">${escHtml(acc.name)}</div>
      <div class="acc-broker">${escHtml(acc.broker || 'No broker specified')}</div>
      <div class="acc-balance-row">
        <span class="acc-balance-label">Balance</span>
        <span class="acc-balance-val">${acc.currency || '$'}${Number(acc.balance || 0).toLocaleString()}</span>
      </div>
      <div class="acc-actions">
        <button class="btn-sm select" onclick="selectAccount(${acc.id})">Activate</button>
        <button class="btn-sm del" onclick="confirmDeleteAccount(${acc.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

function selectAccount(id) {
  state.selectedAccountId = id;
  const acc = state.accounts.find(a => a.id === id);
  if (acc) {
    document.getElementById('aqAccName').textContent = acc.name;
    document.getElementById('aqDot').style.background = 'var(--green)';
    toast(`Switched to "${acc.name}"`, 'success');
  }
  renderAccountSelector();
  renderAccountsSection();
  loadTradesForAccount();
}

function confirmDeleteAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  document.getElementById('confirmText').textContent = `Delete account "${acc?.name}"? This cannot be undone.`;
  state.pendingDeleteFn = async () => {
    showLoading();
    await deleteAccountApi(id);
    if (state.selectedAccountId === id) {
      state.selectedAccountId = null;
      state.trades = [];
    }
    await loadAccounts();
    hideLoading();
    toast('Account deleted', 'success');
    closeModal('confirmModal');
  };
  openModal('confirmModal');
}

document.getElementById('saveAccountBtn').addEventListener('click', async () => {
  const name    = document.getElementById('accName').value.trim();
  const broker  = document.getElementById('accBroker').value.trim();
  const balance = parseFloat(document.getElementById('accBalance').value);
  const type    = document.getElementById('accType').value;
  const currency= document.getElementById('accCurrency').value;

  if (!name || isNaN(balance)) {
    toast('Name and balance are required', 'error');
    return;
  }

  showLoading();
  const acc = await createAccount({ name, broker, balance, type, currency });
  state.accounts.push(acc);
  closeModal('addAccountModal');
  await loadAccounts();
  hideLoading();
  toast(`Account "${name}" created`, 'success');

  // Clear form
  ['accName','accBroker','accBalance'].forEach(id => document.getElementById(id).value = '');
});

document.getElementById('openAddAccountModal').addEventListener('click', () => openModal('addAccountModal'));

// ============================================================
// ACCOUNT SELECTOR CHANGE
// ============================================================

document.getElementById('accountSelect').addEventListener('change', e => {
  const id = parseInt(e.target.value);
  if (!isNaN(id)) {
    selectAccount(id);
  } else {
    state.selectedAccountId = null;
    state.trades = [];
    renderDashboard();
    renderTradesTable();
  }
});

// ============================================================
// TRADES
// ============================================================

async function loadTradesForAccount() {
  if (!state.selectedAccountId) {
    state.trades = [];
    renderTradesTable();
    renderDashboard();
    return;
  }
  showLoading();
  const data = await fetchTrades(state.selectedAccountId);
  state.trades = data || [];
  hideLoading();
  renderTradesTable();
  renderDashboard();
}

/** Build and render the trades table */
function renderTradesTable(filter = state.tradeSearchQuery) {
  const body    = document.getElementById('tradesBody');
  const empty   = document.getElementById('tradesEmpty');
  const counter = document.getElementById('tradeCount');

  let trades = [...state.trades];

  // Filter
  if (filter) {
    const q = filter.toLowerCase();
    trades = trades.filter(t =>
      (t.pair || '').toLowerCase().includes(q) ||
      (t.strategy || '').toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q)
    );
  }

  // Sort
  trades.sort((a, b) => {
    let av = a[state.sortCol], bv = b[state.sortCol];
    if (state.sortCol === 'date') { av = new Date(av); bv = new Date(bv); }
    else { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
    return state.sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  counter.textContent = `${trades.length} trade${trades.length !== 1 ? 's' : ''}`;

  if (!trades.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = trades.map(t => {
    const pnl = parseFloat(t.pnl);
    const pnlClass = isNaN(pnl) ? 'pnl-zero' : pnl > 0 ? 'pnl-pos' : 'pnl-neg';
    const pnlStr = isNaN(pnl) ? '—' : fmt(pnl);
    const rowClass = isNaN(pnl) ? '' : pnl >= 0 ? 'profit-row' : 'loss-row';
    const rr = calcRR(t);
    const dateStr = t.date ? new Date(t.date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

    return `
      <tr class="${rowClass}" data-id="${t.id}">
        <td class="mono">${dateStr}</td>
        <td><span class="pair-text">${escHtml(t.pair || '—')}</span></td>
        <td><span class="dir-badge dir-${(t.direction||'BUY').toLowerCase()}">${t.direction || 'BUY'}</span></td>
        <td class="mono">${fmtNum(t.entry, 5)}</td>
        <td class="mono">${fmtNum(t.exit, 5)}</td>
        <td class="mono">${fmtNum(t.sl, 5)}</td>
        <td class="mono">${fmtNum(t.tp, 5)}</td>
        <td class="mono">${fmtNum(t.lots, 2)}</td>
        <td><span class="${pnlClass}">${pnlStr}</span></td>
        <td class="mono">${rr !== null ? `${rr}R` : '—'}</td>
        <td><span class="emotion-badge" style="background:var(--card2);color:var(--text2)">${escHtml(t.strategy || '—')}</span></td>
        <td><span class="emotion-badge emotion-${t.emotion || ''}">${escHtml(t.emotion || '—')}</span></td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;color:var(--text3);font-size:0.78rem">${escHtml(t.notes || '—')}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn edit-btn" onclick="openEditTrade(${t.id})" title="Edit">✎</button>
            <button class="action-btn del-btn" onclick="confirmDeleteTrade(${t.id})" title="Delete">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/** Calculate RR for a trade */
function calcRR(t) {
  const entry = parseFloat(t.entry);
  const sl    = parseFloat(t.sl);
  const tp    = parseFloat(t.tp);
  if (!isNaN(entry) && !isNaN(sl) && !isNaN(tp) && sl !== entry) {
    const risk   = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    return round(reward / risk, 2);
  }
  return null;
}

/** Sort table by column */
document.getElementById('tradesTable').querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortCol = col; state.sortDir = 'desc'; }
    renderTradesTable();
  });
});

/** Live search */
document.getElementById('tradeSearch').addEventListener('input', e => {
  state.tradeSearchQuery = e.target.value;
  renderTradesTable(e.target.value);
});

document.getElementById('globalSearch').addEventListener('input', e => {
  state.tradeSearchQuery = e.target.value;
  document.getElementById('tradeSearch').value = e.target.value;
  renderTradesTable(e.target.value);
});

// ============================================================
// ADD / EDIT TRADE MODAL
// ============================================================

document.getElementById('openAddTradeModal').addEventListener('click', () => {
  if (!state.selectedAccountId) {
    toast('Select an account first', 'error');
    return;
  }
  resetTradeForm();
  document.getElementById('tradeModalTitle').textContent = 'Add Trade';
  document.getElementById('tradeDate').value = localNow();
  openModal('addTradeModal');
});

function openEditTrade(id) {
  const t = state.trades.find(tr => String(tr.id) === String(id));
  if (!t) return;
  resetTradeForm();
  document.getElementById('tradeModalTitle').textContent = 'Edit Trade';
  document.getElementById('tradeEditId').value = t.id;
  document.getElementById('tradeDate').value = t.date ? t.date.slice(0, 16) : localNow();
  document.getElementById('tradePair').value = t.pair || '';
  document.getElementById('tradeDirection').value = t.direction || 'BUY';
  document.getElementById('tradeLots').value = t.lots || '';
  document.getElementById('tradeEntry').value = t.entry || '';
  document.getElementById('tradeExit').value = t.exit || '';
  document.getElementById('tradeSL').value = t.sl || '';
  document.getElementById('tradeTP').value = t.tp || '';
  document.getElementById('tradePnl').value = t.pnl || '';
  document.getElementById('tradeStrategy').value = t.strategy || 'Breakout';
  document.getElementById('tradeEmotion').value = t.emotion || 'Calm';
  document.getElementById('tradeSession').value = t.session || 'London';
  document.getElementById('tradeNotes').value = t.notes || '';
  openModal('addTradeModal');
}

function resetTradeForm() {
  document.getElementById('tradeEditId').value = '';
  ['tradeDate','tradePair','tradeLots','tradeEntry','tradeExit',
   'tradeSL','tradeTP','tradePnl','tradeNotes'].forEach(id => {
    document.getElementById(id).value = '';
  });
}

document.getElementById('saveTradeBtn').addEventListener('click', async () => {
  const editId = document.getElementById('tradeEditId').value;
  const pair = document.getElementById('tradePair').value.trim().toUpperCase();
  const date = document.getElementById('tradeDate').value;

  if (!pair || !date) {
    toast('Pair and date are required', 'error');
    return;
  }

  const payload = {
    account_id: state.selectedAccountId,
    date:       date,
    pair:       pair,
    direction:  document.getElementById('tradeDirection').value,
    lots:       parseFloat(document.getElementById('tradeLots').value) || null,
    entry:      parseFloat(document.getElementById('tradeEntry').value) || null,
    exit:       parseFloat(document.getElementById('tradeExit').value) || null,
    sl:         parseFloat(document.getElementById('tradeSL').value) || null,
    tp:         parseFloat(document.getElementById('tradeTP').value) || null,
    pnl:        parseFloat(document.getElementById('tradePnl').value) || null,
    strategy:   document.getElementById('tradeStrategy').value,
    emotion:    document.getElementById('tradeEmotion').value,
    session:    document.getElementById('tradeSession').value,
    notes:      document.getElementById('tradeNotes').value.trim(),
  };

  showLoading();
  if (editId) {
    // Update
    const updated = await updateTrade(parseInt(editId), payload);
    const idx = state.trades.findIndex(t => String(t.id) === String(editId));
    if (idx !== -1) state.trades[idx] = updated;
    toast('Trade updated', 'success');
  } else {
    // Create
    const created = await createTrade(payload);
    state.trades.push(created);
    toast('Trade added', 'success');
  }
  hideLoading();
  closeModal('addTradeModal');
  renderTradesTable();
  renderDashboard();
});

function confirmDeleteTrade(id) {
  const t = state.trades.find(tr => String(tr.id) === String(id));
  document.getElementById('confirmText').textContent = `Delete trade "${t?.pair || id}"? This cannot be undone.`;
  state.pendingDeleteFn = async () => {
    showLoading();
    await deleteTradeApi(parseInt(id));
    state.trades = state.trades.filter(t => String(t.id) !== String(id));
    hideLoading();
    toast('Trade deleted', 'success');
    closeModal('confirmModal');
    renderTradesTable();
    renderDashboard();
  };
  openModal('confirmModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  if (state.pendingDeleteFn) state.pendingDeleteFn();
});

// ============================================================
// MODAL HELPERS
// ============================================================

function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ============================================================
// PERFORMANCE CALCULATIONS
// ============================================================

function calcStats(trades) {
  const closed = trades.filter(t => t.pnl !== null && !isNaN(parseFloat(t.pnl)));
  const pnls   = closed.map(t => parseFloat(t.pnl));
  const wins   = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);

  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss   = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? '∞' : 0;

  const winRate = closed.length ? round((wins.length / closed.length) * 100, 1) : 0;

  // Average RR
  const rrs = trades.map(t => calcRR(t)).filter(r => r !== null);
  const avgRR = rrs.length ? round(rrs.reduce((a,b) => a+b, 0) / rrs.length, 2) : null;

  // Drawdown calculation (running max drawdown from peak)
  let peak = 0, equity = 0, maxDD = 0;
  const sortedByDate = [...closed].sort((a,b) => new Date(a.date) - new Date(b.date));
  sortedByDate.forEach(t => {
    equity += parseFloat(t.pnl);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  });

  // Best trade
  const bestPnl = pnls.length ? Math.max(...pnls) : null;
  const bestTrade = bestPnl !== null ? closed.find(t => parseFloat(t.pnl) === bestPnl) : null;

  return {
    totalPnl: round(totalPnl, 2),
    winRate,
    wins: wins.length,
    losses: losses.length,
    total: closed.length,
    profitFactor,
    avgRR,
    maxDD: round(maxDD, 2),
    bestPnl: round(bestPnl, 2),
    bestTrade,
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
  };
}

// ============================================================
// DASHBOARD RENDER
// ============================================================

function renderDashboard() {
  const stats = calcStats(state.trades);
  const acc = state.accounts.find(a => String(a.id) === String(state.selectedAccountId));
  const balance = acc ? parseFloat(acc.balance) : null;

  // Cards
  document.getElementById('statBalance').textContent    = balance !== null ? `$${balance.toLocaleString(undefined, {maximumFractionDigits:2})}` : '—';
  document.getElementById('statPnl').textContent        = stats.totalPnl !== null ? fmt(stats.totalPnl) : '—';
  document.getElementById('statPnl').className          = `card-value ${stats.totalPnl >= 0 ? 'green-value' : 'red-value'}`;
  document.getElementById('statWinRate').textContent    = stats.total ? `${stats.winRate}%` : '—';
  document.getElementById('statWinSub').textContent     = stats.total ? `${stats.wins}W / ${stats.losses}L` : '';
  document.getElementById('statRR').textContent         = stats.avgRR !== null ? `1:${stats.avgRR}` : '—';
  document.getElementById('statTrades').textContent     = stats.total || '—';
  document.getElementById('statTradesSub').textContent  = stats.total ? `${state.trades.length} logged` : '';
  document.getElementById('statPF').textContent         = stats.profitFactor || '—';
  document.getElementById('statDD').textContent         = stats.maxDD ? `-$${stats.maxDD}` : '—';
  document.getElementById('statBest').textContent       = stats.bestPnl !== null ? fmt(stats.bestPnl) : '—';
  document.getElementById('statBestPair').textContent   = stats.bestTrade?.pair || '';

  renderEquityChart();
  renderWinLossChart(stats);
}

// ============================================================
// CHART.JS CHARTS
// ============================================================

/** Chart.js global defaults — applied once Chart.js is confirmed loaded */
function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color       = '#64748b';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
}

/** Shared chart options */
const sharedOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1a2235', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1, titleColor: '#e5e7eb', bodyColor: '#94a3b8', padding: 12, cornerRadius: 8 } },
};

// ---- Equity Curve ----
function renderEquityChart() {
  const canvas = document.getElementById('equityChart');
  if (!canvas) return;

  const trades = [...state.trades]
    .filter(t => t.pnl !== null && !isNaN(parseFloat(t.pnl)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const labels = ['Start'];
  const data   = [0];
  trades.forEach(t => {
    running += parseFloat(t.pnl);
    const d = t.date ? new Date(t.date).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '';
    labels.push(d);
    data.push(round(running, 2));
  });

  const positive = running >= 0;
  const color    = positive ? '#22c55e' : '#ef4444';
  const colorDim = positive ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  if (state.equityChart) state.equityChart.destroy();
  state.equityChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 2.5,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
          g.addColorStop(0, positive ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)');
          g.addColorStop(1, 'transparent');
          return g;
        },
        fill: true,
        tension: 0.4,
        pointRadius: data.length > 30 ? 0 : 4,
        pointBackgroundColor: color,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: color,
      }],
    },
    options: {
      ...sharedOptions,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => `$${v}`, font: { size: 10 } } },
      },
    },
  });
}

// ---- Win/Loss Donut ----
function renderWinLossChart(stats) {
  const canvas = document.getElementById('winLossChart');
  if (!canvas) return;
  if (state.winLossChart) state.winLossChart.destroy();
  state.winLossChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Wins', 'Losses'],
      datasets: [{
        data: [stats.wins || 0, stats.losses || 0],
        backgroundColor: ['rgba(34,197,94,0.8)', 'rgba(239,68,68,0.7)'],
        borderColor: ['#22c55e', '#ef4444'],
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      ...sharedOptions,
      cutout: '68%',
      plugins: {
        ...sharedOptions.plugins,
        legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', padding: 16, font: { size: 11 } } },
      },
    },
  });
}

// ---- Monthly PnL ----
function renderAnalytics() {
  renderMonthlyChart();
  renderPairChart();
  renderSessionChart();
  renderRRChart();
}

function renderMonthlyChart() {
  const canvas = document.getElementById('monthlyChart');
  if (!canvas) return;

  const monthMap = {};
  state.trades.forEach(t => {
    if (!t.pnl || !t.date) return;
    const key = new Date(t.date).toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
    monthMap[key] = (monthMap[key] || 0) + parseFloat(t.pnl);
  });

  const labels = Object.keys(monthMap);
  const data   = Object.values(monthMap).map(v => round(v, 2));
  const colors = data.map(v => v >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.75)');
  const borders= data.map(v => v >= 0 ? '#22c55e' : '#ef4444');

  if (state.monthlyChart) state.monthlyChart.destroy();
  state.monthlyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'PnL', data, backgroundColor: colors, borderColor: borders, borderWidth: 1.5, borderRadius: 6 }],
    },
    options: {
      ...sharedOptions,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => `$${v}` } },
      },
    },
  });
}

function renderPairChart() {
  const canvas = document.getElementById('pairChart');
  if (!canvas) return;

  const pairMap = {};
  state.trades.forEach(t => {
    if (!t.pnl || !t.pair) return;
    if (!pairMap[t.pair]) pairMap[t.pair] = 0;
    pairMap[t.pair] += parseFloat(t.pnl);
  });

  const sorted = Object.entries(pairMap).sort((a,b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([k]) => k);
  const data   = sorted.map(([,v]) => round(v, 2));
  const colors = data.map(v => v >= 0 ? 'rgba(56,189,248,0.75)' : 'rgba(239,68,68,0.75)');

  if (state.pairChart) state.pairChart.destroy();
  state.pairChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'PnL by Pair', data, backgroundColor: colors, borderRadius: 6 }],
    },
    options: {
      ...sharedOptions,
      indexAxis: 'y',
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => `$${v}` } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });
}

function renderSessionChart() {
  const canvas = document.getElementById('sessionChart');
  if (!canvas) return;

  const sessions = ['London', 'New York', 'Tokyo', 'Sydney', 'Overlap'];
  const sesMap   = {};
  sessions.forEach(s => sesMap[s] = 0);
  state.trades.forEach(t => {
    if (!t.pnl || !t.session) return;
    if (sessions.includes(t.session)) sesMap[t.session] += parseFloat(t.pnl);
  });

  const data = sessions.map(s => round(sesMap[s], 2));
  const colors = data.map(v => v >= 0 ? 'rgba(167,139,250,0.75)' : 'rgba(239,68,68,0.6)');

  if (state.sessionChart) state.sessionChart.destroy();
  state.sessionChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sessions,
      datasets: [{ label: 'Session PnL', data, backgroundColor: colors, borderRadius: 6 }],
    },
    options: {
      ...sharedOptions,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => `$${v}` } },
      },
    },
  });
}

function renderRRChart() {
  const canvas = document.getElementById('rrChart');
  if (!canvas) return;

  const buckets = { '<0.5': 0, '0.5–1': 0, '1–2': 0, '2–3': 0, '3–5': 0, '5+': 0 };
  state.trades.forEach(t => {
    const rr = calcRR(t);
    if (rr === null) return;
    if (rr < 0.5) buckets['<0.5']++;
    else if (rr < 1) buckets['0.5–1']++;
    else if (rr < 2) buckets['1–2']++;
    else if (rr < 3) buckets['2–3']++;
    else if (rr < 5) buckets['3–5']++;
    else buckets['5+']++;
  });

  if (state.rrChart) state.rrChart.destroy();
  state.rrChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        label: 'Trades',
        data: Object.values(buckets),
        backgroundColor: 'rgba(56,189,248,0.7)',
        borderColor: '#38bdf8',
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...sharedOptions,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { stepSize: 1 } },
      },
    },
  });
}

// ============================================================
// PSYCHOLOGY
// ============================================================

function renderPsychology() {
  const emotions = ['Calm', 'Fear', 'Revenge', 'FOMO', 'Hesitation', 'Overconfidence'];
  const emotionColors = {
    Calm: '#22c55e', Fear: '#ef4444', Revenge: '#f87171',
    FOMO: '#f59e0b', Hesitation: '#38bdf8', Overconfidence: '#a78bfa',
  };

  const countMap = {};
  const pnlMap   = {};
  emotions.forEach(e => { countMap[e] = 0; pnlMap[e] = 0; });

  state.trades.forEach(t => {
    if (t.emotion && countMap[t.emotion] !== undefined) {
      countMap[t.emotion]++;
      if (t.pnl) pnlMap[t.emotion] += parseFloat(t.pnl);
    }
  });

  const totalEmotions = Object.values(countMap).reduce((a,b) => a+b, 0) || 1;

  // Donut chart
  const canvas = document.getElementById('emotionChart');
  if (canvas) {
    if (state.emotionChart) state.emotionChart.destroy();
    state.emotionChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: emotions,
        datasets: [{
          data: emotions.map(e => countMap[e]),
          backgroundColor: emotions.map(e => emotionColors[e] + 'bb'),
          borderColor: emotions.map(e => emotionColors[e]),
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        ...sharedOptions,
        cutout: '62%',
        plugins: {
          ...sharedOptions.plugins,
          legend: {
            display: true,
            position: 'bottom',
            labels: { color: '#94a3b8', padding: 12, font: { size: 11 }, boxWidth: 12 },
          },
        },
      },
    });
  }

  // Stats bars
  const statsEl = document.getElementById('emotionStats');
  statsEl.innerHTML = emotions.map(e => {
    const pct = round((countMap[e] / totalEmotions) * 100, 0);
    const pnl = round(pnlMap[e], 2);
    return `
      <div class="emotion-stat-row">
        <span class="emotion-stat-label">${e}</span>
        <div class="emotion-stat-bar-wrap">
          <div class="emotion-stat-bar" style="width:${pct}%;background:${emotionColors[e]}"></div>
        </div>
        <span class="emotion-stat-val">${countMap[e]}</span>
        <span style="font-size:0.72rem;min-width:60px;text-align:right;font-family:var(--font-mono);color:${pnlMap[e]>=0?'var(--green)':'var(--red)'}">${fmt(pnl)}</span>
      </div>
    `;
  }).join('');

  // Mindset score (higher = calmer = better)
  const calmCount = countMap['Calm'];
  const badEmotions = countMap['Revenge'] + countMap['FOMO'] + countMap['Fear'];
  const total = state.trades.length || 1;
  const score = Math.round(((calmCount - badEmotions * 0.5) / total) * 100);
  const clamped = Math.max(0, Math.min(100, score));

  const scoreEl = document.getElementById('mindsetScore');
  const scoreColor = clamped >= 70 ? 'var(--green)' : clamped >= 40 ? 'var(--yellow)' : 'var(--red)';
  scoreEl.innerHTML = `
    <div class="score-num" style="color:${scoreColor}">${clamped}</div>
    <div class="score-label">/ 100 Mindset Score</div>
  `;

  // Tips
  const tips = [];
  if (countMap['Revenge'] > 0) tips.push('⚠️ Revenge trades detected. Step away after a loss. Your edge only works when you\'re calm.');
  if (countMap['FOMO'] > 0) tips.push('⚠️ FOMO entries present. If you missed the entry, wait for the next setup. Never chase.');
  if (countMap['Overconfidence'] > 0) tips.push('⚠️ Overconfidence detected. Review your sizing. No trade is guaranteed.');
  if (countMap['Calm'] > countMap['Fear']) tips.push('✅ Most trades taken with calm. Good execution mindset.');
  if (!tips.length) tips.push('📊 Log more trades with emotion tags to see psychological patterns.');

  document.getElementById('psychTips').innerHTML = tips.map(t => `<div class="psych-tip">${t}</div>`).join('');
}

// ============================================================
// SETTINGS
// ============================================================

async function saveSettings() {
  state.settings.name       = document.getElementById('settingsName').value;
  state.settings.risk       = parseFloat(document.getElementById('settingsRisk').value);
  state.settings.strategies = document.getElementById('settingsStrategies').value;
  document.getElementById('aqAccName').textContent = state.settings.name;

  await apiFetch('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      trader_name: state.settings.name,
      risk_pct:    state.settings.risk,
      strategies:  state.settings.strategies,
    }),
  });
  toast('Settings saved', 'success');
}

async function loadSettings() {
  const data = await apiFetch('/api/settings');
  if (data) {
    state.settings.name       = data.trader_name  || 'Trader';
    state.settings.risk       = data.risk_pct     || 1;
    state.settings.strategies = data.strategies   || 'Breakout,Pullback,Reversal,Scalp,Swing';
  }
  document.getElementById('settingsName').value       = state.settings.name;
  document.getElementById('settingsRisk').value       = state.settings.risk;
  document.getElementById('settingsStrategies').value = state.settings.strategies;
}

function clearAllTrades() {
  if (!state.selectedAccountId) { toast('No account selected', 'error'); return; }
  document.getElementById('confirmText').textContent = 'Clear ALL trades for this account? Cannot be undone.';
  state.pendingDeleteFn = async () => {
    const ids = [...state.trades.map(t => t.id)];
    showLoading();
    for (const id of ids) await deleteTradeApi(id);
    state.trades = [];
    hideLoading();
    renderTradesTable();
    renderDashboard();
    toast('All trades cleared', 'success');
    closeModal('confirmModal');
  };
  openModal('confirmModal');
}

// ============================================================
// CSV EXPORT
// ============================================================

function exportCSV() {
  if (!state.selectedAccountId) {
    toast('Select an account first', 'error');
    return;
  }
  window.location.href = `${API_BASE}/api/export/${state.selectedAccountId}`;
  toast('Downloading CSV...', 'info');
}

// ============================================================
// CHART PERIOD BUTTONS
// ============================================================

document.querySelectorAll('.chart-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Filter trades by period for equity chart
    renderEquityChart();
  });
});

// ============================================================
// HTML ESCAPE
// ============================================================

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// INIT
// ============================================================

async function init() {
  applyChartDefaults();
  startClock();
  initNavigation();
  await loadSettings();
  await loadAccounts();
  renderDashboard();
  renderTradesTable();
  toast('FX Journal loaded', 'info');
}

document.addEventListener('DOMContentLoaded', init);
