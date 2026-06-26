const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let lastAnalysis = null;
let lastItems = [];
let lastRelease = null;
let lastHoax = null;
let currentQuery = 'Indonesia';
let ws = null;
let httpMonitorTimer = null;
let lastSearchPayload = null;
let monitorRunId = 0;
let monitoringActive = false;
let deferredPrompt = null;
let authSession = null;
let lastSumopodText = '';
let pendingAiAction = null;
let dataPage = 1;
let reportPage = 1;
let audiencePage = 1;
let sourceView = 'all';
let streamPages = { news: 1, social: 1, viral: 1 };
let searchDurationDays = Number(localStorage.getItem('newsroomSearchDurationDays') || 7);
const SEARCH_DURATIONS = [1, 3, 7, 14, 30, 60, 90, 120, 360];
const PAGE_SIZE = 10;
const SOCIAL_SOURCES = ['facebook', 'x', 'threads', 'youtube', 'tiktok', 'instagram', 'linkedin'];
const SUMOPOD_PRESET_MODELS = ['claude-opus-4-8', 'deepseek-v4-pro', 'gemini', 'kimi', 'mimo-v2.5-pro', 'qwen'];
const AUTH_STORE_KEY = 'newsroomAuthSession';
const PROFILE_STORE_KEY = 'newsroomOwnerProfile';
const AI_PROOF_STORE_KEY = 'newsroomAiSuperadminProof';
let aiProof = loadAiProof();
let analyticsZoom = { start: 0, end: 100 };
let clusterView = { zoom: 0.78, focus: false };
const ANALYSIS_PALETTE = ['#1ba6f7','#14b8a6','#22c55e','#ef4444','#8b5cf6','#f59e0b','#e11d48','#64748b','#06b6d4','#84cc16'];

const titles = {
  dashboard: 'Audience Insights',
  trends: 'Trend Terkini',
  monitor: 'Realtime Streams',
  report: 'Reports & Data',
  rekomendasi: 'Kanal Rekomendasi',
  rilis: 'Rilis 5W+1H',
  hoax: 'Cek Hoaks',
  converter: 'Apify / Social X Converter',
  hints: 'Hints & SOP',
  settings: 'AI Models & Settings'
};

const UI_LANGUAGE = detectUiLanguage();
const UI_LOCALE = UI_LANGUAGE === 'id' ? 'id-ID' : 'en-US';
const I18N = {
  id: {
    titles: { dashboard: 'Audience Insights', trends: 'Trend Terkini', monitor: 'Realtime Streams', report: 'Reports & Data', rekomendasi: 'Kanal Rekomendasi', rilis: 'Rilis 5W+1H', hoax: 'Cek Hoaks', converter: 'Apify / Social X Converter', hints: 'Hints & SOP', settings: 'AI Models & Settings' },
    nav: { dashboard: 'Audience Insights', trends: 'Trend Terkini', monitor: 'Aliran Realtime', report: 'Reports & Data', rekomendasi: 'Rekomendasi', rilis: '5W+1H Builder', hoax: 'Hoax Check', converter: 'Sources / Import', hints: 'Workflow Hints', settings: 'AI Models & Settings' },
    labels: { sentimentOverview: 'Sentiment Overview', mentionsOverTime: 'Mentions Over Time', topSources: 'Top Sources', shareOfVoice: 'Share of Voice', topAuthors: 'Top Authors / Accounts', startMonitoring: 'Start Monitoring', monitoring: 'Monitoring...', stop: 'Stop', clearStream: 'Clear Stream', durationPrefix: 'Durasi', reportLanguageId: 'Bahasa Indonesia', reportLanguageEn: 'English', mentions: 'mentions', data: 'data', positive: 'Positif', neutral: 'Netral', negative: 'Negatif', total: 'Total', secureAccess: 'Secure newsroom access', loginText: 'Masuk ke ruang kerja redaksi untuk monitoring isu, audience insights, report, cek hoaks, dan integrasi AI Tools.', accessPassword: 'Password akses', rememberLogin: 'Ingat login di browser ini', signIn: 'Masuk Aplikasi', socialSources: 'Social Sources', addSource: '+ Add Source', checkingServer: 'Checking server...', notSynced: 'Belum sinkron', sessionInactive: 'Sesi belum aktif' }
  },
  en: {
    titles: { dashboard: 'Audience Insights', trends: 'Current Trends', monitor: 'Realtime Streams', report: 'Reports & Data', rekomendasi: 'Recommendation Channel', rilis: '5W+1H Release', hoax: 'Hoax Check', converter: 'Apify / Social X Converter', hints: 'Hints & SOP', settings: 'AI Models & Settings' },
    nav: { dashboard: 'Audience Insights', trends: 'Current Trends', monitor: 'Realtime Streams', report: 'Reports & Data', rekomendasi: 'Recommendations', rilis: '5W+1H Builder', hoax: 'Hoax Check', converter: 'Sources / Import', hints: 'Workflow Hints', settings: 'AI Models & Settings' },
    labels: { sentimentOverview: 'Sentiment Overview', mentionsOverTime: 'Mentions Over Time', topSources: 'Top Sources', shareOfVoice: 'Share of Voice', topAuthors: 'Top Authors / Accounts', startMonitoring: 'Start Monitoring', monitoring: 'Monitoring...', stop: 'Stop', clearStream: 'Clear Stream', durationPrefix: 'Duration', reportLanguageId: 'Bahasa Indonesia', reportLanguageEn: 'English', mentions: 'mentions', data: 'data', positive: 'Positive', neutral: 'Neutral', negative: 'Negative', total: 'Total', secureAccess: 'Secure newsroom access', loginText: 'Sign in to the newsroom workspace for issue monitoring, audience insights, reports, hoax checking, and AI Tools integration.', accessPassword: 'Access password', rememberLogin: 'Remember login in this browser', signIn: 'Sign in', socialSources: 'Social Sources', addSource: '+ Add Source', checkingServer: 'Checking server...', notSynced: 'Not synced yet', sessionInactive: 'Session inactive' }
  }
}

function detectUiLanguage() {
  const lang = String(navigator.language || navigator.userLanguage || 'id').toLowerCase();
  return (lang.startsWith('id') || lang.startsWith('ms')) ? 'id' : 'en';
}

function t(path, fallback = '') {
  const parts = String(path).split('.');
  let ref = I18N[UI_LANGUAGE] || I18N.id;
  for (const part of parts) ref = ref?.[part];
  return ref ?? fallback ?? path;
}

function applyAutoTranslation() {
  document.documentElement.lang = UI_LANGUAGE;
  document.body.dataset.locale = UI_LANGUAGE;
  // Main navigation
  $$('.nav button[data-tab]').forEach(btn => {
    const key = btn.dataset.tab;
    const label = I18N[UI_LANGUAGE]?.nav?.[key];
    if (label) btn.textContent = label;
  });
  // Login and sidebar basics
  const loginEyebrow = $('#loginScreen .eyebrow'); if (loginEyebrow) loginEyebrow.textContent = t('labels.secureAccess', loginEyebrow.textContent);
  const loginCopy = $('#loginScreen .login-brand p:not(.eyebrow)'); if (loginCopy) loginCopy.textContent = t('labels.loginText', loginCopy.textContent);
  const loginLabel = $('#loginForm label'); if (loginLabel && loginLabel.firstChild) loginLabel.firstChild.textContent = t('labels.accessPassword','Password akses') + ' ';
  const remember = $('#loginForm .check span'); if (remember) remember.textContent = t('labels.rememberLogin','Ingat login di browser ini');
  const loginBtn = $('#loginForm button[type="submit"]'); if (loginBtn) loginBtn.textContent = t('labels.signIn','Masuk Aplikasi');
  const socialEyebrow = $('.social-source-card .eyebrow'); if (socialEyebrow) socialEyebrow.textContent = t('labels.socialSources','Social Sources');
  const addSource = $('.add-source-btn'); if (addSource) addSource.textContent = t('labels.addSource','+ Add Source');

  const map = [
    ['section.rail-card.sentiment-rail .panel-head h3', 'labels.sentimentOverview'],
    ['section.rail-card.timeline-rail .panel-head h3', 'labels.mentionsOverTime'],
    ['section.rail-card.top-sources-rail .panel-head h3', 'labels.topSources'],
    ['#report .sov-tile h3', 'labels.shareOfVoice'],
    ['#report #authorList', 'labels.topAuthors']
  ];
  map.forEach(([sel,key]) => {
    const el = $(sel);
    if (!el) return;
    if (sel === '#report #authorList') {
      const head = el.closest('.report-tile')?.querySelector('h3');
      if (head) head.textContent = t(key, head.textContent);
    } else el.textContent = t(key, el.textContent);
  });
  const start = $('#startRt'); if (start && !start.classList.contains('is-monitoring')) start.textContent = t('labels.startMonitoring', 'Start Monitoring');
  const stop = $('#stopRt'); if (stop) stop.textContent = t('labels.stop', 'Stop');
  const clear = $('#clearStreams'); if (clear) clear.textContent = t('labels.clearStream', 'Clear Stream');
  const reportLanguage = $('#reportLanguage');
  if (reportLanguage) {
    reportLanguage.value = UI_LANGUAGE;
    const ops = reportLanguage.querySelectorAll('option');
    if (ops[0]) ops[0].textContent = t('labels.reportLanguageId','Bahasa Indonesia');
    if (ops[1]) ops[1].textContent = t('labels.reportLanguageEn','English');
  }
  // Force chart redraw after language/layout changes
  setTimeout(() => {
    if (lastAnalysis) {
      safeDrawCharts(lastAnalysis);
    }
  }, 150);
}

function updateRealtimeClock() {
  const timeEl = $('#clockTime');
  const dateEl = $('#clockDate');
  if (!timeEl || !dateEl) return;
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString(UI_LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  dateEl.textContent = now.toLocaleDateString(UI_LOCALE, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function bindRealtimeClock() {
  updateRealtimeClock();
  setInterval(updateRealtimeClock, 1000);
}

function durationLabel(days = searchDurationDays) {
  const d = SEARCH_DURATIONS.includes(Number(days)) ? Number(days) : 7;
  return UI_LANGUAGE === 'id' ? `${d} hari` : `${d} days`; 
}

function normalizeSentimentLabel(value = '') {
  const raw = String(value?.label || value || '').trim().toLowerCase();
  if (!raw) return 'netral';
  if (raw.startsWith('pos')) return 'positif';
  if (raw.startsWith('neu') || raw.startsWith('net')) return 'netral';
  if (raw.startsWith('neg')) return 'negatif';
  return raw;
}

function truncateHourKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function chartPointItems(point = {}) {
  if (Array.isArray(point.items)) return point.items;
  const items = (lastAnalysis?.items?.length ? lastAnalysis.items : lastItems) || [];
  if (!items.length) return [];
  if (point.sentiment) return items.filter(item => normalizeSentimentLabel(item.sentiment) === normalizeSentimentLabel(point.sentiment));
  if (point.sourceKey) return items.filter(item => sourceKeyMatches(item, point.sourceKey));
  if (point.timeKey) return items.filter(item => truncateHourKey(item.createdAt) === point.timeKey);
  if (point.keyword) return items.filter(item => `${item.title || ''} ${item.text || ''}`.toLowerCase().includes(String(point.keyword).toLowerCase()));
  return items;
}

function sourceKeyMatches(item, sourceKey = '') {
  const key = String(sourceKey || '').toLowerCase();
  if (!key || key === 'all') return true;
  const source = String(item.source || item.platform || '').toLowerCase();
  const platform = String(item.platform || '').toLowerCase();
  const domain = String(item.url || '').toLowerCase();
  return source === key || platform === key || source.includes(key) || key.includes(source) || domain.includes(key);
}

function getSearchDurationDays() {
  const raw = Number($('#searchDuration')?.value || $('#rtDuration')?.value || $('#reportDuration')?.value || searchDurationDays || 7);
  const safe = SEARCH_DURATIONS.includes(raw) ? raw : 7;
  searchDurationDays = safe;
  localStorage.setItem('newsroomSearchDurationDays', String(safe));
  return safe;
}

function syncDurationControls(days = searchDurationDays) {
  const safe = SEARCH_DURATIONS.includes(Number(days)) ? Number(days) : 7;
  searchDurationDays = safe;
  localStorage.setItem('newsroomSearchDurationDays', String(safe));
  $$('.duration-select').forEach(sel => { sel.value = String(safe); });
  $('#recommendationDurationBadge') && ($('#recommendationDurationBadge').textContent = `${t('labels.durationPrefix','Durasi')} ${durationLabel(safe)}`);
  if (lastAnalysis) {
    renderReport(lastAnalysis);
    renderRecommendationsChannel(lastAnalysis);
  }
}

function bindDurationControls() {
  syncDurationControls(searchDurationDays);
  $$('.duration-select').forEach(sel => sel.addEventListener('change', () => {
    syncDurationControls(Number(sel.value));
    toast(UI_LANGUAGE === 'id' ? `Durasi pencarian data diubah menjadi ${durationLabel(searchDurationDays)}. Hasil scan dan report berikutnya mengikuti durasi ini.` : `Search duration changed to ${durationLabel(searchDurationDays)}. The next scan and report will use this duration.`);
  }));
}

function safeInitStep(name, fn) {
  try { fn?.(); }
  catch (err) {
    console.error(`[init:${name}]`, err);
    const msg = $('#rtLog');
    if (msg) msg.textContent += `\nInit warning ${name}: ${err.message}`;
  }
}

function init() {
  safeInitStep('auth', bindAuth);
  safeInitStep('reveal', bindRevealToggles);
  safeInitStep('stored-session', verifyStoredSession);
  safeInitStep('tabs', bindTabs);
  safeInitStep('theme', bindTheme);
  safeInitStep('pwa', bindPwa);
  safeInitStep('topbar', bindTopbarTools);
  safeInitStep('clock', bindRealtimeClock);
  safeInitStep('settings', bindSettings);
  safeInitStep('superadmin-passwords', bindSuperadminPasswords);
  safeInitStep('profile-bind', bindProfile);
  safeInitStep('profile-load', loadProfile);
  safeInitStep('duration', bindDurationControls);
  safeInitStep('dashboard', bindDashboard);
  safeInitStep('trend-radar', bindTrendRadar);
  safeInitStep('social-pills', bindSocialPills);
  safeInitStep('data-browsers', bindDataBrowsers);
  safeInitStep('ai-gate', bindAiSuperadminGate);
  safeInitStep('analysis-zoom', bindAnalysisZoom);
  safeInitStep('cluster-tools', bindClusterMapTools);
  safeInitStep('realtime', bindRealtime);
  safeInitStep('release', bindRelease);
  safeInitStep('hoax', bindHoax);
  safeInitStep('converter', bindConverter);
  safeInitStep('report', bindReport);
  safeInitStep('load-keys', loadKeys);
  safeInitStep('server-check', checkServer);
  safeInitStep('reset-charts', resetCharts);
  safeInitStep('audience-preview', seedAudiencePreview);
  safeInitStep('dashboard-model-controls', bindDashboardModelControls);
  safeInitStep('geo-scope', bindGeoScopeControls);
  safeInitStep('chart-detail', bindChartDetailModal);
  safeInitStep('i18n', applyAutoTranslation);
  setTimeout(() => safeInitStep('realtime-rebind', bindRealtime), 300);
  setTimeout(() => safeInitStep('settings-rebind', bindSettings), 320);
}




function bindAuth() {
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#loginPassword').value;
    $('#loginMessage').textContent = 'Memeriksa akses...';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Login gagal');
      authSession = data;
      persistAuth(data, $('#rememberLogin').checked);
      updateAuthUi(data);
      hideLogin();
      toast(`Login berhasil: ${data.label}`);
    } catch (err) {
      $('#loginMessage').textContent = err.message;
      toast(err.message, true);
    }
  });
  $('#logoutBtn')?.addEventListener('click', () => logout());
}

function bindRevealToggles() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.reveal-btn');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
}

function bindTopbarTools() {
  const notifications = () => {
    const a = lastAnalysis || {};
    const total = a.total || lastItems.length || 0;
    const negPct = a.percentages?.negatif || 0;
    const top = a.viral?.[0];
    return [
      { title: 'Status realtime', text: total ? `${number(total)} item tersedia untuk dianalisis.` : 'Belum ada data realtime; jalankan scan atau upload dataset.', tone: total ? 'good' : 'warn' },
      { title: 'Prioritas humas', text: negPct >= 20 ? `Sentimen negatif ${negPct}%. Siapkan klarifikasi dan FAQ.` : `Sentimen negatif ${negPct}%. Monitoring tetap normal.`, tone: negPct >= 20 ? 'danger' : 'good' },
      { title: 'Konten viral', text: top ? `${top.source || top.platform || '-'} · skor ${top.viralScore || 0} · ${(top.title || top.text || '').slice(0, 80)}` : 'Belum ada konten viral teratas.', tone: 'info' }
    ];
  };
  const renderNotifications = () => {
    const list = $('#notificationList');
    if (!list) return;
    const rows = notifications();
    list.innerHTML = rows.map(row => `<article class="notify-item ${row.tone}"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.text)}</span></article>`).join('');
    $('#notificationBadge') && ($('#notificationBadge').textContent = String(rows.length));
  };
  $('#notificationBtn')?.addEventListener('click', () => {
    renderNotifications();
    $('#notificationPanel')?.classList.toggle('hidden');
    $('#helpPanel')?.classList.add('hidden');
  });
  $('#helpBtn')?.addEventListener('click', () => {
    $('#helpPanel')?.classList.toggle('hidden');
    $('#notificationPanel')?.classList.add('hidden');
  });
  $('#closeNotificationPanel')?.addEventListener('click', () => $('#notificationPanel')?.classList.add('hidden'));
  $('#closeHelpPanel')?.addEventListener('click', () => $('#helpPanel')?.classList.add('hidden'));
  $('#markNotificationsRead')?.addEventListener('click', () => {
    $('#notificationBadge') && ($('#notificationBadge').textContent = '0');
    $('#notificationPanel')?.classList.add('hidden');
    toast('Notifikasi ditandai sudah dibaca.');
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#notificationPanel, #helpPanel, #notificationBtn, #helpBtn')) return;
    $('#notificationPanel')?.classList.add('hidden');
    $('#helpPanel')?.classList.add('hidden');
  });
}

function persistAuth(data, remember = true) {
  localStorage.removeItem(AUTH_STORE_KEY);
  sessionStorage.removeItem(AUTH_STORE_KEY);
  const store = remember ? localStorage : sessionStorage;
  store.setItem(AUTH_STORE_KEY, JSON.stringify(data));
}


function loadAiProof() {
  const raw = sessionStorage.getItem(AI_PROOF_STORE_KEY) || localStorage.getItem(AI_PROOF_STORE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data.token || Date.now() > Number(data.expiresAt || 0)) {
      sessionStorage.removeItem(AI_PROOF_STORE_KEY);
      localStorage.removeItem(AI_PROOF_STORE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function persistAiProof(data) {
  aiProof = data;
  sessionStorage.setItem(AI_PROOF_STORE_KEY, JSON.stringify(data));
  updateAiLockUi();
}

function isAiUnlocked() {
  const proof = loadAiProof();
  aiProof = proof;
  return Boolean(proof?.token) || authSession?.mode === 'superadmin';
}

function updateAiLockUi() {
  const unlocked = isAiUnlocked();
  $$('[data-ai-lock]').forEach(el => el.classList.toggle('hidden', unlocked));
  // v6.7: API key fields stay editable so the user can paste/save keys first.
  // Actions that call AI still require superadmin proof via ensureAiUnlocked().
  $$('.ai-panel input, .ai-panel select, .ai-panel textarea, .ai-panel button, .ai-floating-panel input, .ai-floating-panel select, .ai-floating-panel button').forEach(el => {
    el.disabled = false;
    el.setAttribute('aria-disabled', 'false');
  });
  const badge = $('#aiAccessBadge');
  if (badge) {
    badge.textContent = unlocked ? 'Superadmin verified' : 'Locked - input aktif, test butuh unlock';
    badge.classList.toggle('good', unlocked);
    badge.classList.toggle('warn', !unlocked);
  }
}

async function ensureAiUnlocked() {
  if (isAiUnlocked()) return true;
  openAiUnlockModal();
  return false;
}

function openAiUnlockModal() {
  $('#aiUnlockModal')?.classList.remove('hidden');
  $('#aiUnlockPassword')?.focus();
}

function closeAiUnlockModal() {
  $('#aiUnlockModal')?.classList.add('hidden');
  const msg = $('#aiUnlockMessage');
  if (msg) msg.textContent = 'AI settings masih terkunci.';
  const input = $('#aiUnlockPassword');
  if (input) input.value = '';
}

function bindAiSuperadminGate() {
  updateAiLockUi();
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-ai-unlock]');
    if (open) openAiUnlockModal();
  });
  ['closeAiUnlock','cancelAiUnlock'].forEach(id => $('#' + id)?.addEventListener('click', closeAiUnlockModal));
  $('#verifyAiUnlock')?.addEventListener('click', async () => {
    const password = $('#aiUnlockPassword')?.value || '';
    const msg = $('#aiUnlockMessage');
    if (msg) msg.textContent = 'Memverifikasi password superadmin...';
    try {
      const data = await api('/api/superadmin/verify', { method: 'POST', body: JSON.stringify({ password }) });
      persistAiProof({ token: data.token, expiresAt: data.expiresAt, expiresAtIso: data.expiresAtIso });
      if (msg) msg.textContent = data.message || 'Akses AI aktif.';
      toast('AI Settings aktif untuk superadmin.');
      const action = pendingAiAction;
      pendingAiAction = null;
      setTimeout(closeAiUnlockModal, 450);
      if (typeof action === 'function') setTimeout(() => action(), 520);
    } catch (err) {
      if (msg) msg.textContent = err.message;
      toast(err.message, true);
    }
  });
  $('#aiUnlockPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#verifyAiUnlock')?.click(); });
}

function loadAuth() {
  const raw = localStorage.getItem(AUTH_STORE_KEY) || sessionStorage.getItem(AUTH_STORE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data.token || Date.now() > Number(data.expiresAt || 0)) {
      localStorage.removeItem(AUTH_STORE_KEY);
      sessionStorage.removeItem(AUTH_STORE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function verifyStoredSession() {
  const saved = loadAuth();
  if (!saved) { showLogin(); return; }
  authSession = saved;
  updateAuthUi(saved);
  hideLogin();
  try {
    const session = await api('/api/auth/session');
    if (session?.session) updateAuthUi({ ...saved, ...session.session, expiresAt: session.session.expiresAt, label: session.session.label });
  } catch {
    logout(false);
  }
}

function getAuthToken() {
  return authSession?.token || loadAuth()?.token || '';
}

function showLogin() {
  document.body.classList.add('auth-pending');
  $('#loginScreen')?.classList.remove('hidden');
  $('#loginPassword')?.focus();
}

function hideLogin() {
  document.body.classList.remove('auth-pending');
  $('#loginScreen')?.classList.add('hidden');
}

function logout(showMessage = true) {
  localStorage.removeItem(AUTH_STORE_KEY);
  sessionStorage.removeItem(AUTH_STORE_KEY);
  sessionStorage.removeItem(AI_PROOF_STORE_KEY);
  localStorage.removeItem(AI_PROOF_STORE_KEY);
  authSession = null;
  aiProof = null;
  stopSocket(false);
  updateAuthUi(null);
  showLogin();
  if (showMessage) toast('Anda sudah logout.');
}

function updateAuthUi(session) {
  const pill = $('#licensePill');
  const expiry = $('#licenseExpiry');
  if (!session) {
    if (pill) pill.textContent = 'Belum login';
    if (expiry) expiry.textContent = 'Sesi belum aktif';
    return;
  }
  const expiresAt = new Date(Number(session.expiresAt));
  const label = session.label || (session.mode === 'superadmin' ? 'Superadmin' : session.mode === 'package' ? 'Paket Aktif' : 'Demo 3 Hari');
  if (pill) {
    pill.textContent = label;
    pill.classList.toggle('full', session.mode === 'superadmin' || session.mode === 'package');
  }
  if (expiry) {
    if (session.mode === 'superadmin') expiry.textContent = 'Superadmin aktif - dapat mengatur password demo/paket dan unlock AI settings';
    else expiry.textContent = `${label} sampai ${expiresAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`;
  }
  updateAiLockUi();
}

function bindTabs() {
  $$('.nav button, .switch').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
}

function activateTab(tab) {
  $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach(section => section.classList.toggle('active', section.id === tab));
  if ($('#pageTitle')) $('#pageTitle').textContent = (I18N[UI_LANGUAGE]?.titles?.[tab] || titles[tab] || 'Newsroom Intelligence');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindTheme() {
  const saved = localStorage.getItem('newsroomTheme') || 'light';
  setTheme(saved);
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('newsroomTheme', next);
    if (lastAnalysis) renderAll(lastAnalysis);
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  const btn = $('#themeToggle');
  btn.querySelector('span').textContent = theme === 'dark' ? '🌙' : '☀️';
  btn.querySelector('b').textContent = theme === 'dark' ? 'Dark' : 'Light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#08111f' : '#f8fafc';
}

function bindPwa() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installBtn').hidden = true;
  });
}

function headers() {
  return {
    'x-newsroom-auth': getAuthToken(),
    'x-google-factcheck-key': $('#factKey')?.value || '',
    'x-mafindo-key': $('#mafindoKey')?.value || '',
    'x-apify-token': $('#apifyToken')?.value || '',
    'x-sumopod-api-key': $('#sumopodKey')?.value || '',
    'x-sumopod-base-url': $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
    'x-sumopod-model': getSelectedSumopodModel(),
    'x-superadmin-proof': aiProof?.token || ''
  };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...headers(),
      ...(options.headers || {})
    }
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || 'Request gagal');
  return data;
}

async function apiWithTimeout(path, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await api(path, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError' || /abort/i.test(String(err?.message || ''))) {
      throw new Error(`Request terlalu lama setelah ${Math.round(timeoutMs / 1000)} detik. Aplikasi tidak crash; coba ulangi atau gunakan mode fallback lokal.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function setButtonLoading(btn, loading = false, label = '') {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = label || 'Memproses...';
    btn.disabled = true;
    btn.classList.add('is-loading');
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

async function checkServer() {
  try {
    const health = await api('/health');
    $('#serverStatus').textContent = health.ok ? 'Server online' : 'Server issue';
    $('#pulse').classList.add('ok');
    $('#lastSync').textContent = new Date(health.timestamp).toLocaleTimeString('id-ID');
  } catch (err) {
    $('#serverStatus').textContent = 'Server offline';
    toast(err.message, true);
  }
}

function saveKeys() {
  const payload = {
    fact: $('#factKey')?.value || '',
    mafindo: $('#mafindoKey')?.value || '',
    apify: $('#apifyToken')?.value || '',
    sumopodKey: $('#sumopodKey')?.value || '',
    sumopodBaseUrl: $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
    sumopodModel: getSelectedSumopodModel(),
    sumopodModelSelect: $('#sumopodModel')?.value || 'claude-opus-4-8',
    sumopodCustomModel: $('#sumopodCustomModel')?.value || '',
    remember: $('#rememberKeys')?.checked || false
  };
  const store = payload.remember ? localStorage : sessionStorage;
  localStorage.removeItem('newsroomKeys');
  sessionStorage.removeItem('newsroomKeys');
  store.setItem('newsroomKeys', JSON.stringify(payload));
  return payload;
}

async function runAiToolsTest() {
  const key = $('#sumopodKey')?.value.trim() || '';
  if (!key) { toast('Isi API key AI Tools terlebih dahulu.', true); $('#sumopodKey')?.focus(); return; }
  saveKeys();
  const btn = $('#testSumopodBtn');
  setButtonLoading(btn, true, 'Testing AI...');
  $('#sumopodResult') && ($('#sumopodResult').textContent = 'Menghubungi AI Tools. Timeout dinaikkan agar tidak abort saat respons AI lambat...');
  try {
    const data = await apiWithTimeout('/api/sumopod/test', {
      method: 'POST',
      headers: {
        'x-sumopod-api-key': key,
        'x-sumopod-base-url': $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
        'x-sumopod-model': getSelectedSumopodModel(),
        'x-superadmin-proof': aiProof?.token || ''
      },
      body: JSON.stringify({
        prompt: $('#sumopodPrompt')?.value || 'Buat satu insight redaksi singkat.',
        sumopodApiKey: key,
        sumopodBaseUrl: $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
        sumopodModel: getSelectedSumopodModel(),
        maxTokens: 500,
        temperature: 0.4,
        superadminProof: aiProof?.token || ''
      })
    }, 120000);
    lastSumopodText = data.text || '';
    $('#sumopodResult') && ($('#sumopodResult').textContent = lastSumopodText || 'Respons AI Tools kosong. Periksa model dan saldo API.');
    toast('AI Tools API berhasil dites.');
  } catch (err) {
    $('#sumopodResult') && ($('#sumopodResult').textContent = err.message);
    toast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

function bindKeyAutosave() {
  ['factKey','mafindoKey','apifyToken','sumopodKey','sumopodBaseUrl','sumopodModel','sumopodCustomModel'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.autosaveBound === 'true') return;
    el.addEventListener('input', () => {
      try { saveKeys(); } catch {}
      if (id === 'sumopodKey') $('#sumopodResult') && ($('#sumopodResult').textContent = el.value.trim() ? 'API key siap dites. Klik Test AI Tools.' : 'Belum dites.');
    });
    el.addEventListener('change', () => { try { saveKeys(); } catch {} });
    el.dataset.autosaveBound = 'true';
  });
}

function bindSettings() {
  bindKeyAutosave();
  $('#saveKeysBtn')?.addEventListener('click', async () => {
    const payload = saveKeys();
    toast(payload.remember ? 'Settings dan AI Tools disimpan di browser.' : 'Settings aktif untuk sesi ini.');
  });
  $('#clearKeysBtn')?.addEventListener('click', () => {
    localStorage.removeItem('newsroomKeys');
    sessionStorage.removeItem('newsroomKeys');
    ['factKey', 'mafindoKey', 'apifyToken', 'sumopodKey'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
    $('#sumopodBaseUrl').value = 'https://ai.sumopod.com/v1';
    $('#sumopodModel').value = 'claude-opus-4-8'; if ($('#sumopodCustomModel')) $('#sumopodCustomModel').value = ''; syncModelControls();
    $('#rememberKeys').checked = false;
    $('#sumopodResult').textContent = 'Belum dites.';
    toast('Settings dihapus. Mode gratis/no-key tetap aktif.');
  });
  $('#testSumopodBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!isAiUnlocked()) {
      pendingAiAction = runAiToolsTest;
      openAiUnlockModal();
      toast('Verifikasi superadmin dulu. Setelah berhasil, test AI Tools otomatis berjalan.');
      return;
    }
    runAiToolsTest();
  });
  $('#copySumopodBtn')?.addEventListener('click', async () => {
    const text = lastSumopodText || $('#sumopodResult')?.textContent || '';
    if (!text || text === 'Belum dites.') return toast('Belum ada hasil AI Tools.', true);
    await navigator.clipboard.writeText(text);
    toast('Hasil AI Tools disalin.');
  });
}


function bindSuperadminPasswords() {
  const planInputs = {
    demo3: '#newDemoPassword',
    p7: '#package7Password',
    p30: '#package30Password',
    p60: '#package60Password',
    p90: '#package90Password',
    p365: '#package365Password'
  };
  const renderStatus = (data) => {
    const box = $('#passwordStatus');
    if (!box) return;
    const plans = (data.plans || []).map(p => `<span class="status-chip ${p.configured ? 'good' : 'warn'}">${escapeHtml(p.label)}: ${p.configured ? 'aktif' : 'belum diisi'}</span>`).join(' ');
    box.innerHTML = `Status: <strong>${escapeHtml(data.mode || 'superadmin')}</strong>. ${escapeHtml(data.message || 'Akses superadmin aktif.')}<div class="status-chip-row">${plans}</div>`;
  };
  $('#checkPasswordStatusBtn')?.addEventListener('click', async () => {
    const box = $('#passwordStatus');
    if (box) box.textContent = 'Mengecek akses superadmin...';
    try {
      const data = await api('/api/superadmin/passwords');
      renderStatus(data);
    } catch (err) {
      if (box) box.textContent = err.message;
      toast(err.message, true);
    }
  });
  $('#savePasswordsBtn')?.addEventListener('click', async () => {
    const planPasswords = {};
    Object.entries(planInputs).forEach(([id, selector]) => { const value = $(selector)?.value.trim() || ''; if (value) planPasswords[id] = value; });
    if (!Object.keys(planPasswords).length) return toast('Isi minimal satu password untuk demo atau paket.', true);
    if (Object.values(planPasswords).some(v => v.length < 6)) return toast('Semua password minimal 6 karakter.', true);
    const box = $('#passwordStatus');
    if (box) box.textContent = 'Menyimpan password demo/paket...';
    try {
      const data = await api('/api/superadmin/passwords', {
        method: 'POST',
        body: JSON.stringify({ planPasswords })
      });
      Object.values(planInputs).forEach(selector => { const input = $(selector); if (input) input.value = ''; });
      renderStatus(data);
      toast('Password demo dan paket berhasil diperbarui.');
    } catch (err) {
      if (box) box.textContent = err.message;
      toast(err.message, true);
    }
  });
}

function getOwnerProfile() {
  const fallback = { name: 'Newsroom Admin', role: 'Superadmin' };
  try {
    const raw = localStorage.getItem(PROFILE_STORE_KEY) || sessionStorage.getItem(PROFILE_STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      name: String(parsed.name || fallback.name).trim() || fallback.name,
      role: String(parsed.role || fallback.role).trim() || fallback.role
    };
  } catch {
    return fallback;
  }
}

function loadProfile() {
  const profile = getOwnerProfile();
  const nameInput = $('#profileOwnerName');
  const roleInput = $('#profileOwnerRole');
  if (nameInput) nameInput.value = profile.name;
  if (roleInput) roleInput.value = profile.role;
  updateProfileUi(profile);
}

function updateProfileUi(profile) {
  const clean = profile || getOwnerProfile();
  if ($('#profileDisplayName')) $('#profileDisplayName').textContent = clean.name;
  if ($('#profileDisplayRole')) $('#profileDisplayRole').textContent = clean.role;
}

function bindProfile() {
  $('#saveProfileBtn')?.addEventListener('click', () => {
    const profile = {
      name: ($('#profileOwnerName')?.value || 'Newsroom Admin').trim() || 'Newsroom Admin',
      role: ($('#profileOwnerRole')?.value || 'Editor-in-Chief').trim() || 'Editor-in-Chief'
    };
    localStorage.setItem(PROFILE_STORE_KEY, JSON.stringify(profile));
    updateProfileUi(profile);
    toast('Profil pemilik akun berhasil disimpan.');
  });
  $('#resetProfileBtn')?.addEventListener('click', () => {
    localStorage.removeItem(PROFILE_STORE_KEY);
    sessionStorage.removeItem(PROFILE_STORE_KEY);
    loadProfile();
    toast('Profil dikembalikan ke default.');
  });
}

function loadKeys() {
  const raw = localStorage.getItem('newsroomKeys') || sessionStorage.getItem('newsroomKeys');
  if (!raw) return;
  try {
    const key = JSON.parse(raw);
    if ($('#factKey')) $('#factKey').value = key.fact || '';
    if ($('#mafindoKey')) $('#mafindoKey').value = key.mafindo || '';
    if ($('#apifyToken')) $('#apifyToken').value = key.apify || '';
    if ($('#sumopodKey')) $('#sumopodKey').value = key.sumopodKey || '';
    if ($('#sumopodBaseUrl')) $('#sumopodBaseUrl').value = key.sumopodBaseUrl || 'https://ai.sumopod.com/v1';
    setSumopodModelValue(key.sumopodModel || key.sumopodModelSelect || 'claude-opus-4-8', key.sumopodCustomModel || '');
    if ($('#rememberKeys')) $('#rememberKeys').checked = Boolean(key.remember);
    syncModelControls();
  } catch {}
}


function seedAudiencePreview() {
  // v4.4: tidak memakai angka simulasi. Dashboard menunggu data real dari realtime scan, RSS/GDELT/Bluesky/Apify/import scraper.
  currentQuery = 'Indonesia';
  lastItems = [];
  lastAnalysis = null;
  renderAll(null);
  renderStreams([]);
  updateFilterOptions([]);
  renderAnalysisStudio(null);
}


function bindDashboard() {
  $('#quickRun').addEventListener('click', async () => {
    currentQuery = $('#quickQuery').value.trim() || 'Indonesia';
    toast('Mengambil data realtime...');
    try {
      const result = await api('/api/free/live', {
        method: 'POST',
        body: JSON.stringify({ query: currentQuery, sources: ['gdelt', 'rss', 'bluesky', 'x', 'youtube', 'instagram', 'linkedin'], max: 60, hours: getSearchDurationDays() * 24, durationDays: getSearchDurationDays(), fast: true })
      });
      applySnapshot(result);
      activateTab('dashboard');
      toast(`Scan selesai: ${result.items.length} item realtime.`);
    } catch (err) { toast(err.message, true); }
  });
}


function bindTrendRadar() {
  $('#fetchIssueTrends')?.addEventListener('click', async () => {
    const days = Number($('#trendDuration')?.value || getSearchDurationDays());
    syncDurationControls(days);
    toast('Mengambil tren nasional dan internasional dari sumber publik...');
    try {
      const data = await api(`/api/free/trends?days=${encodeURIComponent(days)}&max=24`);
      renderTrendRadar(data);
      toast(`Trend radar diperbarui: ${number((data.national || []).length + (data.international || []).length)} item.`);
    } catch (err) { toast(err.message, true); }
  });
}

function renderTrendRadar(data = {}) {
  const national = data.national || [];
  const international = data.international || [];
  const recs = data.recommendations || [];
  const card = (item, idx) => `<article class="trend-item">
    <span class="trend-index">${idx + 1}</span>
    <div><strong>${escapeHtml(item.title || '-')}</strong><p>${escapeHtml(item.reason || 'Relevan sebagai indikator percakapan publik terkini.')}</p><small>${escapeHtml(item.source || item.author || 'RSS')} · ${dateShort(item.createdAt)} ${item.url ? `· <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Buka</a>` : ''}</small></div>
  </article>`;
  $('#nationalTrends') && ($('#nationalTrends').innerHTML = national.map(card).join('') || '<p class="muted">Tidak ada tren nasional yang ditemukan.</p>');
  $('#internationalTrends') && ($('#internationalTrends').innerHTML = international.map(card).join('') || '<p class="muted">Tidak ada tren internasional yang ditemukan.</p>');
  $('#trendRecommendations') && ($('#trendRecommendations').innerHTML = recs.map((r, i) => `<article class="trend-item action"><span class="trend-index">${i + 1}</span><div><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.detail)}</p><small>${escapeHtml(r.action)}</small></div></article>`).join('') || '<p class="muted">Belum ada rekomendasi.</p>');
}

function bindSocialPills() {
  $$('.social-pills button').forEach(btn => btn.addEventListener('click', () => {
    sourceView = btn.dataset.sourceView || 'all';
    $$('.social-pills button').forEach(b => b.classList.toggle('active', b === btn));
    renderStreams(lastItems);
    renderReportDataTable();
    renderDataTable(lastItems);
    toast(sourceView === 'all' ? 'Menampilkan semua sumber.' : `Filter tampilan: ${sourceView}`);
  }));
}

function bindDataBrowsers() {
  ['reportSearch', 'reportSourceFilter', 'reportSentimentFilter', 'reportSort'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', () => { reportPage = 1; renderReportDataTable(); });
    if (el) el.addEventListener('change', () => { reportPage = 1; renderReportDataTable(); });
  });
  ['audienceSearch', 'audienceSourceFilter', 'audienceSentimentFilter', 'audienceSort'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', () => { audiencePage = 1; renderAudienceDataTable(); });
    if (el) el.addEventListener('change', () => { audiencePage = 1; renderAudienceDataTable(); });
  });
  ['streamSearch', 'streamSourceFilter', 'streamSentimentFilter', 'streamSort'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', () => { streamPages = { news: 1, social: 1, viral: 1 }; renderStreams(lastItems); });
    if (el) el.addEventListener('change', () => { streamPages = { news: 1, social: 1, viral: 1 }; renderStreams(lastItems); });
  });
  ['dataSearch', 'dataSourceFilter', 'dataSentimentFilter', 'dataSort'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', () => { dataPage = 1; renderDataTable(lastItems); });
    if (el) el.addEventListener('change', () => { dataPage = 1; renderDataTable(lastItems); });
  });
  $('#sumopodModel')?.addEventListener('change', () => { syncModelControls(); syncDashboardModelFromSettings(); });
  $('#sumopodCustomModel')?.addEventListener('input', () => { syncModelControls(); syncDashboardModelFromSettings(); });
  $$('.model-chip-row button').forEach(btn => btn.addEventListener('click', () => {
    const model = btn.dataset.model || 'claude-opus-4-8';
    $('#sumopodModel').value = model;
    if (model !== 'custom' && $('#sumopodCustomModel')) $('#sumopodCustomModel').value = '';
    syncModelControls();
    syncDashboardModelFromSettings();
    if (model === 'custom') $('#sumopodCustomModel')?.focus();
  }));
}

function getSelectedSumopodModel() {
  const selected = $('#sumopodModel')?.value || 'claude-opus-4-8';
  if (selected === 'custom') return ($('#sumopodCustomModel')?.value || '').trim() || 'claude-opus-4-8';
  return selected;
}

function setSumopodModelValue(model, custom = '') {
  const clean = String(model || '').trim();
  if (!clean || SUMOPOD_PRESET_MODELS.includes(clean)) {
    $('#sumopodModel').value = clean || 'claude-opus-4-8';
    if ($('#sumopodCustomModel')) $('#sumopodCustomModel').value = custom || '';
  } else {
    $('#sumopodModel').value = 'custom';
    if ($('#sumopodCustomModel')) $('#sumopodCustomModel').value = custom || clean;
  }
}

function syncModelControls() {
  const selected = $('#sumopodModel')?.value || 'claude-opus-4-8';
  const isCustom = selected === 'custom';
  $('#customModelWrap')?.classList.toggle('hidden', !isCustom);
  $$('.model-chip-row button').forEach(btn => btn.classList.toggle('active', btn.dataset.model === selected));
}


function bindDashboardModelControls() {
  const dashSelect = $('#dashSumopodModel');
  const dashCustom = $('#dashSumopodCustomModel');
  if (!dashSelect) return;
  syncDashboardModelFromSettings();
  dashSelect.addEventListener('change', () => {
    const value = dashSelect.value;
    $('#dashCustomModelWrap')?.classList.toggle('hidden', value !== 'custom');
    if ($('#sumopodModel')) $('#sumopodModel').value = value;
    if (value !== 'custom') {
      if (dashCustom) dashCustom.value = '';
      if ($('#sumopodCustomModel')) $('#sumopodCustomModel').value = '';
    }
    syncModelControls();
  });
  dashCustom?.addEventListener('input', () => {
    if ($('#sumopodModel')) $('#sumopodModel').value = 'custom';
    if ($('#sumopodCustomModel')) $('#sumopodCustomModel').value = dashCustom.value;
    syncModelControls();
  });
  $('#dashSaveModel')?.addEventListener('click', async () => {
    if (!(await ensureAiUnlocked())) return;
    saveKeys();
    toast(`Model AI aktif: ${getSelectedSumopodModel()}`);
  });
}

function syncDashboardModelFromSettings() {
  const dashSelect = $('#dashSumopodModel');
  if (!dashSelect) return;
  const model = $('#sumopodModel')?.value || 'claude-opus-4-8';
  dashSelect.value = model;
  const custom = $('#sumopodCustomModel')?.value || '';
  if ($('#dashSumopodCustomModel')) $('#dashSumopodCustomModel').value = custom;
  $('#dashCustomModelWrap')?.classList.toggle('hidden', model !== 'custom');
}

function syncModelChips() { syncModelControls(); }


function updateRealtimeStatus(status = 'Siap monitoring', detail = {}) {
  const strip = $('#realtimeStatusStrip');
  $('#realtimeStatusText') && ($('#realtimeStatusText').textContent = status);
  $('#realtimeModeText') && ($('#realtimeModeText').textContent = detail.mode || lastSearchPayload?.searchMode || '-');
  $('#realtimeGeoText') && ($('#realtimeGeoText').textContent = detail.geo || lastSearchPayload?.geo?.label || 'Global');
  $('#realtimeDataText') && ($('#realtimeDataText').textContent = detail.data || `${number(lastItems.length || 0)} item`);
  if (strip) {
    strip.classList.toggle('is-active', Boolean(detail.active));
    strip.classList.toggle('is-error', Boolean(detail.error));
  }
}

function setMonitoringState(active = false) {
  monitoringActive = !!active;
  const startBtn = document.getElementById('startRt');
  const stopBtn = document.getElementById('stopRt');
  if (startBtn) {
    startBtn.dataset.active = active ? 'true' : 'false';
    startBtn.textContent = active ? t('labels.monitoring','Monitoring...') : t('labels.startMonitoring','Start Monitoring');
    startBtn.disabled = !!active;
    startBtn.classList.toggle('is-monitoring', !!active);
  }
  if (stopBtn) stopBtn.disabled = !active;
  updateRealtimeStatus(active ? 'Monitoring aktif' : 'Siap monitoring', { active });
}

function bindRealtime() {
  setMonitoringState(false);
  const startBtn = $('#startRt');
  const stopBtn = $('#stopRt');
  const resetBtn = $('#clearStreams');
  const handleStart = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (monitoringActive) return;
    const payload = buildSearchPayloadFromForm();
    if (!payload) return;
    startStableMonitoring(payload);
  };
  const handleStop = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); stopSocket(true); };
  const handleReset = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); resetAllData(true); };
  if (startBtn && startBtn.dataset.boundRealtime !== 'true') { startBtn.addEventListener('click', handleStart); startBtn.onclick = handleStart; startBtn.disabled = false; startBtn.dataset.boundRealtime = 'true'; }
  if (stopBtn && stopBtn.dataset.boundRealtime !== 'true') { stopBtn.addEventListener('click', handleStop); stopBtn.onclick = handleStop; stopBtn.dataset.boundRealtime = 'true'; }
  if (resetBtn && resetBtn.dataset.boundRealtime !== 'true') { resetBtn.addEventListener('click', handleReset); resetBtn.onclick = handleReset; resetBtn.dataset.boundRealtime = 'true'; }
  if (!startBtn) console.warn('Start Monitoring button tidak ditemukan saat binding.');
  if (document.body.dataset.realtimeDelegated !== 'true') {
    document.body.addEventListener('click', (e) => {
      const target = e.target.closest?.('#startRt,#stopRt,#clearStreams');
      if (!target) return;
      if (target.id === 'startRt') return handleStart(e);
      if (target.id === 'stopRt') return handleStop(e);
      if (target.id === 'clearStreams') return handleReset(e);
    }, true);
    document.body.dataset.realtimeDelegated = 'true';
  }
  updateRealtimeStatus('Siap monitoring', { active: false, data: `${number(lastItems.length || 0)} item` });
}


const GEO_SCOPE_PRESETS = {
  continent: {
    global: { label: 'Global / semua wilayah', terms: [] },
    asia: { label: 'Asia', terms: ['Asia'] },
    europe: { label: 'Eropa', terms: ['Europe', 'European'] },
    america: { label: 'Amerika', terms: ['America', 'United States', 'Latin America'] },
    africa: { label: 'Afrika', terms: ['Africa'] },
    oceania: { label: 'Oseania', terms: ['Australia', 'Oceania', 'New Zealand'] }
  },
  region: {
    'asean': { label: 'ASEAN', terms: ['ASEAN', 'Indonesia', 'Singapore', 'Malaysia', 'Thailand', 'Philippines', 'Vietnam', 'Brunei', 'Cambodia', 'Laos', 'Myanmar'] },
    'middle-east': { label: 'Middle East', terms: ['Middle East', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Turkey', 'Egypt', 'Jordan', 'Iran', 'Iraq'] },
    'gcc': { label: 'GCC', terms: ['GCC', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman'] },
    'east-asia': { label: 'East Asia', terms: ['East Asia', 'Japan', 'China', 'South Korea', 'Taiwan', 'Hong Kong'] },
    'south-asia': { label: 'South Asia', terms: ['South Asia', 'India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal'] },
    'eu': { label: 'European Union', terms: ['European Union', 'EU', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands'] },
    'north-america': { label: 'North America', terms: ['North America', 'United States', 'Canada', 'Mexico'] },
    'latin-america': { label: 'Latin America', terms: ['Latin America', 'Brazil', 'Argentina', 'Chile', 'Mexico', 'Colombia'] }
  }
};

function selectedGeoScope() {
  const continent = $('#geoContinent')?.value || 'global';
  const region = $('#geoRegion')?.value || '';
  const country = $('#geoCountry')?.value || '';
  const city = $('#geoCity')?.value.trim() || '';
  const searchMode = $('#searchMode')?.value || 'fast';
  const labels = [];
  const terms = [];
  const add = (arr = []) => arr.forEach(t => { if (t && !terms.includes(t)) terms.push(t); });
  if (GEO_SCOPE_PRESETS.continent[continent]) {
    const c = GEO_SCOPE_PRESETS.continent[continent];
    if (continent !== 'global') labels.push(c.label);
    add(c.terms);
  }
  if (region && GEO_SCOPE_PRESETS.region[region]) {
    const r = GEO_SCOPE_PRESETS.region[region];
    labels.push(r.label);
    add(r.terms);
  }
  if (country) { labels.push(country); add([country]); }
  if (city) { labels.push(city); add([city]); }
  return {
    continent, region, country, city, searchMode,
    label: labels.length ? labels.join(' · ') : 'Global / semua wilayah',
    terms: terms.slice(0, searchMode === 'deep' ? 18 : searchMode === 'standard' ? 12 : 8)
  };
}

function updateGeoScopeHint() {
  const geo = selectedGeoScope();
  const hint = $('#geoScopeHint');
  if (!hint) return;
  const terms = geo.terms.length ? geo.terms.join(', ') : 'tanpa batas wilayah';
  hint.textContent = `Cakupan: ${geo.label}. Query wilayah: ${terms}. Mode: ${geo.searchMode === 'fast' ? 'cepat' : geo.searchMode === 'deep' ? 'lengkap/deep scan' : 'standar'}.`;
}

function bindGeoScopeControls() {
  ['#geoContinent','#geoRegion','#geoCountry','#geoCity','#searchMode'].forEach(sel => {
    const el = $(sel);
    if (el) {
      el.addEventListener('input', updateGeoScopeHint);
      el.addEventListener('change', updateGeoScopeHint);
    }
  });
  $$('.geo-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.geo-chip').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      $('#geoContinent') && ($('#geoContinent').value = btn.dataset.geoContinent || 'global');
      $('#geoRegion') && ($('#geoRegion').value = btn.dataset.geoRegion || '');
      $('#geoCountry') && ($('#geoCountry').value = btn.dataset.geoCountry || '');
      $('#geoCity') && ($('#geoCity').value = btn.dataset.geoCity || '');
      updateGeoScopeHint();
    });
  });
  updateGeoScopeHint();
}

function effectiveMaxForMode(rawMax = 50, mode = 'fast') {
  const max = Number(rawMax || 50);
  if (mode === 'deep') return Math.min(Math.max(max, 60), 100);
  if (mode === 'standard') return Math.min(Math.max(max, 40), 80);
  return Math.min(Math.max(max, 20), 50);
}


function buildSearchPayloadFromForm() {
  const query = $('#rtQuery')?.value.trim() || 'Indonesia';
  let sources = $$('.rtSource:checked').map(i => i.value);
  if (!sources.length) { setMonitoringState(false); toast('Pilih minimal satu sumber realtime.', true); return null; }
  const datasetId = $('#rtDataset')?.value.trim() || '';
  if (sources.includes('apify') && !datasetId) {
    sources = sources.filter(s => s !== 'apify');
    logRt('Apify dilewati karena Dataset ID kosong. Sumber lain tetap diproses.');
    toast('Apify dilewati karena Dataset ID kosong. Isi Dataset ID jika ingin mengambil Apify.', true);
  }
  if (!sources.length) { setMonitoringState(false); toast('Tidak ada sumber aktif setelah validasi. Aktifkan RSS/GDELT/Bluesky atau isi Dataset ID Apify.', true); return null; }
  const geo = selectedGeoScope();
  const maxPerSource = effectiveMaxForMode($('#rtMax').value || 50, geo.searchMode);
  return {
    query,
    displayQuery: query,
    geo,
    sources,
    datasetId,
    platformDatasets: {
      facebook: $('#datasetFacebook')?.value.trim() || '',
      x: $('#datasetX')?.value.trim() || '',
      threads: $('#datasetThreads')?.value.trim() || '',
      youtube: $('#datasetYoutube')?.value.trim() || '',
      tiktok: $('#datasetTiktok')?.value.trim() || '',
      instagram: $('#datasetInstagram')?.value.trim() || '',
      linkedin: $('#datasetLinkedin')?.value.trim() || ''
    },
    rssUrl: $('#rssUrl')?.value.trim() || '',
    max: maxPerSource,
    hours: getSearchDurationDays() * 24,
    durationDays: getSearchDurationDays(),
    interval: Number($('#rtInterval')?.value || 60000),
    apifyToken: $('#apifyToken')?.value || '',
    searchMode: geo.searchMode,
    fast: geo.searchMode === 'fast'
  };
}

function startStableMonitoring(payload) {
  stopSocket(false);
  const runId = Date.now();
  monitorRunId = runId;
  lastSearchPayload = { ...payload, __runId: runId };
  currentQuery = payload.query;
  setMonitoringState(true);
  $('#lastSync') && ($('#lastSync').textContent = 'Mencari data...');
  updateRealtimeStatus('Mengambil data...', { active: true, mode: payload.searchMode || 'fast', geo: payload.geo?.label || 'Global', data: 'loading' });
  logRt(`Pencarian data dimulai: ${payload.query} | wilayah ${payload.geo?.label || 'Global'} | ${payload.sources.join(', ')} | durasi ${durationLabel(payload.durationDays)} | mode ${payload.searchMode || 'fast'}.`);
  toast('Pencarian data dimulai. Mengambil data dari sumber aktif...');
  runLiveHttpSearch(lastSearchPayload, { keepMonitoring: true }).then(() => {
    if (!monitoringActive || monitorRunId !== runId) return;
    const interval = Math.max(Number(payload.interval || 60000), 30000);
    httpMonitorTimer = setInterval(() => {
      if (!lastSearchPayload || !monitoringActive || monitorRunId !== runId) return;
      runLiveHttpSearch(lastSearchPayload, { keepMonitoring: true, silent: true }).catch(err => {
        logRt(`Polling gagal: ${err.message}`);
        updateRealtimeStatus('Polling gagal', { active: true, error: true, mode: payload.searchMode || 'fast', geo: payload.geo?.label || 'Global', data: `${number(lastItems.length || 0)} item` });
      });
    }, interval);
    setMonitoringState(true);
    updateRealtimeStatus('Monitoring aktif', { active: true, mode: payload.searchMode || 'fast', geo: payload.geo?.label || 'Global', data: `${number(lastItems.length || 0)} item` });
    logRt(`Monitoring HTTP aktif setiap ${Math.round(interval / 1000)} detik.`);
  }).catch(err => {
    if (monitorRunId !== runId) return;
    setMonitoringState(false);
    updateRealtimeStatus('Gagal mengambil data', { error: true, mode: payload.searchMode || 'fast', geo: payload.geo?.label || 'Global', data: `${number(lastItems.length || 0)} item` });
    toast(err.message, true);
  });
}

// Backward-compatible name: now uses HTTP polling by default for stability on localhost and Vercel.
function startSocket(payload) {
  startStableMonitoring(payload);
}

async function runLiveHttpSearch(payload, { keepMonitoring = false, silent = false } = {}) {
  const startTime = performance.now();
  try {
    const result = await api('/api/free/live', {
      method: 'POST',
      body: JSON.stringify({ ...payload, fast: payload.searchMode === 'fast', cacheBust: Date.now() })
    });
    if (payload.__runId && payload.__runId !== monitorRunId) {
      logRt('Hasil scan lama diabaikan karena monitoring sudah dihentikan/reset.');
      return result;
    }
    try {
      applySnapshot(result);
    } catch (renderErr) {
      console.error('Render error after successful search:', renderErr);
      logRt(`Render warning setelah pencarian berhasil: ${renderErr.message}`);
    }
    const elapsed = Math.round(performance.now() - startTime);
    const warnings = (result.warnings || []).map(w => `${w.source}: ${w.message}`).join(' | ');
    const perf = result.performance ? ` · fetched ${result.performance.fetched || 0}, accepted ${result.performance.accepted || result.items?.length || 0}` : '';
    logRt(`HTTP scan selesai ${elapsed} ms: ${result.items?.length || 0} item${result.cached ? ' · cache cepat' : ''}${perf}.`);
    if (warnings) logRt(`Peringatan: ${warnings}`);
    (result.errors || []).forEach(e => logRt(`Error ${e.source}: ${e.message}`));
    updateRealtimeStatus('Scan selesai', { active: keepMonitoring, mode: payload.searchMode || 'fast', geo: payload.geo?.label || result.geoScope?.label || 'Global', data: `${number(result.items?.length || 0)} item` });
    if (!silent) toast(`Pencarian selesai: ${result.items?.length || 0} item dalam ${Math.max(1, Math.round(elapsed / 1000))} detik.`);
    if (!keepMonitoring) setMonitoringState(false);
    else setMonitoringState(true);
    return result;
  } catch (err) {
    const msg = err.message?.includes('401') ? 'Sesi login habis. Silakan login ulang agar monitoring bisa berjalan.' : err.message;
    logRt(`HTTP scan gagal: ${msg}`);
    updateRealtimeStatus('HTTP scan gagal', { active: keepMonitoring, error: true, mode: payload.searchMode || 'fast', geo: payload.geo?.label || 'Global', data: `${number(lastItems.length || 0)} item` });
    if (!keepMonitoring) setMonitoringState(false);
    throw new Error(msg);
  }
}

function stopSocket(showToast = true) {
  monitorRunId += 1;
  monitoringActive = false;
  if (httpMonitorTimer) clearInterval(httpMonitorTimer);
  httpMonitorTimer = null;
  lastSearchPayload = null;
  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'stop' })); } catch {}
  }
  try { ws?.close(); } catch {}
  ws = null;
  setMonitoringState(false);
  updateRealtimeStatus('Monitoring dihentikan', { active: false, data: `${number(lastItems.length || 0)} item` });
  if (showToast) {
    logRt('Monitoring dihentikan.');
    toast('Monitoring dihentikan.');
  }
}

async function resetAllData(callServer = false) {
  stopSocket(false);
  lastItems = [];
  lastAnalysis = null;
  lastRelease = null;
  lastHoax = null;
  dataPage = 1;
  reportPage = 1;
  audiencePage = 1;
  streamPages = { news: 1, social: 1, viral: 1 };
  analyticsZoom = { start: 0, end: 100 };
  clusterView = { zoom: 1, focus: false };
  ['#streamSearch', '#dataSearch', '#reportSearch', '#audienceSearch'].forEach(sel => { const el = $(sel); if (el) el.value = ''; });
  ['#streamSourceFilter', '#dataSourceFilter', '#reportSourceFilter', '#audienceSourceFilter'].forEach(sel => { const el = $(sel); if (el) el.value = 'all'; });
  ['#streamSentimentFilter', '#dataSentimentFilter', '#reportSentimentFilter', '#audienceSentimentFilter'].forEach(sel => { const el = $(sel); if (el) el.value = 'all'; });
  clearStreams();
  updateFilterOptions([]);
  renderAll(null);
  renderStreams([]);
  renderDataTable([]);
  renderReportDataTable();
  renderAudienceDataTable();
  renderWordCloudPanels(null);
  renderDataWordCloud([]);
  seedAudiencePreview();
  $('#rtLog') && ($('#rtLog').textContent = '');
  $('#lastSync') && ($('#lastSync').textContent = 'Data direset');
  updateRealtimeStatus('Data direset - siap mulai dari awal', { active: false, data: '0 item' });
  updateRealtimeStatus('Data direset', { active: false, data: '0 item' });
  if (callServer) {
    try {
      await api('/api/free/reset', { method: 'POST', body: JSON.stringify({}) });
      toast('Data pencarian sudah direset. Silakan mulai pencarian baru.');
    } catch (err) {
      toast(`Data lokal direset, tetapi reset server gagal: ${err.message}`, true);
    }
  } else {
    toast('Data pencarian direset.');
  }
}

function logRt(text) {
  const box = $('#rtLog');
  const line = `[${new Date().toLocaleTimeString('id-ID')}] ${text}`;
  box.textContent = `${line}\n${box.textContent || ''}`.slice(0, 4500);
}

function applySnapshot(result) {
  lastAnalysis = result.analysis || null;
  lastItems = result.items || result.analysis?.items || [];
  currentQuery = result.query || currentQuery;
  if (result.durationDays) syncDurationControls(Number(result.durationDays));
  dataPage = 1;
  reportPage = 1;
  updateFilterOptions(lastItems);
  renderAll(lastAnalysis);
  renderStreams(lastItems);
  renderDataTable(lastItems);
  renderReportDataTable();
  renderAudienceDataTable();
  renderRailSourceBars(result.analysis);
  drawAudienceDonut('#audienceDonut', result.analysis);
}

function renderAll(analysis) {
  if (!analysis) {
    $('#audienceQueryLabel') && ($('#audienceQueryLabel').textContent = `#${currentQuery || 'Indonesia'}`);
    $('#dashTotal').textContent = '0';
    $('#dashSentiment').textContent = '-';
    $('#dashAlert').textContent = '-';
    $('#kpiPos').textContent = '0%';
    $('#kpiNeu').textContent = '0%';
    $('#kpiNeg').textContent = '0%';
    $('#kpiViral').textContent = '0';
    renderSocialMetrics([]);
    $('#kpiPosCount').textContent = '0 mention';
    $('#kpiNeuCount').textContent = '0 mention';
    $('#kpiNegCount').textContent = '0 mention';
    $('#keywordChips').innerHTML = 'Belum ada data.';
    $('#sourceChips').innerHTML = 'Belum ada data.';
    $('#recommendations').innerHTML = '<li>Jalankan scan terlebih dahulu.</li>';
    $('#execSummary').textContent = 'Belum ada data. Jalankan realtime scan atau upload dataset.';
    $('#domainList').innerHTML = '';
    $('#authorList').innerHTML = '';
    $('#viralTable').innerHTML = '<tr><td colspan="5">Belum ada data</td></tr>';
    $('#insightCards').innerHTML = '<div><strong>Top topic</strong><span>-</span></div><div><strong>Top source</strong><span>-</span></div><div><strong>Sentiment shift</strong><span>-</span></div><div><strong>Editor action</strong><span>Run scan</span></div>';
    renderReportDataTable();
    renderAudienceDataTable();
    renderRailSourceBars(null);
    drawAudienceDonut('#audienceDonut', null);
    $$('.segment-dynamic-row').forEach(el => el.remove());
    renderAnalysisStudio(null);
    renderRecommendationsChannel(null);
    renderWordCloudPanels(null);
    resetCharts();
    return;
  }
  $('#audienceQueryLabel') && ($('#audienceQueryLabel').textContent = `#${currentQuery || 'Indonesia'}`);
  $('#dashTotal').textContent = number(analysis.total);
  $('#dashSentiment').textContent = capitalize(analysis.dominantSentiment);
  $('#dashAlert').textContent = capitalize(analysis.alertLevel);
  $('#kpiPos').textContent = `${analysis.percentages?.positif || 0}%`;
  $('#kpiNeu').textContent = `${analysis.percentages?.netral || 0}%`;
  $('#kpiNeg').textContent = `${analysis.percentages?.negatif || 0}%`;
  $('#kpiPosCount').textContent = `${number(analysis.counts?.positif || 0)} mention`;
  $('#kpiNeuCount').textContent = `${number(analysis.counts?.netral || 0)} mention`;
  $('#kpiNegCount').textContent = `${number(analysis.counts?.negatif || 0)} mention`;
  $('#kpiViral').textContent = analysis.viral?.[0]?.viralScore || 0;
  renderSocialMetrics(analysis.items || []);
  $('#keywordChips').innerHTML = chipHtml(analysis.keywords || []);
  $('#sourceChips').innerHTML = chipHtml(analysis.topSources || []);
  $('#recommendations').innerHTML = (analysis.recommendations || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
  drawSentimentChart('#sentimentChart', analysis.counts || {});
  drawTimelineChart('#timelineChart', analysis.byHour || []);
  drawClusterMap('#clusterChart', analysis);
  renderInsightCards(analysis);
  renderAudienceSegments(analysis);
  renderReport(analysis);
  renderReportDataTable();
  renderAnalysisStudio(analysis);
  renderRecommendationsChannel(analysis);
  renderWordCloudPanels(analysis);
}


function renderAudienceSegments(analysis) {
  const container = $('#audienceSegments');
  if (!container || !analysis) return;
  $$('.segment-dynamic-row', container).forEach(el => el.remove());
  const keywords = (analysis.keywords || []).slice(0, 4);
  const palette = ['red','blue','magenta','purple'];
  const titles = [
    'Urgent issue watchers',
    'Policy & public affairs',
    'Social buzz segment',
    'Media monitoring desk'
  ];
  const cards = keywords.map((k, idx) => {
    const pct = Math.max(5, Math.round((k.count / Math.max(analysis.total || 1, 1)) * 100));
    const source = analysis.topSources?.[idx]?.term || analysis.topSources?.[idx]?.source || '-';
    const topAuthor = analysis.topAuthors?.[idx]?.term || analysis.topAuthors?.[idx]?.author || '-';
    const label = escapeHtml(k.term || titles[idx]);
    return `<article class="segment-card ${palette[idx % palette.length]}">
      <div class="seg-head"><strong>${label}</strong><span>⋮</span></div>
      <div class="seg-body segment-dynamic">
        <div class="mini-ring" style="--p:${pct}"><span>${pct}%</span></div>
        <div class="seg-stats"><p><b>Source:</b> ${escapeHtml(source)}</p><p><b>Author:</b> ${escapeHtml(topAuthor)}</p><p><b>Mentions:</b> ${number(k.count || 0)}</p></div>
        <div class="seg-persona"><strong>Editorial persona</strong><span>${escapeHtml(analysis.dominantSentiment || 'netral')} · viral score ${analysis.viral?.[idx]?.viralScore || 0}</span></div>
      </div>
    </article>`;
  }).join('');
  if (cards) container.insertAdjacentHTML('beforeend', `<div class="segment-dynamic-row">${cards}</div>`);
}

function renderReport(analysis) {
  $('#reportTitle').textContent = `Laporan Monitoring: ${currentQuery}`;
  const audit = analysis.queryRelevance || {};
  $('#reportSubtitle').textContent = `${number(analysis.total)} item dari ${analysis.topSources?.length || 0} sumber dalam durasi ${durationLabel(getSearchDurationDays())}. Sentimen dominan ${analysis.dominantSentiment}, alert ${analysis.alertLevel}.`;
  $('#reportDate').textContent = new Date(analysis.generatedAt || Date.now()).toLocaleString(UI_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
  $('#execSummary').innerHTML = `
    <strong>${escapeHtml(currentQuery)}</strong> menghasilkan <strong>${number(analysis.total)} mention</strong>.
    Distribusi sentimen: positif <strong>${analysis.percentages?.positif || 0}%</strong>, netral <strong>${analysis.percentages?.netral || 0}%</strong>, negatif <strong>${analysis.percentages?.negatif || 0}%</strong>.
    Alert redaksi: <strong>${escapeHtml(analysis.alertLevel)}</strong>. Keyword utama: <strong>${escapeHtml(analysis.keywords?.[0]?.term || '-')}</strong>.<br>
    <small><strong>Audit keyword:</strong> ${escapeHtml(audit.accuracyNote || 'Data report difilter berdasarkan kecocokan keyword.')} Diterima ${number(audit.accepted || analysis.total || 0)} dari ${number(audit.totalChecked || analysis.total || 0)} data; dikeluarkan ${number(audit.rejected || 0)} data tidak relevan.</small>
  `;
  drawShareOfVoiceChart('#sovChart', analysis.topSources || [], analysis.total || 0);
  $('#domainList').innerHTML = rankHtml(analysis.topDomains || []);
  $('#authorList').innerHTML = rankHtml(analysis.topAuthors || []);
  renderWordCloudPanels(analysis);
  const reasonEl = $('#reportKeywordReason');
  if (reasonEl) reasonEl.textContent = analysis.queryRelevance?.accuracyNote || 'Data report disaring berdasarkan kecocokan keyword pada judul, isi, penulis, sumber, domain, atau URL.';
  $('#viralTable').innerHTML = (analysis.viral || []).slice(0, 18).map(item => `
    <tr>
      <td>${escapeHtml(item.source || item.platform || '-')}</td>
      <td><span class="sentiment ${item.sentiment?.label}">${escapeHtml(item.sentiment?.label || '-')}</span></td>
      <td><strong>${item.viralScore || 0}</strong></td>
      <td>${escapeHtml(item.title || item.text || '').slice(0, 220)}</td>
      <td>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>` : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Belum ada data</td></tr>';
}

function renderStreams(items = []) {
  const source = $('#streamSourceFilter')?.value || 'all';
  const sentiment = $('#streamSentimentFilter')?.value || 'all';
  const sort = $('#streamSort')?.value || 'latest';
  const search = $('#streamSearch')?.value || '';
  const filteredItems = filterAndSortItems(filterBySourceView(items), { search, source, sentiment, sort });
  const news = filteredItems.filter(i => ['gdelt', 'rss', 'apify'].includes(i.source) || ['gdelt', 'rss'].includes(i.platform));
  const social = filteredItems.filter(i => ['bluesky', 'hackernews', 'socialx', 'x-export', 'instagram-export', 'linkedin-export', ...SOCIAL_SOURCES].includes(i.source) || ['bluesky', 'hackernews', ...SOCIAL_SOURCES].includes(i.platform));
  const viral = [...filteredItems].sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
  const newsPage = paginate(news, streamPages.news);
  const socialPage = paginate(social, streamPages.social);
  const viralPage = paginate(viral, streamPages.viral);
  $('#newsCount').textContent = news.length;
  $('#socialCount').textContent = social.length;
  $('#viralCount').textContent = viral.length;
  $('#newsStream').innerHTML = streamHtml(newsPage.items);
  $('#socialStream').innerHTML = streamHtml(socialPage.items);
  $('#viralStream').innerHTML = streamHtml(viralPage.items);
  renderPager('#newsPager', newsPage, (next) => { streamPages.news = next; renderStreams(lastItems); });
  renderPager('#socialPager', socialPage, (next) => { streamPages.social = next; renderStreams(lastItems); });
  renderPager('#viralPager', viralPage, (next) => { streamPages.viral = next; renderStreams(lastItems); });
}

function clearStreams() {
  $('#newsCount').textContent = '0';
  $('#socialCount').textContent = '0';
  $('#viralCount').textContent = '0';
  $('#newsStream').innerHTML = '';
  $('#socialStream').innerHTML = '';
  $('#viralStream').innerHTML = '';
  ['#newsPager', '#socialPager', '#viralPager'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; });
}


function metricSummary(item = {}) {
  const m = item.metrics || {};
  return {
    likes: Number(m.likes || 0),
    comments: Number(m.comments || 0),
    shares: Number(m.shares || 0),
    views: Number(m.views || item.reach || 0),
    saves: Number(m.saves || 0),
    quotes: Number(m.quotes || 0),
    followers: Number(m.followers || 0)
  };
}

function metricStrip(item = {}) {
  const m = metricSummary(item);
  return `<div class="metric-strip" title="Social metrics dari API/dataset sumber">
    <span class="metric-pill">👍 ${number(m.likes)}</span>
    <span class="metric-pill">💬 ${number(m.comments)}</span>
    <span class="metric-pill">↗ ${number(m.shares)}</span>
    <span class="metric-pill">👁 ${number(m.views)}</span>
    ${m.saves ? `<span class="metric-pill">🔖 ${number(m.saves)}</span>` : ''}
    ${m.followers ? `<span class="metric-pill">👥 ${number(m.followers)}</span>` : ''}
  </div>`;
}

function aggregateSocialMetrics(items = []) {
  return items.reduce((acc, item) => {
    const m = metricSummary(item);
    acc.likes += m.likes;
    acc.comments += m.comments;
    acc.shares += m.shares;
    acc.views += m.views;
    acc.saves += m.saves;
    acc.quotes += m.quotes;
    acc.followers += m.followers;
    return acc;
  }, { likes: 0, comments: 0, shares: 0, views: 0, saves: 0, quotes: 0, followers: 0 });
}

function renderSocialMetrics(items = []) {
  const m = aggregateSocialMetrics(items);
  $('#socialLikes') && ($('#socialLikes').textContent = number(m.likes));
  $('#socialComments') && ($('#socialComments').textContent = number(m.comments));
  $('#socialShares') && ($('#socialShares').textContent = number(m.shares));
  $('#socialViews') && ($('#socialViews').textContent = number(m.views));
}


function streamHtml(items) {
  return items.map(item => `
    <article class="stream-card">
      <div class="meta"><span>${escapeHtml(item.source || item.platform || '-')}</span><span>${dateShort(item.createdAt)}</span><span class="sentiment ${item.sentiment?.label || 'netral'}">${escapeHtml(item.sentiment?.label || 'netral')}</span><span>viral ${item.viralScore || 0}</span></div>
      <p>${escapeHtml(item.title || item.text || '').slice(0, 230)}</p>
      ${metricStrip(item)}
      ${item.url ? `<p><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Buka sumber</a></p>` : ''}
    </article>
  `).join('') || '<p class="muted">Belum ada data.</p>';
}

function bindRelease() {
  $('#releaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const data = await api('/api/5w1h', { method: 'POST', body: JSON.stringify(payload) });
      lastRelease = data;
      renderRelease(data);
      toast('Draft rilis 5W+1H berhasil dibuat.');
    } catch (err) { toast(err.message, true); }
  });
  $('#copyReleaseBtn').addEventListener('click', async () => {
    if (!lastRelease) return toast('Belum ada draft rilis.', true);
    await navigator.clipboard.writeText(`${lastRelease.title}\n\n${lastRelease.lead}\n\n${lastRelease.body}`);
    toast('Draft rilis disalin.');
  });
  $('#runAiWriter')?.addEventListener('click', runAiWriter);
  $('#copyAiWriter')?.addEventListener('click', async () => {
    const text = $('#aiWriterOutput')?.innerText?.trim() || '';
    if (!text || text.includes('Belum ada output')) return toast('Belum ada output AI.', true);
    await navigator.clipboard.writeText(text);
    toast('Output AI disalin.');
  });
}

async function runAiWriter() {
  if (!(await ensureAiUnlocked())) return;
  const key = $('#sumopodKey')?.value.trim() || '';
  if (!key) { toast('Isi API key AI Tools di Settings terlebih dahulu.', true); $('#sumopodKey')?.focus(); return; }
  saveKeys();
  const btn = $('#runAiWriter');
  setButtonLoading(btn, true, 'Generate berjalan...');
  const mode = $('#aiWriterMode')?.value || 'release';
  const content = $('#aiWriterInput')?.value.trim() || '';
  const keyword = $('#aiWriterKeyword')?.value.trim() || currentQuery || 'isu publik';
  const audience = $('#aiWriterAudience')?.value.trim() || 'publik dan media';
  const analysisPayload = lastAnalysis || analyzeLocalItemsForAi(lastItems, keyword);
  if (!content && !analysisPayload?.total && !lastItems.length) {
    setButtonLoading(btn, false);
    return toast('Isi konten sumber atau jalankan monitoring data terlebih dahulu.', true);
  }
  $('#aiWriterOutput').textContent = 'AI sedang menyusun output SEO, AEO, GEO, hashtag, dan rilis. Proses ini bisa 20-90 detik tergantung model...';
  toast('AI Tools sedang membuat konten editorial...');
  try {
    const data = await apiWithTimeout('/api/ai/content-optimizer', {
      method: 'POST',
      headers: {
        'x-sumopod-api-key': key,
        'x-sumopod-base-url': $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
        'x-sumopod-model': getSelectedSumopodModel(),
        'x-superadmin-proof': aiProof?.token || ''
      },
      body: JSON.stringify({
        mode,
        content,
        keyword,
        query: keyword,
        audience,
        analysis: analysisPayload,
        items: lastItems.slice(0, 80),
        sumopodApiKey: key,
        sumopodBaseUrl: $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
        sumopodModel: getSelectedSumopodModel(),
        maxTokens: 1700,
        temperature: 0.42,
        superadminProof: aiProof?.token || ''
      })
    }, 150000);
    lastSumopodText = data.text || '';
    const warn = data.fallback || data.warning ? `\n\nCatatan: ${data.warning || 'AI eksternal fallback ke engine editorial lokal.'}` : '';
    $('#aiWriterOutput').innerHTML = escapeHtml((lastSumopodText || 'Respons AI kosong.') + warn).replace(/\n/g, '<br>');
    toast(data.fallback ? 'AI eksternal lambat/gagal, output fallback editorial lokal dibuat.' : 'AI content optimizer selesai.');
  } catch (err) {
    $('#aiWriterOutput').textContent = `Gagal membuat AI content: ${err.message}`;
    toast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

function analyzeLocalItemsForAi(items = [], query = '') {
  const counts = { positif: 0, netral: 0, negatif: 0 };
  const topSources = new Map();
  const keywords = new Map();
  const list = Array.isArray(items) ? items : [];
  list.forEach(item => {
    const s = item.sentiment?.label || 'netral'; counts[s] = (counts[s] || 0) + 1;
    const src = item.source || item.platform || 'unknown'; topSources.set(src, (topSources.get(src) || 0) + 1);
    String(`${item.title || ''} ${item.text || ''}`).toLowerCase().split(/[^a-z0-9\u00C0-\u024F]+/i).filter(w => w.length > 3).slice(0, 20).forEach(w => keywords.set(w, (keywords.get(w) || 0) + 1));
  });
  const total = list.length;
  const pct = k => total ? Number(((counts[k] || 0) / total * 100).toFixed(1)) : 0;
  return {
    total,
    counts,
    percentages: { positif: pct('positif'), netral: pct('netral'), negatif: pct('negatif') },
    dominantSentiment: Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'netral',
    topSources: [...topSources.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 8).map(([term,count]) => ({ term, count })),
    keywords: [...keywords.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([term,count]) => ({ term, count })),
    viral: [...list].sort((a,b)=>(b.viralScore||0)-(a.viralScore||0)).slice(0, 8),
    items: list.slice(0, 80),
    queryRelevance: { query }
  };
}

function renderRelease(data) {
  $('#releaseScore').textContent = `${data.editorialScore}%`;
  $('#releaseTitle').textContent = data.title;
  $('#releaseLead').textContent = data.lead;
  $('#releaseBody').textContent = data.body;
  $('#releaseChecklist').innerHTML = data.checklist.map(c => `<div class="checkitem ${c.complete ? 'ok' : ''}"><strong>${escapeHtml(c.label)}</strong><br>${escapeHtml(c.value)}</div>`).join('');
}

function bindHoax() {
  $('#runHoax').addEventListener('click', async () => {
    const query = $('#hoaxQuery').value.trim();
    if (!query) return toast('Masukkan klaim yang ingin dicek.', true);
    toast('Mencari bukti terbuka dan database fact-check...');
    try {
      const data = await api(`/api/hoax-check?query=${encodeURIComponent(query)}`);
      lastHoax = data;
      renderHoax(data);
      toast('Cek hoaks selesai.');
    } catch (err) { toast(err.message, true); }
  });
  $('#copyHoax').addEventListener('click', async () => {
    if (!lastHoax) return toast('Belum ada hasil cek.', true);
    await navigator.clipboard.writeText(hoaxSummary(lastHoax));
    toast('Ringkasan cek hoaks disalin.');
  });
}

function renderHoax(data) {
  const googleCount = data.providers?.google?.claims?.length || 0;
  const mafindoCount = data.providers?.mafindo?.articles?.length || 0;
  $('#hoaxResult').innerHTML = `
    <div class="verdict"><p class="eyebrow">Verdict awal</p><h3>Risiko: ${escapeHtml(capitalize(data.risk))}</h3><p>${escapeHtml(data.verdict)}</p></div>
    <p><strong>Sinyal bahasa:</strong> ${data.signalWords?.length ? data.signalWords.map(escapeHtml).join(', ') : 'tidak dominan'}</p>
    <p><strong>Google Fact Check:</strong> ${googleCount} klaim. <strong>TurnBackHoax:</strong> ${mafindoCount} artikel.</p>
    <h3>Checklist Verifikasi</h3><ol>${(data.checklist || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ol>
  `;
  const claims = (data.providers?.google?.claims || []).flatMap(claim => (claim.reviews || []).map(r => ({ title: r.title || claim.text, url: r.url, author: r.publisher, createdAt: r.reviewDate, source: 'google-factcheck', text: r.rating || claim.text, evidenceLevel: 'prioritas' })));
  const mafindo = (data.providers?.mafindo?.articles || []).map(i => ({ ...i, evidenceLevel: 'prioritas' }));
  const evidence = [...claims, ...mafindo, ...(data.evidence || [])];
  $('#evidenceList').innerHTML = evidence.slice(0, 30).map(item => `
    <article class="card">
      <div class="meta"><span>${escapeHtml(item.evidenceLevel || 'terbuka')}</span><span>${escapeHtml(item.source || item.platform || '-')}</span><span>${dateShort(item.createdAt)}</span></div>
      <p><strong>${escapeHtml(item.title || item.text || '').slice(0, 180)}</strong></p>
      <p>${escapeHtml(item.text || '').slice(0, 220)}</p>
      ${item.url ? `<p><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Buka referensi</a></p>` : ''}
    </article>
  `).join('') || '<p class="muted">Tidak ada bukti terbuka yang ditemukan.</p>';
}

function hoaxSummary(data) {
  return `Cek Hoaks: ${data.query}\nRisiko: ${data.risk}\nVerdict awal: ${data.verdict}\nSinyal: ${(data.signalWords || []).join(', ') || '-'}\nReferensi terbuka: ${(data.evidence || []).length}`;
}

function bindConverter() {
  $('#uploadBtn').addEventListener('click', async () => {
    const file = $('#uploadFile').files?.[0];
    if (!file) return toast('Pilih file CSV/JSON terlebih dahulu.', true);
    const form = new FormData();
    form.append('file', file);
    form.append('source', $('#uploadSource').value);
    form.append('query', currentQuery || $('#searchQuery')?.value || '');
    try {
      const data = await api('/api/upload', { method: 'POST', body: form });
      lastItems = data.items || [];
      lastAnalysis = data.analysis;
      currentQuery = currentQuery || `Upload ${data.filename}`;
      renderAll(lastAnalysis);
      renderStreams(lastItems);
      renderDataTable(lastItems);
      $('#convertSummary').innerHTML = `<strong>${escapeHtml(data.filename)}</strong> berhasil dikonversi: ${number(data.total)} item. Sentimen dominan: <strong>${escapeHtml(data.analysis.dominantSentiment)}</strong>.`;
      toast('File berhasil di-convert dan dianalisis.');
    } catch (err) { toast(err.message, true); }
  });
  $('#fetchDataset').addEventListener('click', async () => {
    const id = $('#datasetId').value.trim();
    if (!id) return toast('Masukkan Dataset ID Apify.', true);
    try {
      const data = await api(`/api/apify/dataset?datasetId=${encodeURIComponent(id)}&limit=200&query=${encodeURIComponent(currentQuery || $('#searchQuery')?.value || '')}`);
      lastItems = data.items || [];
      lastAnalysis = data.analysis;
      currentQuery = currentQuery || `Apify Dataset ${id}`;
      renderAll(lastAnalysis);
      renderStreams(lastItems);
      renderDataTable(lastItems);
      $('#convertSummary').innerHTML = `Dataset <strong>${escapeHtml(id)}</strong> berhasil diambil: ${number(data.total)} item.`;
      toast('Dataset Apify berhasil diambil.');
    } catch (err) { toast(err.message, true); }
  });
  $('#exportJson').addEventListener('click', () => {
    if (!lastItems.length) return toast('Belum ada data untuk diekspor.', true);
    download('newsroom-normalized-data.json', JSON.stringify(lastItems, null, 2), 'application/json');
  });
  $('#exportCsv').addEventListener('click', () => {
    if (!lastItems.length) return toast('Belum ada data untuk diekspor.', true);
    download('newsroom-normalized-data.csv', toCsv(lastItems), 'text/csv');
  });
}


function renderAudienceDataTable() {
  const source = $('#audienceSourceFilter')?.value || 'all';
  const sentiment = $('#audienceSentimentFilter')?.value || 'all';
  const sort = $('#audienceSort')?.value || 'latest';
  const search = $('#audienceSearch')?.value || '';
  const base = lastAnalysis?.items?.length ? lastAnalysis.items : lastItems;
  const filtered = filterAndSortItems(filterBySourceView(base), { search, source, sentiment, sort });
  const page = paginate(filtered, audiencePage);
  const table = $('#audienceReportTable');
  if (!table) return;
  table.innerHTML = page.items.map((item, idx) => `
    <tr>
      <td>${page.start + idx + 1}</td>
      <td><strong>${escapeHtml(item.title || item.text || '').slice(0, 150)}</strong></td>
      <td><span class="source-badge ${sourceClass(item.source)}">${escapeHtml(item.source || item.platform || '-')}</span></td>
      <td>${escapeHtml(item.author || '-')}</td>
      <td><span class="sentiment ${item.sentiment?.label || 'netral'}">${escapeHtml(item.sentiment?.label || 'netral')}</span></td>
      <td>${number(Math.round(engagement(item)))}</td>
      <td>${number(item.metrics?.views || item.reach || 0)}</td>
      <td>${dateShort(item.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="8">Belum ada data</td></tr>';
  renderPager('#audienceReportPager', page, (next) => { audiencePage = next; renderAudienceDataTable(); });
}

function renderRailSourceBars(analysis) {
  const el = $('#railSourceBars');
  if (!el) return;
  const rows = (analysis?.topSources || []).slice(0, 6);
  if (!rows.length) { el.innerHTML = '<p class="muted">Belum ada data</p>'; return; }
  const max = Math.max(...rows.map(r => r.count || 1));
  el.innerHTML = rows.map(r => {
    const pct = Math.max(5, Math.round((r.count || 0) / max * 100));
    return `<div class="bar-row"><span>${escapeHtml(r.term || r.source || '-')}</span><i><b style="width:${pct}%"></b></i><strong>${number(r.count || 0)}</strong></div>`;
  }).join('');
}

function drawAudienceDonut(selector, analysis) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const values = analysis ? [24, 29, 20, 15, 12] : [24, 29, 20, 15, 12];
  const labels = ['18–24', '25–34', '35–44', '45–54', '55+'];
  const colors = ['#22c55e', '#7c3aed', '#f97316', '#38bdf8', '#d946ef'];
  const total = values.reduce((a,b)=>a+b,0);
  const cx = Math.min(80, w * .24), cy = h / 2, r = Math.min(54, h * .36);
  let start = -Math.PI / 2;
  values.forEach((v, i) => {
    const a = v / total * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, start, start + a); ctx.closePath();
    ctx.fillStyle = colors[i]; ctx.fill(); start += a;
  });
  ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(cx, cy, r * .58, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = colorMixSurface(1); ctx.beginPath(); ctx.arc(cx, cy, r * .54, 0, Math.PI * 2); ctx.fill();
  ctx.font = '800 12px Poppins, sans-serif'; ctx.textAlign = 'left';
  labels.forEach((label, i) => {
    const y = 32 + i * 24;
    ctx.fillStyle = colors[i]; ctx.beginPath(); ctx.arc(158, y - 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.fillText(label, 172, y);
    ctx.fillStyle = css('--muted'); ctx.fillText(`${values[i].toFixed(1)}%`, 260, y);
  });
}


function renderWordCloudPanels(analysis) {
  renderWordCloud('#analysisWordCloud', analysis?.keywords || [], analysis?.total || 0);
  renderWordCloud('#reportWordCloud', analysis?.keywords || [], analysis?.total || 0);
}

function renderDataWordCloud(items = []) {
  if (!$('#dataWordCloud')) return;
  const analysis = items.length ? { keywords: keywordFrequencyFromItems(items), total: items.length } : null;
  renderWordCloud('#dataWordCloud', analysis?.keywords || [], analysis?.total || 0);
}

function keywordFrequencyFromItems(items = []) {
  const stop = new Set(['yang','dan','atau','dari','untuk','dengan','pada','dalam','ini','itu','the','and','for','from','https','com','www','news','google','rss','articles']);
  const map = new Map();
  items.forEach(item => {
    const text = `${item.title || ''} ${item.text || ''} ${item.author || ''} ${item.source || ''}`.toLowerCase();
    (text.match(/[a-z0-9#@\u00c0-\uffff]{3,}/gi) || []).forEach(w => {
      const clean = w.replace(/^#+/, '#').replace(/^@+/, '@');
      if (stop.has(clean) || /^\d+$/.test(clean)) return;
      map.set(clean, (map.get(clean) || 0) + 1);
    });
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,36).map(([term,count]) => ({ term, count }));
}

function renderWordCloud(selector, keywords = [], total = 0) {
  const box = $(selector);
  if (!box) return;
  if (!keywords?.length) {
    box.innerHTML = '<p class="muted">Belum ada data konteks/word cloud.</p>';
    return;
  }
  const max = Math.max(1, ...keywords.map(k => Number(k.count || 0)));
  box.innerHTML = keywords.slice(0, 34).map((k, idx) => {
    const weight = Math.max(.74, Math.min(1.95, .78 + (Number(k.count || 0) / max) * 1.05));
    const cls = ['c1','c2','c3','c4','c5','c6'][idx % 6];
    const pct = total ? Math.round((Number(k.count || 0) / total) * 1000) / 10 : 0;
    return `<button type="button" class="word ${cls}" data-keyword="${escapeHtml(k.term)}" style="--w:${weight}" title="${escapeHtml(k.term)} · ${number(k.count)} kemunculan · ${pct}% dari data">${escapeHtml(k.term)}<b>${number(k.count)}</b></button>`;
  }).join('');
}


function bindChartDetailModal() {
  document.addEventListener('click', (e) => {
    const word = e.target.closest('.word[data-keyword]');
    if (word) {
      const keyword = word.dataset.keyword || '';
      openChartDetail({ label: `Keyword: ${keyword}`, keyword, value: 0, items: chartPointItems({ keyword }) });
      return;
    }
    if (e.target.id === 'closeChartDetail' || e.target.closest('#closeChartDetail')) closeChartDetail();
    if (e.target.id === 'chartDetailModal') closeChartDetail();
  });
}

function closeChartDetail() {
  $('#chartDetailModal')?.classList.add('hidden');
}

function openChartDetail(point = {}) {
  const items = chartPointItems(point);
  const title = point.label || 'Detail Data Grafik';
  const meta = [];
  if (point.series) meta.push(`<span class="badge">Seri: ${escapeHtml(point.series)}</span>`);
  if (point.pct !== undefined) meta.push(`<span class="badge">Porsi: ${escapeHtml(String(point.pct))}%</span>`);
  if (point.value !== undefined) meta.push(`<span class="badge">Nilai: ${escapeHtml(String(point.value))}</span>`);
  if (point.timeKey) meta.push(`<span class="badge">Waktu: ${escapeHtml(dateShort(point.timeKey, true))}</span>`);
  if (point.sentiment) meta.push(`<span class="badge ${normalizeSentimentLabel(point.sentiment)}">Sentimen: ${escapeHtml(capitalize(normalizeSentimentLabel(point.sentiment)))}</span>`);
  if (point.sourceKey) meta.push(`<span class="badge">Sumber: ${escapeHtml(String(point.sourceKey))}</span>`);
  $('#chartDetailTitle') && ($('#chartDetailTitle').textContent = title);
  $('#chartDetailSubtitle') && ($('#chartDetailSubtitle').textContent = items.length ? `${UI_LANGUAGE === 'id' ? `Menampilkan ${number(items.length)} data yang mendasari angka pada grafik. Klik tautan untuk membuka sumber aslinya.` : `Showing ${number(items.length)} source items behind this chart point. Click links to open original sources.`}` : 'Belum ada item detail yang dapat ditampilkan untuk titik ini.');
  $('#chartDetailMeta') && ($('#chartDetailMeta').innerHTML = meta.join(''));
  const list = $('#chartDetailList');
  if (list) {
    list.innerHTML = items.slice(0, 24).map((item, idx) => {
      const sentiment = normalizeSentimentLabel(item.sentiment);
      const titleText = escapeHtml(item.title || item.text || '-');
      const snippet = escapeHtml((item.text || item.title || '').slice(0, 220));
      const url = item.url ? `<a class="detail-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Buka sumber</a>` : '<span class="muted">Tidak ada tautan sumber</span>';
      return `<article class="detail-item"><div class="detail-top"><strong>${idx + 1}. ${titleText}</strong>${url}</div><div class="detail-badges"><span class="source-badge ${sourceClass(item.source || item.platform)}">${escapeHtml(item.source || item.platform || '-')}</span><span class="sentiment ${sentiment}">${escapeHtml(sentiment)}</span><span class="badge">${dateShort(item.createdAt, true)}</span><span class="badge">Viral ${escapeHtml(String(item.viralScore || 0))}</span></div><p>${snippet}</p></article>`;
    }).join('') || '<p class="muted">Belum ada data.</p>';
  }
  $('#chartDetailModal')?.classList.remove('hidden');
}

function renderDataTable(items = []) {
  const filtered = filterAndSortItems(filterBySourceView(items), {
    search: $('#dataSearch')?.value || '',
    source: $('#dataSourceFilter')?.value || 'all',
    sentiment: $('#dataSentimentFilter')?.value || 'all',
    sort: $('#dataSort')?.value || 'latest'
  });
  const page = paginate(filtered, dataPage);
  $('#dataTable').innerHTML = page.items.map((item, idx) => `
    <tr>
      <td>${page.start + idx + 1}</td>
      <td><span class="source-badge ${sourceClass(item.source)}">${escapeHtml(item.source || '-')}</span></td>
      <td>${escapeHtml(item.author || '-')}</td>
      <td>${dateShort(item.createdAt)}</td>
      <td><span class="sentiment ${item.sentiment?.label || 'netral'}">${escapeHtml(item.sentiment?.label || 'netral')}</span></td>
      <td>${escapeHtml(item.title || item.text || '').slice(0, 240)}</td>
      <td>${metricStrip(item)}</td>
    </tr>
  `).join('') || '<tr><td colspan="7">Belum ada data</td></tr>';
  renderPager('#dataPager', page, (next) => { dataPage = next; renderDataTable(lastItems); });
  renderDataWordCloud(items);
}

function renderReportDataTable() {
  const source = $('#reportSourceFilter')?.value || 'all';
  const sentiment = $('#reportSentimentFilter')?.value || 'all';
  const sort = $('#reportSort')?.value || 'latest';
  const search = $('#reportSearch')?.value || '';
  const base = lastAnalysis?.items?.length ? lastAnalysis.items : lastItems;
  const filtered = filterAndSortItems(filterBySourceView(base), { search, source, sentiment, sort });
  const page = paginate(filtered, reportPage);
  const table = $('#reportDataTable');
  if (!table) return;
  table.innerHTML = page.items.map((item, idx) => `
    <tr>
      <td>${page.start + idx + 1}</td>
      <td><span class="source-badge ${sourceClass(item.source)}">${escapeHtml(item.source || item.platform || '-')}</span></td>
      <td>${escapeHtml(item.author || '-')}</td>
      <td><span class="sentiment ${item.sentiment?.label || 'netral'}">${escapeHtml(item.sentiment?.label || 'netral')}</span></td>
      <td><strong>${item.viralScore || 0}</strong></td>
      <td>${escapeHtml(item.title || item.text || '').slice(0, 260)} ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>` : ''}${metricStrip(item)}</td>
      <td>${dateShort(item.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="7">Belum ada data</td></tr>';
  renderPager('#reportPager', page, (next) => { reportPage = next; renderReportDataTable(); });
}

function updateFilterOptions(items = []) {
  const baseSources = ['gdelt', 'rss', 'bluesky', 'facebook', 'x', 'threads', 'youtube', 'tiktok', 'instagram', 'linkedin', 'hackernews', 'apify'];
  const sources = [...new Set([...baseSources, ...items.map(i => i.source || i.platform).filter(Boolean)])].sort();
  const html = '<option value="all">Semua sumber</option>' + sources.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const reportSource = $('#reportSourceFilter');
  const dataSource = $('#dataSourceFilter');
  const audienceSource = $('#audienceSourceFilter');
  const streamSource = $('#streamSourceFilter');
  const prevReport = reportSource?.value || 'all';
  const prevData = dataSource?.value || 'all';
  const prevAudience = audienceSource?.value || 'all';
  const prevStream = streamSource?.value || 'all';
  if (reportSource) { reportSource.innerHTML = html; reportSource.value = sources.includes(prevReport) ? prevReport : 'all'; }
  if (dataSource) { dataSource.innerHTML = html; dataSource.value = sources.includes(prevData) ? prevData : 'all'; }
  if (audienceSource) { audienceSource.innerHTML = html.replace('Semua sumber', 'All Sources'); audienceSource.value = sources.includes(prevAudience) ? prevAudience : 'all'; }
  if (streamSource) { streamSource.innerHTML = html; streamSource.value = sources.includes(prevStream) ? prevStream : 'all'; }
}


function filterAndSortItems(items = [], opts = {}) {
  const q = String(opts.search || '').toLowerCase().trim();
  const source = String(opts.source || 'all').toLowerCase();
  const sentiment = normalizeSentimentLabel(opts.sentiment || 'all');
  const sorted = items.filter(item => {
    const sourceLabel = String(item.source || item.platform || '').toLowerCase();
    const itemSentiment = normalizeSentimentLabel(item.sentiment);
    const hay = `${item.source || ''} ${item.platform || ''} ${item.author || ''} ${item.title || ''} ${item.text || ''} ${item.url || ''} ${itemSentiment}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (source !== 'all' && sourceLabel !== source) return false;
    if (sentiment !== 'all' && itemSentiment !== sentiment) return false;
    return true;
  });
  sorted.sort((a, b) => {
    if (opts.sort === 'viral') return (b.viralScore || 0) - (a.viralScore || 0);
    if (opts.sort === 'engagement') return engagement(b) - engagement(a);
    if (opts.sort === 'source') return String(a.source || a.platform || '').localeCompare(String(b.source || b.platform || ''));
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  return sorted;
}


function filterBySourceView(items = []) {
  if (sourceView === 'all') return items;
  return items.filter(i => (i.source || i.platform || '').toLowerCase() === sourceView);
}

function paginate(items = [], page = 1) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), page: current, totalPages, total: items.length, start };
}

function renderPager(selector, page, onChange) {
  const el = $(selector);
  if (!el) return;
  const pages = [];
  const start = Math.max(1, page.page - 2);
  const end = Math.min(page.totalPages, page.page + 2);
  for (let p = start; p <= end; p++) pages.push(p);
  el.innerHTML = `<span>Showing ${page.total ? page.start + 1 : 0}–${Math.min(page.start + PAGE_SIZE, page.total)} of ${number(page.total)}</span>` +
    `<button data-page="${Math.max(1, page.page - 1)}" ${page.page === 1 ? 'disabled' : ''}>Previous</button>` +
    pages.map(p => `<button data-page="${p}" class="${p === page.page ? 'active' : ''}">${p}</button>`).join('') +
    `<button data-page="${Math.min(page.totalPages, page.page + 1)}" ${page.page === page.totalPages ? 'disabled' : ''}>Next</button>`;
  el.querySelectorAll('button:not([disabled])').forEach(btn => btn.addEventListener('click', () => onChange(Number(btn.dataset.page))));
}

function engagement(item) {
  return (item.metrics?.likes || 0) + (item.metrics?.comments || 0) + (item.metrics?.shares || 0) + (item.metrics?.views || 0) * .05;
}

function sourceClass(source = '') {
  return String(source || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function reportPayload(format = 'pdf', extra = {}) {
  return {
    format,
    query: currentQuery,
    analysis: lastAnalysis,
    release: lastRelease,
    hoax: lastHoax,
    profile: getOwnerProfile(),
    durationDays: getSearchDurationDays(),
    durationLabel: durationLabel(getSearchDurationDays()),
    language: $('#reportLanguage')?.value || 'id',
    ...extra
  };
}

async function createReportDownloadLink(format = 'pdf', extra = {}) {
  const res = await fetch('/api/report/download-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify(reportPayload(format, extra))
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Gagal menyiapkan link report ${format.toUpperCase()}.`);
  return data;
}


function buildDetailedRecommendations(analysis) {
  if (!analysis || !analysis.items?.length) return [];
  const topKeyword = analysis.keywords?.[0]?.term || 'isu utama';
  const topSource = normalizeSourceLabel(analysis.topSources?.[0]?.term || analysis.topSources?.[0]?.source || 'kanal dominan');
  const topDomain = analysis.topDomains?.[0]?.term || topSource;
  const viralTitle = analysis.viral?.[0]?.title || analysis.viral?.[0]?.text || 'konten viral utama';
  const negPct = Number(analysis.percentages?.negatif || 0);
  const posPct = Number(analysis.percentages?.positif || 0);
  const actions = [
    {
      priority: 'P1',
      issue: negPct >= 20 ? `Risiko sentimen negatif ${negPct}%` : `Narasi masih perlu diperkuat pada keyword “${topKeyword}”`,
      solution: negPct >= 20 ? 'Siapkan klarifikasi berbasis fakta dan narasumber primer.' : 'Bangun angle berita dengan data, dampak publik, dan kutipan resmi.',
      steps: ['Identifikasi 3 konten dengan viral score tertinggi.', 'Cek sumber pertama dan tanggal publikasi.', 'Susun Q&A 5 pertanyaan paling mungkin ditanyakan publik.', 'Tetapkan satu juru bicara dan satu link rujukan resmi.'],
      target: '0–24 jam'
    },
    {
      priority: 'P2',
      issue: `Sumber dominan: ${topSource}`,
      solution: 'Distribusikan pesan utama pada kanal yang paling banyak menyumbang percakapan.',
      steps: ['Buat versi singkat untuk media sosial.', 'Buat versi panjang untuk website/press release.', 'Gunakan visual angka dan ringkasan 3 poin.', 'Pantau perubahan sentimen 3 kali sehari.'],
      target: '24–48 jam'
    },
    {
      priority: 'P3',
      issue: `Konten prioritas: ${String(viralTitle).slice(0, 90)}`,
      solution: 'Jadikan konten viral sebagai dasar agenda monitoring dan follow-up redaksi.',
      steps: ['Screenshot/arsipkan konten dan URL.', 'Bandingkan dengan minimal 2 sumber kredibel.', 'Hubungi pemilik data/narasumber.', 'Buat catatan redaksi: benar, perlu klarifikasi, atau perlu investigasi lanjutan.'],
      target: 'Hari ini'
    },
    {
      priority: 'P4',
      issue: `Peluang penguatan sentimen positif ${posPct}%`,
      solution: 'Angkat narasi positif sebagai bukti dampak dan trust-building.',
      steps: ['Pilih 3 testimoni/mention positif.', 'Ubah menjadi kutipan aman publikasi.', 'Buat carousel/video pendek.', 'Tautkan ke artikel utama atau press release.'],
      target: '2–3 hari'
    },
    {
      priority: 'P5',
      issue: `Domain/rujukan utama: ${topDomain}`,
      solution: 'Gunakan domain dominan sebagai peta kanal distribusi dan potensi partnership media.',
      steps: ['Audit kualitas domain dan konteks pemberitaan.', 'Cek apakah ada bias narasi.', 'Kirim update resmi ke redaksi terkait.', 'Masukkan domain ke watchlist report berikutnya.'],
      target: 'Mingguan'
    }
  ];
  return actions;
}

function renderRecommendationsChannel(analysis) {
  const intro = $('#recommendationIntro');
  const quick = $('#recommendationQuickActions');
  const plan = $('#recommendationContentPlan');
  const checklist = $('#recommendationChecklist');
  const matrix = $('#recommendationMatrix');
  const riskBadge = $('#recommendationRiskBadge');
  if (!intro || !quick || !plan || !checklist || !matrix) return;
  $('#recommendationDurationBadge') && ($('#recommendationDurationBadge').textContent = `Durasi ${durationLabel(getSearchDurationDays())}`);
  if (!analysis || !analysis.items?.length) {
    intro.textContent = 'Jalankan scan atau upload dataset untuk membuat rekomendasi yang detail, praktis, dan siap dijalankan tim humas/redaksi.';
    quick.innerHTML = '<p class="muted">Belum ada data.</p>';
    plan.innerHTML = '<p class="muted">Belum ada data.</p>';
    checklist.innerHTML = '<p class="muted">Belum ada data.</p>';
    matrix.innerHTML = '<tr><td colspan="5">Belum ada data.</td></tr>';
    if (riskBadge) { riskBadge.textContent = 'Belum ada data'; riskBadge.className = 'badge bad'; }
    return;
  }
  const recs = buildDetailedRecommendations(analysis);
  const topKeyword = analysis.keywords?.[0]?.term || '-';
  intro.textContent = `Rekomendasi otomatis dari ${number(analysis.total)} data selama ${durationLabel(getSearchDurationDays())}. Fokus utama: ${topKeyword}; sentimen dominan ${analysis.dominantSentiment}; alert ${analysis.alertLevel}.`;
  if (riskBadge) { riskBadge.textContent = `Alert ${capitalize(analysis.alertLevel)}`; riskBadge.className = `badge ${analysis.alertLevel === 'tinggi' ? 'bad' : analysis.alertLevel === 'sedang' ? 'warn' : 'good'}`; }
  quick.innerHTML = recs.slice(0, 3).map(r => `<article class="recommendation-item"><b>${escapeHtml(r.priority)}</b><div><strong>${escapeHtml(r.issue)}</strong><p>${escapeHtml(r.solution)}</p><small>${escapeHtml(r.target)}</small></div></article>`).join('');
  plan.innerHTML = recs.slice(1, 5).map(r => `<article class="recommendation-item"><b>${escapeHtml(r.priority)}</b><div><strong>${escapeHtml(r.solution)}</strong><p>${r.steps.slice(0,2).map(step => escapeHtml(step)).join(' • ')}</p></div></article>`).join('');
  const checks = ['Arsipkan bukti konten viral dan URL.', 'Verifikasi klaim ke sumber primer.', 'Tentukan juru bicara dan pesan kunci.', 'Siapkan Q&A dan statement singkat.', 'Distribusikan konten sesuai kanal dominan.', 'Pantau sentimen negatif dan komentar kritis.', 'Update report setelah durasi monitoring selesai.'];
  checklist.innerHTML = checks.map((c, i) => `<label><input type="checkbox" /> <span>${i + 1}. ${escapeHtml(c)}</span></label>`).join('');
  matrix.innerHTML = recs.map(r => `<tr><td><span class="priority-pill">${escapeHtml(r.priority)}</span></td><td>${escapeHtml(r.issue)}</td><td>${escapeHtml(r.solution)}</td><td><ol>${r.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></td><td>${escapeHtml(r.target)}</td></tr>`).join('');
}

function bindReport() {
  $('#downloadReport').addEventListener('click', async () => {
    if (!lastAnalysis) return toast('Belum ada data report.', true);
    const format = $('#reportExportFormat')?.value || 'pdf';
    try {
      const data = await createReportDownloadLink(format);
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || `newsroom-intelligence-report-${slug(currentQuery || 'monitoring')}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(`Laporan ${format.toUpperCase()} berhasil disiapkan. Link aman untuk IDM tanpa permintaan username/password.`);
    } catch (err) { toast(err.message, true); }
  });
  $('#printReport')?.addEventListener('click', async () => {
    if (!lastAnalysis) return toast('Belum ada data report untuk dicetak.', true);
    try {
      const data = await createReportDownloadLink('html', { print: true });
      window.open(data.url, '_blank', 'noopener,noreferrer');
      toast('Halaman cetak laporan dibuka. Pilih printer atau Simpan sebagai PDF dari dialog browser.');
    } catch (err) { toast(err.message, true); }
  });
  $('#sumopodInsight')?.addEventListener('click', async () => {
    if (!lastAnalysis) return toast('Jalankan scan atau upload data dulu sebelum membuat AI insight.', true);
    if (!(await ensureAiUnlocked())) return;
    if (!$('#sumopodKey').value.trim()) return toast('Isi API key AI Tools di Settings terlebih dahulu.', true);
    toast('Membuat AI Insight...');
    try {
      const data = await apiWithTimeout('/api/sumopod/editorial-insight', {
        method: 'POST',
        body: JSON.stringify({
          query: currentQuery,
          analysis: lastAnalysis,
          profile: getOwnerProfile(),
          sumopodApiKey: $('#sumopodKey')?.value.trim() || '',
          sumopodBaseUrl: $('#sumopodBaseUrl')?.value || 'https://ai.sumopod.com/v1',
          sumopodModel: getSelectedSumopodModel(),
          maxTokens: 900,
          temperature: 0.35
        })
      });
      lastSumopodText = data.text || '';
      $('#execSummary').innerHTML = `<strong>AI Insight</strong><br>${escapeHtml(lastSumopodText).replace(/\n/g, '<br>')}`;
      toast('AI insight berhasil dibuat.');
    } catch (err) { toast(err.message, true); }
  });
  $('#copySummary').addEventListener('click', async () => {
    if (!lastAnalysis) return toast('Belum ada ringkasan.', true);
    const summary = `Monitoring: ${currentQuery}\nDurasi data: ${durationLabel(getSearchDurationDays())}\nPemilik akun: ${getOwnerProfile().name}\nTotal mention: ${lastAnalysis.total}\nSentimen: positif ${lastAnalysis.percentages.positif}%, netral ${lastAnalysis.percentages.netral}%, negatif ${lastAnalysis.percentages.negatif}%\nAlert: ${lastAnalysis.alertLevel}\nKeyword utama: ${(lastAnalysis.keywords || []).slice(0, 8).map(k => k.term).join(', ')}\nRekomendasi: ${(lastAnalysis.recommendations || []).join(' ')}`;
    await navigator.clipboard.writeText(summary);
    toast('Ringkasan report disalin.');
  });
}


function bindClusterMapTools() {
  const redraw = () => drawClusterMap('#clusterChart', lastAnalysis);
  const panel = document.querySelector('.audience-map-panel');
  $('#clusterZoomIn')?.addEventListener('click', () => {
    clusterView.zoom = Math.min(2.8, Math.round((clusterView.zoom + 0.18) * 100) / 100);
    redraw();
    toast(`Zoom cluster ${Math.round(clusterView.zoom * 100)}%`);
  });
  $('#clusterZoomOut')?.addEventListener('click', () => {
    clusterView.zoom = Math.max(0.50, Math.round((clusterView.zoom - 0.18) * 100) / 100);
    redraw();
    toast(`Zoom cluster ${Math.round(clusterView.zoom * 100)}%`);
  });
  $('#clusterReset')?.addEventListener('click', () => {
    clusterView = { zoom: 0.78, focus: false };
    panel?.classList.remove('cluster-fullscreen');
    redraw();
    toast('Graph view direset.');
  });
  $('#clusterFocus')?.addEventListener('click', () => {
    clusterView.focus = !clusterView.focus;
    redraw();
    toast(clusterView.focus ? 'Focus mode cluster aktif.' : 'Focus mode cluster nonaktif.');
  });
  $('#clusterFullscreen')?.addEventListener('click', async () => {
    if (!panel) return;
    panel.classList.toggle('cluster-fullscreen');
    try {
      if (panel.classList.contains('cluster-fullscreen') && document.fullscreenEnabled && !document.fullscreenElement) await panel.requestFullscreen();
      else if (!panel.classList.contains('cluster-fullscreen') && document.fullscreenElement) await document.exitFullscreen();
    } catch {}
    setTimeout(redraw, 160);
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) panel?.classList.remove('cluster-fullscreen');
    setTimeout(redraw, 120);
  });
}

function bindAnalysisZoom() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    const action = btn.dataset.zoom;
    const span = analyticsZoom.end - analyticsZoom.start;
    const mid = (analyticsZoom.start + analyticsZoom.end) / 2;
    if (action === 'reset') analyticsZoom = { start: 0, end: 100 };
    if (action === 'in') {
      const next = Math.max(12, span * 0.68);
      analyticsZoom = { start: Math.max(0, mid - next / 2), end: Math.min(100, mid + next / 2) };
    }
    if (action === 'out') {
      const next = Math.min(100, span * 1.45);
      analyticsZoom = { start: Math.max(0, mid - next / 2), end: Math.min(100, mid + next / 2) };
    }
    renderAnalysisStudio(lastAnalysis);
    toast(action === 'reset' ? 'Zoom grafik direset.' : `Zoom grafik analisa: ${Math.round(analyticsZoom.start)}–${Math.round(analyticsZoom.end)}%`);
  });
}

function renderAnalysisStudio(analysis) {
  const root = $('#analysisStudio');
  if (!root) return;
  const empty = !analysis || !Array.isArray(analysis.items) || !analysis.items.length;
  $('#analysisTotalMentions') && ($('#analysisTotalMentions').textContent = empty ? '0' : number(analysis.total || analysis.items.length));
  $('#analysisPositiveMentions') && ($('#analysisPositiveMentions').textContent = empty ? '0' : number(analysis.counts?.positif || 0));
  $('#analysisNegativeMentions') && ($('#analysisNegativeMentions').textContent = empty ? '0' : number(analysis.counts?.negatif || 0));
  if (empty) {
    ['#analysisMentionsChart','#analysisReachChart','#analysisPositiveChart','#analysisNegativeChart','#shareReachDonut','#shareMentionDonut','#sentimentBreakdownChart','#categoryShareChart','#sourceTypesChart'].forEach(sel => drawEmptyAnalysis(sel));
    ['analysisActiveSites','analysisActiveCategories','analysisInfluential','analysisActivePeople'].forEach(id => { const el = $('#' + id); if (el) el.innerHTML = '<p class="muted">Jalankan scan realtime atau upload dataset untuk menampilkan analisa.</p>'; });
    return;
  }
  const timeline = buildAnalysisTimeline(analysis);
  const zoomed = zoomRows(timeline);
  drawLineSeries('#analysisMentionsChart', zoomed, [{ key:'mentions', label:'Menyebutkan', color:'#1f8eed' }], { suffix:'', yLabel:'mentions' });
  drawLineSeries('#analysisReachChart', zoomed, [{ key:'reach', label:'Jangkauan', color:'#0f8f68' }], { valueFormat:'compact', yLabel:'reach' });
  drawLineSeries('#analysisPositiveChart', zoomed, [{ key:'positif', label:'Positif', color:'#22c55e' }], { yLabel:'positive' });
  drawLineSeries('#analysisNegativeChart', zoomed, [{ key:'negatif', label:'Negatif', color:'#ef4444' }], { yLabel:'negative' });
  const sourceRows = (analysis.topSources || []).slice(0, 8).map((s, i) => ({ label: normalizeSourceLabel(s.term || s.source || 'source'), value: s.count || 0, reach: sourceReach(analysis.items, s.term || s.source || ''), color: ANALYSIS_PALETTE[i % ANALYSIS_PALETTE.length] }));
  drawDonutSeries('#shareReachDonut', sourceRows.map(x => ({ ...x, value: x.reach || x.value })), 'Jangkauan');
  drawDonutSeries('#shareMentionDonut', sourceRows, 'Menyebutkan');
  drawSentimentBreakdown('#sentimentBreakdownChart', analysis);
  drawCategoryShare('#categoryShareChart', sourceRows);
  drawDonutSeries('#sourceTypesChart', sourceRows, 'Source types', { wide:true });
  renderAnalysisLists(analysis, sourceRows);
}

function normalizeSourceLabel(value = '') {
  const s = String(value || '').trim();
  const m = { x:'X (Twitter)', gdelt:'News', rss:'News', 'google-news':'News', 'instagram-export':'Instagram', 'linkedin-export':'LinkedIn' };
  return m[s.toLowerCase()] || s || 'Unknown';
}

function sourceReach(items = [], source = '') {
  const key = String(source || '').toLowerCase();
  return items.filter(i => String(i.source || i.platform || '').toLowerCase() === key || String(i.source || i.platform || '').toLowerCase().includes(key)).reduce((sum, i) => sum + (i.reach || i.metrics?.views || engagement(i) || 1), 0);
}

function buildAnalysisTimeline(analysis) {
  const items = analysis.items || [];
  const map = new Map();
  for (const item of items) {
    const d = new Date(item.createdAt || Date.now());
    if (Number.isNaN(d.getTime())) continue;
    d.setHours(0,0,0,0);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key) || { key, label: d.toLocaleDateString('id-ID', { day:'2-digit', month:'short' }), mentions: 0, reach: 0, positif: 0, negatif: 0, netral: 0 };
    row.mentions += 1;
    row.reach += item.reach || item.metrics?.views || Math.round(engagement(item) || 1);
    const sentiment = item.sentiment?.label || 'netral';
    row[sentiment] = (row[sentiment] || 0) + 1;
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  if (rows.length) return rows;
  return (analysis.byHour || []).map(r => ({ label: String(r.time || '').slice(0, 10), mentions: r.total || r.count || 0, reach: (r.total || r.count || 0) * 2500, positif: r.positif || 0, negatif: r.negatif || 0, netral: r.netral || 0 }));
}

function zoomRows(rows = []) {
  if (rows.length <= 2) return rows;
  const startIdx = Math.floor((analyticsZoom.start / 100) * (rows.length - 1));
  const endIdx = Math.max(startIdx + 1, Math.ceil((analyticsZoom.end / 100) * rows.length));
  return rows.slice(startIdx, Math.min(rows.length, endIdx));
}

function drawEmptyAnalysis(selector) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = css('--surface-2');
  roundRect(ctx, 8, 8, w-16, h-16, 18); ctx.fill();
  ctx.fillStyle = css('--muted');
  ctx.font = '800 14px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Belum ada data real untuk grafik ini', w/2, h/2);
  ctx.textAlign = 'left';
}



function registerCanvasTooltip(canvas, points = [], formatter = null) {
  if (!canvas) return;
  canvas._tooltipPoints = points;
  canvas._tooltipFormatter = formatter;
  const findPoint = (x, y) => {
    const pts = canvas._tooltipPoints || [];
    let best = null;
    let bestDist = Infinity;
    pts.forEach(p => {
      const dx = x - p.x, dy = y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; best = p; }
    });
    return (!best || bestDist > (best.radius || 28)) ? null : best;
  };
  if (!canvas._tooltipBound) {
    canvas._tooltipBound = true;
    const tooltip = () => $('#chartTooltip');
    canvas.addEventListener('mousemove', (e) => {
      const box = tooltip();
      if (!box) return;
      const rect = canvas.getBoundingClientRect();
      const best = findPoint(e.clientX - rect.left, e.clientY - rect.top);
      if (!best) {
        box.classList.add('hidden');
        return;
      }
      box.innerHTML = canvas._tooltipFormatter ? canvas._tooltipFormatter(best) : `<strong>${escapeHtml(best.label || '-')}</strong><span>${escapeHtml(best.value || '')}</span>`;
      box.style.left = `${e.clientX + 14}px`;
      box.style.top = `${e.clientY + 14}px`;
      box.classList.remove('hidden');
    });
    canvas.addEventListener('mouseleave', () => tooltip()?.classList.add('hidden'));
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const best = findPoint(e.clientX - rect.left, e.clientY - rect.top);
      if (!best) return;
      openChartDetail(best);
    });
  }
}


function drawLineSeries(selector, rows, series, opts = {}) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  if (!rows?.length) return drawEmptyAnalysis(selector);
  const padL = 54, padR = 26, padT = 26, padB = 44;
  const chartW = w - padL - padR, chartH = h - padT - padB;
  const max = Math.max(1, ...series.flatMap(s => rows.map(r => Number(r[s.key] || 0))));
  ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  ctx.font = '700 11px Poppins, sans-serif'; ctx.fillStyle = css('--muted');
  for (let i=0;i<=4;i++) {
    const y = padT + (chartH/4)*i;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
    const val = Math.round(max - (max/4)*i);
    ctx.fillText(opts.valueFormat === 'compact' ? compact(val) : number(val), 8, y + 4);
  }
  const step = chartW / Math.max(rows.length - 1, 1);
  const tooltipPoints = [];
  series.forEach(s => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.beginPath();
    rows.forEach((r,i) => {
      const x = padL + i*step;
      const y = padT + chartH - (Number(r[s.key] || 0)/max)*chartH;
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.fillStyle = s.color;
    rows.forEach((r,i) => {
      const x = padL + i*step;
      const y = padT + chartH - (Number(r[s.key] || 0)/max)*chartH;
      const val = Number(r[s.key] || 0);
      tooltipPoints.push({ x, y, radius: 26, label: r.label || r.key || `Data ${i+1}`, series: s.label, value: val, color: s.color, timeKey: r.time || '', sentiment: ['Positif','Negative','Positive','Negatif'].includes(s.label) ? normalizeSentimentLabel(s.label) : '', items: chartPointItems({ timeKey: r.time || '', sentiment: ['Positif','Negative','Positive','Negatif'].includes(s.label) ? normalizeSentimentLabel(s.label) : '' }) });
      ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.fill();
    });
  });
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
  ctx.fillStyle = css('--muted'); ctx.font = '700 10px Poppins, sans-serif'; ctx.textAlign = 'center';
  rows.forEach((r,i) => { if (i % labelEvery === 0 || i === rows.length - 1) ctx.fillText(r.label || String(i+1), padL+i*step, h-16); });
  ctx.textAlign = 'left';
  series.forEach((s,i) => { ctx.fillStyle = s.color; ctx.fillRect(padL + i*110, h-12, 22, 3); ctx.fillStyle = css('--text'); ctx.fillText(s.label, padL + 28 + i*110, h-8); });
  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${escapeHtml(p.series)}: ${compact(p.value)}</span>`);
}


function drawDonutSeries(selector, rows, title = '', options = {}) {
  const canvas = $(selector); if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas); ctx.clearRect(0,0,w,h);
  if (!rows?.length || !rows.some(r=>r.value>0)) return drawEmptyAnalysis(selector);
  const total = rows.reduce((sum,r)=>sum+Number(r.value||0),0) || 1;
  const cx = options.wide ? Math.min(w*.35, 280) : w*.34;
  const cy = h*.52;
  const radius = Math.min(h*.34, options.wide ? 88 : 76);
  let start = -Math.PI/2;
  rows.forEach((r,i) => {
    const angle = (r.value/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,radius,start,start+angle); ctx.closePath();
    ctx.fillStyle = r.color || ANALYSIS_PALETTE[i%ANALYSIS_PALETTE.length]; ctx.fill(); start += angle;
  });
  ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(cx,cy,radius*.58,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css('--surface'); ctx.beginPath(); ctx.arc(cx,cy,radius*.54,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.font = '900 18px Poppins, sans-serif'; ctx.textAlign='center'; ctx.fillText(compact(total), cx, cy-2);
  ctx.fillStyle = css('--muted'); ctx.font = '800 10px Poppins, sans-serif'; ctx.fillText(title, cx, cy+17); ctx.textAlign='left';
  const x = options.wide ? w*.62 : w*.62;
  const tooltipPoints = [];
  rows.slice(0,8).forEach((r,i) => {
    const y = 32 + i*22;
    ctx.fillStyle = r.color || ANALYSIS_PALETTE[i%ANALYSIS_PALETTE.length]; ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.font='800 11px Poppins, sans-serif';
    const pct = Math.round((r.value/total)*1000)/10;
    ctx.fillText(`${r.label}: ${pct}%`, x+12, y+4);
    tooltipPoints.push({ x, y, radius: 24, label: r.label, value: r.value, pct, sourceKey: r.key || r.label, items: chartPointItems({ sourceKey: r.key || r.label }) });
  });
  tooltipPoints.push({ x: cx, y: cy, radius: radius + 20, label: title || 'Total', value: total, pct: 100 });
  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${number(p.value)} data · ${p.pct}%</span>`);
}

function drawSentimentBreakdown(selector, analysis) {
  const rows = [
    { label:'Positive', value: analysis.counts?.positif || 0, color:'#22c55e' },
    { label:'Neutral', value: analysis.counts?.netral || 0, color:'#cbd5e1' },
    { label:'Negative', value: analysis.counts?.negatif || 0, color:'#ef4444' }
  ];
  drawColumnShare(selector, rows, 'Persentase penyebutan');
}

function drawCategoryShare(selector, rows = []) {
  drawColumnShare(selector, rows.slice(0,8), 'Kategori sumber');
}

function drawColumnShare(selector, rows = [], label = '') {
  const canvas = $(selector); if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas); ctx.clearRect(0,0,w,h);
  if (!rows.length || !rows.some(r => r.value > 0)) return drawEmptyAnalysis(selector);
  const total = rows.reduce((s,r)=>s+Number(r.value||0),0) || 1;
  const padL=42,padR=24,padT=28,padB=56; const chartW=w-padL-padR, chartH=h-padT-padB;
  ctx.strokeStyle=css('--line'); ctx.lineWidth=1; for(let i=0;i<=4;i++){const y=padT+chartH*i/4;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(w-padR,y);ctx.stroke();}
  const barW=Math.max(18, chartW/Math.max(rows.length,1)*.52);
  const tooltipPoints = [];
  rows.forEach((r,i)=>{const x=padL+(chartW/rows.length)*i+(chartW/rows.length-barW)/2;const val=Number(r.value||0);const pct=Math.round((val/total)*100);const bh=(val/total)*chartH;ctx.fillStyle=r.color||ANALYSIS_PALETTE[i%ANALYSIS_PALETTE.length];roundRect(ctx,x,padT+chartH-bh,barW,bh,8);ctx.fill();tooltipPoints.push({x:x+barW/2,y:padT+chartH-bh/2,radius:30,label:r.label,value:val,pct,sourceKey:r.key || r.label,items:chartPointItems({sourceKey:r.key || r.label})});ctx.fillStyle=css('--text');ctx.font='800 10px Poppins, sans-serif';ctx.textAlign='center';ctx.fillText(`${pct}%`,x+barW/2,padT+chartH-bh-5);ctx.fillStyle=css('--muted');ctx.save();ctx.translate(x+barW/2,h-22);ctx.rotate(-0.48);ctx.fillText(String(r.label).slice(0,12),0,0);ctx.restore();});
  ctx.textAlign='left'; ctx.fillStyle=css('--muted'); ctx.font='700 11px Poppins, sans-serif'; ctx.fillText(label, padL, 16);
  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${number(p.value)} data · ${p.pct}%</span>`);
}

function renderAnalysisLists(analysis, sourceRows) {
  const activeSites = $('#analysisActiveSites');
  if (activeSites) activeSites.innerHTML = (analysis.topDomains || analysis.topSources || []).slice(0,3).map((x,i)=>`<div class="bubble-site"><span style="--s:${Math.max(28, Math.min(76, 24 + Math.sqrt(x.count||1)*7))}px"></span><strong>${number(x.count||0)}</strong><em>${escapeHtml(x.term||x.source||'-')}</em></div>`).join('') || '<p class="muted">Belum ada data.</p>';
  const cats = $('#analysisActiveCategories');
  if (cats) {
    const max = Math.max(1, ...sourceRows.map(x=>x.value));
    cats.innerHTML = sourceRows.slice(0,5).map(x=>`<div class="cat-bar-row"><b>${escapeHtml(x.label)}</b><span><i style="width:${Math.max(3,(x.value/max)*100)}%;background:${x.color}"></i></span><strong>${number(x.value)}</strong></div>`).join('') || '<p class="muted">Belum ada data.</p>';
  }
  const peopleHtml = (analysis.topAuthors || []).slice(0,6).map((x,i)=>`<div class="person-mini"><span>${String(x.term||'?').slice(0,1).toUpperCase()}</span><strong>${escapeHtml(String(x.term||'-').slice(0,16))}</strong><em>${compact(x.count||0)}</em></div>`).join('') || '<p class="muted">Belum ada data.</p>';
  if ($('#analysisInfluential')) $('#analysisInfluential').innerHTML = peopleHtml;
  if ($('#analysisActivePeople')) $('#analysisActivePeople').innerHTML = peopleHtml;
}

function compact(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000_000) return `${(n/1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n/1_000).toFixed(1)}K`;
  return String(Math.round(n));
}


function chipHtml(items = []) {
  return items.length ? items.slice(0, 18).map(k => `<span class="chip">${escapeHtml(k.term)} · ${k.count}</span>`).join('') : 'Belum ada data.';
}

function rankHtml(items = []) {
  return items.length ? items.slice(0, 10).map((item, idx) => `<div class="rank-item"><strong>${idx + 1}. ${escapeHtml(item.term)}</strong><span>${item.count}</span></div>`).join('') : '<p class="muted">Belum ada data.</p>';
}

function renderInsightCards(analysis) {
  const cards = [
    ['Top topic', analysis.keywords?.[0] ? `${analysis.keywords[0].term} · ${analysis.keywords[0].count}` : '-'],
    ['Top source', analysis.topSources?.[0] ? `${analysis.topSources[0].term} · ${analysis.topSources[0].count}` : '-'],
    ['Sentiment shift', `${analysis.dominantSentiment || 'netral'} · ${analysis.avgCompound || 0}`],
    ['Editor action', analysis.alertLevel === 'tinggi' ? 'Prioritas verifikasi' : 'Pantau & follow-up']
  ];
  $('#insightCards').innerHTML = cards.map(([k, v], idx) => `<div class="insight-card color-${idx + 1}"><strong>${escapeHtml(k)}</strong><span>${escapeHtml(v)}</span></div>`).join('');
}

function drawClusterMap(selector, analysis) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const items = analysis?.items || lastItems || [];
  const groups = (analysis?.keywords || []).slice(0, 7);
  if (!items.length || !groups.length) {
    ctx.fillStyle = css('--muted');
    ctx.font = '700 17px Poppins, sans-serif';
    ctx.fillText('Jalankan scan untuk membuat cluster percakapan', 28, h / 2);
    return;
  }
  const palette = ['#2563eb','#db2777','#16a34a','#f97316','#7c3aed','#0891b2','#f59e0b'];
  const zoom = Math.max(0.62, Math.min(2.8, Number(clusterView.zoom || 1)));
  const spread = (clusterView.focus ? .22 : .29) * zoom;
  const centers = groups.map((g, idx) => {
    const angle = (Math.PI * 2 * idx / groups.length) - .8;
    return {
      x: w * .5 + Math.cos(angle) * w * spread,
      y: h * .52 + Math.sin(angle) * h * spread * .96,
      term: g.term, count: g.count, color: palette[idx % palette.length], idx
    };
  });
  ctx.lineWidth = 1;
  centers.forEach((c, idx) => {
    ctx.strokeStyle = hexToRgba(c.color, .14);
    for (let n = 0; n < Math.min(36, Math.max(12, c.count * 3)); n++) {
      const seed = Math.sin((idx + 1) * (n + 7) * 12.989) * 43758.5453;
      const r = Math.abs(seed % 1);
      const seed2 = Math.sin((idx + 3) * (n + 11) * 78.233) * 19341.3;
      const a = (seed2 % 1) * Math.PI * 2;
      const dist = (22 + r * 92) * (clusterView.focus ? .72 : 1) * Math.sqrt(zoom);
      const x = c.x + Math.cos(a) * dist;
      const y = c.y + Math.sin(a) * dist * .72;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = hexToRgba(c.color, .72);
      ctx.beginPath(); ctx.arc(x, y, 2.5 + r * 3.5, 0, Math.PI * 2); ctx.fill();
    }
  });
  const tooltipPoints = [];
  centers.forEach((c, idx) => {
    const radius = (15 + Math.min(26, Math.sqrt(c.count) * 8)) * Math.max(.82, Math.min(1.42, Math.sqrt(zoom)));
    const grd = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, radius * 1.8);
    grd.addColorStop(0, c.color);
    grd.addColorStop(1, hexToRgba(c.color, .1));
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(c.x, c.y, radius, 0, Math.PI * 2); ctx.fill();
    const label = `${c.term} ${Math.round((c.count / Math.max(analysis.total, 1)) * 100)}%`;
    ctx.font = '800 13px Poppins, sans-serif';
    const tw = ctx.measureText(label).width + 22;
    const lx = Math.max(10, Math.min(w - tw - 10, c.x - tw / 2));
    const ly = Math.max(12, Math.min(h - 30, c.y - radius - 20));
    ctx.fillStyle = colorMixSurface(.9);
    roundRect(ctx, lx, ly, tw, 28, 14); ctx.fill();
    ctx.strokeStyle = hexToRgba(c.color, .55); ctx.stroke();
    ctx.fillStyle = css('--text');
    ctx.fillText(label, lx + 11, ly + 18);
    tooltipPoints.push({ x: c.x, y: c.y, radius: radius + 26, label: c.term, value: c.count, pct: Math.round((c.count / Math.max(analysis.total || 1, 1)) * 1000) / 10, keyword: c.term, items: chartPointItems({ keyword: c.term }) });
  });
  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${number(p.value)} mention · ${p.pct}% dari cluster</span>`);
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255; const g = (bigint >> 8) & 255; const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function colorMixSurface(alpha = .9) {
  return document.documentElement.dataset.theme === 'dark' ? `rgba(15,27,45,${alpha})` : `rgba(255,255,255,${alpha})`;
}


function drawSentimentChart(selector, counts) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const labels = ['positif', 'netral', 'negatif'];
  const values = labels.map(l => Number(counts[l] || 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const colors = chartColors();
  const cx = w / 2;
  const cy = Math.min(h * 0.5, 106);
  const radius = Math.min(Math.max(56, w * 0.18), Math.min(h * 0.33, 74));
  let ang = -Math.PI / 2;
  const tooltipPoints = [];
  labels.forEach((label, i) => {
    const slice = (values[i] / total) * Math.PI * 2;
    const endAng = ang + slice;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, ang, endAng); ctx.closePath();
    ctx.fillStyle = colors[label]; ctx.fill();
    const mid = ang + slice / 2;
    tooltipPoints.push({ x: cx + Math.cos(mid) * radius * 0.72, y: cy + Math.sin(mid) * radius * 0.72, radius: 20, label: sentimentUiLabel(label), value: values[i], pct: ((values[i] / total) * 100).toFixed(1), sentiment: label, items: chartPointItems({ sentiment: label }) });
    ang = endAng;
  });
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, radius * .6, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css('--surface'); ctx.beginPath(); ctx.arc(cx, cy, radius * .56, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.textAlign = 'center'; ctx.font = '900 17px Poppins, sans-serif'; ctx.fillText(number(total), cx, cy - 2);
  ctx.fillStyle = css('--muted'); ctx.font = '800 11px Poppins, sans-serif'; ctx.fillText(t('labels.mentions', 'mentions'), cx, cy + 15);
  ctx.textAlign = 'left';
  tooltipPoints.push({ x: cx, y: cy, radius: radius + 18, label: t('labels.total', 'Total'), value: total, pct: 100, items: chartPointItems({}) });
  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${number(p.value)} ${t('labels.data', 'data')} · ${p.pct}%</span>`);
}

function renderSentimentLegend(counts = {}) {
  const wrap = $('#sentimentLegend');
  if (!wrap) return;
  const labels = ['positif', 'netral', 'negatif'];
  const total = labels.reduce((sum, key) => sum + Number(counts[key] || 0), 0) || 1;
  const colors = chartColors();
  wrap.innerHTML = labels.map((key) => {
    const value = Number(counts[key] || 0);
    const pct = ((value / total) * 100).toFixed(1);
    return `<button type="button" class="chart-legend-row" data-chart-filter="sentiment" data-chart-value="${key}"><span class="legend-dot" style="background:${colors[key]}"></span><span><div class="legend-title">${escapeHtml(sentimentUiLabel(key))}</div><div class="legend-sub">${number(value)} ${escapeHtml(t('labels.data', 'data'))}</div></span><span class="legend-value">${pct}%</span></button>`;
  }).join('');
  wrap.querySelectorAll('[data-chart-filter="sentiment"]').forEach(btn => {
    btn.addEventListener('click', () => openChartDetail({ title: `${sentimentUiLabel(btn.dataset.chartValue)} · ${btn.querySelector('.legend-value')?.textContent || ''}`, items: chartPointItems({ sentiment: btn.dataset.chartValue }) }));
  });
}

function drawTimelineChart(selector, rows) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!rows?.length) {
    ctx.fillStyle = css('--muted'); ctx.font = '700 14px Poppins, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(UI_LANGUAGE === 'id' ? 'Belum ada data timeline' : 'No timeline data yet', w / 2, h / 2); ctx.textAlign = 'left';
    return;
  }
  const values = rows.map(r => Number(r.total || r.count || 0));
  const max = Math.max(...values, 1);
  const min = 0;
  const padL = 34, padR = 16, padT = 18, padB = 28;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(80, h - padT - padB);
  const step = plotW / Math.max(rows.length - 1, 1);
  const yFor = (v) => padT + (plotH - ((v - min) / Math.max(max - min, 1)) * plotH);
  const points = values.map((v, i) => ({ x: padL + i * step, y: yFor(v), v, row: rows[i] }));
  ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.font = '700 10px Poppins, sans-serif';
  for (let i = 0; i < 4; i++) {
    const y = padT + i * (plotH / 3);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(String(Math.round(max - i * (max / 3))), 4, y + 3);
  }
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, 'rgba(37,99,235,.22)'); grad.addColorStop(1, 'rgba(37,99,235,0)');
  ctx.beginPath(); points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.lineTo(points[points.length - 1].x, h - padB); ctx.lineTo(points[0].x, h - padB); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.strokeStyle = css('--chart-line') || css('--primary'); ctx.lineWidth = 3; ctx.stroke();
  const tooltipPoints = [];
  ctx.fillStyle = css('--chart-dot') || css('--primary');
  points.forEach((p, i) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); tooltipPoints.push({ x: p.x, y: p.y, radius: 18, label: p.row?.label || p.row?.time || `Data ${i + 1}`, value: p.v, timeKey: p.row?.time || '', items: chartPointItems({ timeKey: p.row?.time || '' }) }); });
  const first = rows[0], mid = rows[Math.floor(rows.length / 2)], last = rows[rows.length - 1];
  ctx.fillStyle = css('--muted'); ctx.font = '700 10px Poppins, sans-serif';
  ctx.fillText(shortTick(first?.label || first?.time || ''), padL, h - 10);
  ctx.textAlign = 'center'; ctx.fillText(shortTick(mid?.label || mid?.time || ''), w / 2, h - 10);
  ctx.textAlign = 'right'; ctx.fillText(shortTick(last?.label || last?.time || ''), w - padR, h - 10); ctx.textAlign = 'left';
  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${number(p.value)} ${t('labels.mentions', 'mentions')}</span>`);
}

function renderTimelineSummary(rows = []) {
  const wrap = $('#timelineSummary');
  if (!wrap) return;
  if (!rows.length) { wrap.innerHTML = ''; return; }
  const values = rows.map(r => Number(r.total || r.count || 0));
  const peak = Math.max(...values, 0); const peakIndex = values.indexOf(peak); const total = values.reduce((a, b) => a + b, 0); const avg = Math.round(total / Math.max(values.length, 1));
  const first = rows[0], last = rows[rows.length - 1];
  wrap.innerHTML = `
    <button type="button" class="chart-summary-item" data-chart-time="${escapeAttr(rows[peakIndex]?.time || '')}"><b>${UI_LANGUAGE === 'id' ? 'Puncak' : 'Peak'}</b><span>${escapeHtml(shortTick(rows[peakIndex]?.label || rows[peakIndex]?.time || ''))} · ${number(peak)} ${escapeHtml(t('labels.mentions', 'mentions'))}</span></button>
    <div class="chart-summary-item"><b>${UI_LANGUAGE === 'id' ? 'Rata-rata' : 'Average'}</b><span>${number(avg)} ${escapeHtml(t('labels.mentions', 'mentions'))}</span></div>
    <div class="chart-summary-item"><b>${UI_LANGUAGE === 'id' ? 'Periode' : 'Range'}</b><span>${escapeHtml(shortTick(first?.label || first?.time || ''))} — ${escapeHtml(shortTick(last?.label || last?.time || ''))}</span></div>`;
  const btn = wrap.querySelector('[data-chart-time]');
  if (btn) btn.addEventListener('click', () => openChartDetail({ title: btn.querySelector('b')?.textContent || 'Peak', items: chartPointItems({ timeKey: btn.dataset.chartTime }) }));
}

function shortTick(value = '') {
  const v = String(value || '').trim(); if (!v) return '-';
  const d = new Date(v); if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(UI_LOCALE, { day: '2-digit', month: 'short' });
  return v.length > 12 ? `${v.slice(0, 12)}…` : v;
}

function sentimentUiLabel(label = '') {
  const key = normalizeSentimentLabel(label);
  if (key === 'positif') return t('labels.positive', 'Positif');
  if (key === 'negatif') return t('labels.negative', 'Negatif');
  return t('labels.neutral', 'Netral');
}

function drawShareOfVoiceChart(selector, sources = [], totalItems = 0) {
  const canvas = $(selector);
  if (!canvas) return;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const rows = (sources || []).slice(0, 6).map((src, idx) => ({
    label: normalizeSourceLabel(src.term || src.source || src.platform || '-'),
    key: String(src.term || src.source || src.platform || '-').toLowerCase(),
    value: Number(src.count || 0),
    color: ANALYSIS_PALETTE[idx % ANALYSIS_PALETTE.length]
  })).filter(x => x.value > 0);

  if (!rows.length) {
    ctx.fillStyle = css('--muted');
    ctx.font = '800 13px Poppins, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(UI_LANGUAGE === 'id' ? 'Belum ada data sumber.' : 'No source data yet.', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }

  const total = totalItems || rows.reduce((sum, r) => sum + r.value, 0) || 1;
  const compact = w < 520;
  const cx = compact ? w * 0.5 : Math.min(150, w * 0.25);
  const cy = compact ? 84 : Math.min(122, h * 0.4);
  const radius = compact ? Math.min(70, w * 0.2) : Math.min(90, h * 0.27);
  let start = -Math.PI / 2;
  const tooltipPoints = [];

  rows.forEach(row => {
    const slice = (row.value / total) * Math.PI * 2;
    const end = start + slice;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = row.color;
    ctx.fill();
    const mid = start + slice / 2;
    tooltipPoints.push({
      x: cx + Math.cos(mid) * radius * 0.7,
      y: cy + Math.sin(mid) * radius * 0.7,
      radius: 24,
      label: row.label,
      value: row.value,
      pct: ((row.value / total) * 100).toFixed(1),
      sourceKey: row.key,
      items: chartPointItems({ sourceKey: row.key })
    });
    start = end;
  });

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, radius * .58, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css('--surface');
  ctx.beginPath(); ctx.arc(cx, cy, radius * .54, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = css('--text');
  ctx.textAlign = 'center';
  ctx.font = `900 ${compact ? 20 : 25}px Poppins, sans-serif`;
  ctx.fillText(number(total), cx, cy - 2);
  ctx.fillStyle = css('--muted');
  ctx.font = `800 ${compact ? 10.5 : 12}px Poppins, sans-serif`;
  ctx.fillText(t('labels.mentions', 'mentions'), cx, cy + 18);
  ctx.textAlign = 'left';

  const legendX = compact ? 18 : Math.max(cx + radius + 34, 270);
  const legendY = compact ? cy + radius + 18 : 30;
  const rowH = compact ? 37 : 42;
  const maxBarW = compact ? Math.max(80, w - 36) : Math.max(160, w - legendX - 26);

  rows.forEach((row, idx) => {
    const y = legendY + idx * rowH;
    const pct = ((row.value / total) * 100).toFixed(1);
    ctx.fillStyle = row.color; roundRect(ctx, legendX, y, 12, 12, 5); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.font = `900 ${compact ? 12 : 13}px Poppins, sans-serif`;
    ctx.fillText(row.label, legendX + 18, y + 11, Math.max(70, w - legendX - 24));
    ctx.fillStyle = css('--muted'); ctx.font = `800 ${compact ? 10.5 : 11.5}px Poppins, sans-serif`;
    ctx.fillText(`${pct}% · ${number(row.value)} ${t('labels.data','data')}`, legendX + 18, y + 27, Math.max(70, w - legendX - 24));
    const barY = y + 32;
    const barX = compact ? legendX : legendX + 18;
    const barW = Math.min(maxBarW, compact ? maxBarW : 260);
    ctx.fillStyle = css('--surface-2'); roundRect(ctx, barX, barY, barW, 7, 5); ctx.fill();
    ctx.fillStyle = row.color; roundRect(ctx, barX, barY, Math.max(4, barW * (row.value / total)), 7, 5); ctx.fill();
    tooltipPoints.push({ x: legendX + 6, y: y + 6, radius: 20, label: row.label, value: row.value, pct, sourceKey: row.key, items: chartPointItems({ sourceKey: row.key }) });
  });

  registerCanvasTooltip(canvas, tooltipPoints, p => `<strong>${escapeHtml(p.label)}</strong><span>${number(p.value)} ${t('labels.data','data')} · ${p.pct}% share</span>`);
}

function safeDrawCharts(analysis) {
  try {
    drawSentimentChart('#sentimentChart', analysis?.counts || { positif: 0, netral: 0, negatif: 0 });
    renderSentimentLegend(analysis?.counts || { positif: 0, netral: 0, negatif: 0 });
    drawTimelineChart('#timelineChart', analysis?.byHour || []);
    renderTimelineSummary(analysis?.byHour || []);
    drawShareOfVoiceChart('#sovChart', analysis?.topSources || [], analysis?.total || 0);
  } catch (err) {
    console.error('Chart render error:', err);
    logRt?.(`Chart render warning: ${err.message}`);
  }
}

function resetCharts() {
  safeDrawCharts(null);
  drawClusterMap('#clusterChart', null);
  renderWordCloudPanels(null);
  renderDataWordCloud([]);
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width || Number(canvas.getAttribute('width')) || canvas.width || 360));
  const cssH = Math.max(1, Math.round(rect.height || Number(canvas.getAttribute('height')) || canvas.height || 220));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.75);
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  canvas.style.width = '100%';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { ctx, w: cssW, h: cssH, dpr };
}

function chartColors() {
  return { positif: css('--chart-pos') || css('--good'), netral: css('--chart-neutral') || css('--muted'), negatif: css('--chart-neg') || css('--bad') };
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function toCsv(items) {
  const cols = ['id', 'source', 'platform', 'author', 'createdAt', 'sentiment', 'viralScore', 'likes', 'comments', 'shares', 'views', 'url', 'title', 'text'];
  const rows = items.map(item => ({
    id: item.id,
    source: item.source,
    platform: item.platform,
    author: item.author,
    createdAt: item.createdAt,
    sentiment: item.sentiment?.label,
    viralScore: item.viralScore,
    likes: item.metrics?.likes || 0,
    comments: item.metrics?.comments || 0,
    shares: item.metrics?.shares || 0,
    views: item.metrics?.views || 0,
    url: item.url,
    title: item.title,
    text: item.text
  }));
  return [cols.join(','), ...rows.map(row => cols.map(c => csvCell(row[c])).join(','))].join('\n');
}

function csvCell(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(text = '') {
  return String(text || 'report').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'report';
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function capitalize(text = '') { return String(text).charAt(0).toUpperCase() + String(text).slice(1); }
function number(n) { return new Intl.NumberFormat('id-ID').format(Number(n || 0)); }
function dateShort(input, detailed = false) {
  if (!input) return '-';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '-';
  return detailed
    ? d.toLocaleString(UI_LOCALE, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(UI_LOCALE, { day: '2-digit', month: 'short' });
}function escapeAttr(str = '') { return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }




function bootNewsroomApp() {
  if (window.__newsroomBooted) return;
  window.__newsroomBooted = true;
  init();
  installEmergencyActionBridge();
}

function installEmergencyActionBridge() {
  window.NewsroomApp = {
    startMonitoringFromUi(event) { event?.preventDefault?.(); const payload = buildSearchPayloadFromForm(); if (payload) startStableMonitoring(payload); },
    stopMonitoring(event) { event?.preventDefault?.(); stopSocket(true); },
    resetData(event) { event?.preventDefault?.(); resetAllData(true); },
    testAiTools(event) { event?.preventDefault?.(); runAiToolsTest(); },
    saveKeys(event) { event?.preventDefault?.(); saveKeys(); toast('Settings aktif dan tersimpan.'); }
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootNewsroomApp, { once: true });
else bootNewsroomApp();
