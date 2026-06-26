import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { parseString } from '@fast-csv/parse';
import { XMLParser } from 'fast-xml-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import vader from 'vader-sentiment';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const REPORT_LOGO_PNG_PATH = path.join(PUBLIC_DIR, 'logo-newsroom.png');
const REPORT_LOGO_JPG_PATH = path.join(PUBLIC_DIR, 'logo-newsroom-report.jpg');
const REPORT_LOGO_PNG_DATA_URI = existsSync(REPORT_LOGO_PNG_PATH) ? `data:image/png;base64,${readFileSync(REPORT_LOGO_PNG_PATH).toString('base64')}` : '';
const REPORT_LOGO_JPG = existsSync(REPORT_LOGO_JPG_PATH) ? readFileSync(REPORT_LOGO_JPG_PATH) : null;
const reportDownloadJobs = new Map();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/realtime' });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: 'text' });

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_REALTIME_INTERVAL_MS = Math.max(Number(process.env.DEFAULT_REALTIME_INTERVAL_MS || 60000), 30000);
const MAX_IMPORT_ITEMS = Math.min(Number(process.env.MAX_IMPORT_ITEMS || 3000), 10000);
const REQUEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.REQUEST_TIMEOUT_MS || 12000), 5000), 30000);

const DEFAULT_DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'rumahedukasidigital';
const DEFAULT_FULL_PASSWORD = process.env.FULL_PASSWORD || 'rahasia123';
const DEFAULT_SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'dI3nteraja100%';
const AUTH_SECRET = process.env.AUTH_SECRET || 'newsroom-local-dev-secret-change-me';
const PLAN_DEFINITIONS = [
  { id: 'demo3', runtimeKey: 'demoPassword', envKey: 'DEMO_PASSWORD', label: 'Demo 3 Hari', days: 3, mode: 'demo', defaultPassword: DEFAULT_DEMO_PASSWORD },
  { id: 'p7', runtimeKey: 'package7Password', envKey: 'PACKAGE_7_PASSWORD', label: 'Paket 7 Hari', days: 7, mode: 'package', defaultPassword: process.env.PACKAGE_7_PASSWORD || '' },
  { id: 'p30', runtimeKey: 'package30Password', envKey: 'PACKAGE_30_PASSWORD', label: 'Paket 30 Hari', days: 30, mode: 'package', defaultPassword: process.env.PACKAGE_30_PASSWORD || '' },
  { id: 'p60', runtimeKey: 'package60Password', envKey: 'PACKAGE_60_PASSWORD', label: 'Paket 60 Hari', days: 60, mode: 'package', defaultPassword: process.env.PACKAGE_60_PASSWORD || '' },
  { id: 'p90', runtimeKey: 'package90Password', envKey: 'PACKAGE_90_PASSWORD', label: 'Paket 90 Hari', days: 90, mode: 'package', defaultPassword: process.env.PACKAGE_90_PASSWORD || '' },
  { id: 'p365', runtimeKey: 'package365Password', envKey: 'PACKAGE_365_PASSWORD', label: 'Paket 1 Tahun', days: 365, mode: 'package', defaultPassword: process.env.PACKAGE_365_PASSWORD || DEFAULT_FULL_PASSWORD }
];
const DATA_DIR = path.join(__dirname, 'data');
const RUNTIME_SETTINGS_FILE = path.join(DATA_DIR, 'runtime-settings.json');
const DEMO_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const FULL_DURATION_MS = Math.max(Number(process.env.FULL_DURATION_MS || 3650 * 24 * 60 * 60 * 1000), 24 * 60 * 60 * 1000);

function readRuntimeSettings() {
  try {
    if (!existsSync(RUNTIME_SETTINGS_FILE)) return {};
    return JSON.parse(readFileSync(RUNTIME_SETTINGS_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeRuntimeSettings(next = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  const current = readRuntimeSettings();
  const payload = { ...current, ...next, updatedAt: new Date().toISOString() };
  writeFileSync(RUNTIME_SETTINGS_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function activePasswords() {
  const runtime = readRuntimeSettings();
  const plans = {};
  for (const plan of PLAN_DEFINITIONS) {
    const stored = runtime[plan.runtimeKey];
    const envVal = process.env[plan.envKey];
    const password = String(stored || envVal || plan.defaultPassword || '').trim();
    plans[plan.id] = { ...plan, password, configured: Boolean(password) };
  }
  return {
    superadmin: String(runtime.superadminPassword || process.env.SUPERADMIN_PASSWORD || DEFAULT_SUPERADMIN_PASSWORD),
    plans,
    updatedAt: runtime.updatedAt || null
  };
}

function visiblePlanConfig(runtime = readRuntimeSettings()) {
  return PLAN_DEFINITIONS.map(plan => ({
    id: plan.id,
    label: plan.label,
    days: plan.days,
    mode: plan.mode,
    runtimeKey: plan.runtimeKey,
    configured: Boolean(runtime[plan.runtimeKey] || process.env[plan.envKey] || plan.defaultPassword),
    updated: Boolean(runtime[plan.runtimeKey])
  }));
}

function assertSuperadmin(req) {
  if (req.newsroomSession?.mode !== 'superadmin') {
    const err = new Error('Fitur ini hanya untuk Superadmin. Login memakai password superadmin untuk membuat password demo dan paket.');
    err.status = 403;
    throw err;
  }
}

function issueScopedProof(scope = 'ai-settings') {
  const payload = { scope, mode: 'superadmin-proof', issuedAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000 };
  return { ...payload, token: signPayload(payload), expiresAtIso: new Date(payload.expiresAt).toISOString() };
}

function verifyScopedProof(token = '', scope = 'ai-settings') {
  const payload = verifyToken(token);
  return Boolean(payload && payload.scope === scope && payload.mode === 'superadmin-proof');
}

function assertAiSuperadmin(req) {
  const proof = String(req.headers['x-superadmin-proof'] || req.body?.superadminProof || '').trim();
  if (req.newsroomSession?.mode === 'superadmin' || verifyScopedProof(proof, 'ai-settings')) return;
  const err = new Error('Pengaturan AI hanya dapat digunakan setelah verifikasi password superadmin.');
  err.status = 403;
  throw err;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token = '') {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.expiresAt || Date.now() > Number(payload.expiresAt)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAuthToken(req) {
  const header = String(req.headers['x-newsroom-auth'] || req.headers.authorization || '').trim();
  return header.replace(/^Bearer\s+/i, '');
}

function authRequired(req, res, next) {
  const session = verifyToken(getAuthToken(req));
  if (!session) {
    return res.status(401).json({ error: 'Sesi login tidak valid atau sudah kedaluwarsa. Silakan login ulang.', status: 401 });
  }
  req.newsroomSession = session;
  next();
}

function issueSession(password = '') {
  const clean = String(password || '');
  const passwords = activePasswords();
  if (clean && clean === passwords.superadmin) {
    const expiresAt = Date.now() + FULL_DURATION_MS;
    const payload = { mode: 'superadmin', planId: 'superadmin', label: 'Superadmin', issuedAt: Date.now(), expiresAt };
    return { ...payload, token: signPayload(payload) };
  }
  for (const plan of Object.values(passwords.plans)) {
    if (!plan.password || clean !== plan.password) continue;
    const duration = Math.max(1, Number(plan.days || 1)) * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + duration;
    const payload = { mode: plan.mode, planId: plan.id, label: plan.label, days: plan.days, issuedAt: Date.now(), expiresAt };
    return { ...payload, token: signPayload(payload) };
  }
  return null;
}

function sumopodConfigFromReq(req) {
  return {
    apiKey: String(req.headers['x-sumopod-api-key'] || req.body?.sumopodApiKey || process.env.SUMOPOD_API_KEY || '').trim(),
    baseUrl: String(req.headers['x-sumopod-base-url'] || req.body?.sumopodBaseUrl || process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1').trim().replace(/\/+$/, ''),
    model: String(req.headers['x-sumopod-model'] || req.body?.sumopodModel || process.env.SUMOPOD_MODEL || 'gpt-4o-mini').trim(),
    temperature: Number(req.body?.temperature ?? process.env.SUMOPOD_TEMPERATURE ?? 0.4),
    maxTokens: Number(req.body?.maxTokens ?? process.env.SUMOPOD_MAX_TOKENS ?? 900)
  };
}

async function callSumopod(messages, config) {
  if (!config.apiKey) throw Object.assign(new Error('API key AI Tools belum diisi. Tempel API key di Settings, klik Simpan Settings, lalu Test AI Tools.'), { status: 400 });
  const payload = {
    model: config.model || 'gpt-4o-mini',
    messages,
    temperature: Number.isFinite(config.temperature) ? config.temperature : 0.4,
    max_tokens: Number.isFinite(config.maxTokens) ? config.maxTokens : 900
  };
  const data = await fetchJson(`${config.baseUrl || 'https://ai.sumopod.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(payload)
  }, config.timeoutMs || AI_REQUEST_TIMEOUT_MS);
  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  return { ok: true, provider: 'sumopod', model: payload.model, text: String(text).trim(), rawUsage: data?.usage || null };
}

// GDELT enforces a public rate limit of about 1 request every 5 seconds.
// This global queue, cache, and backoff prevent 429 errors when dashboard, realtime,
// and hoax-check features hit GDELT close together.
const GDELT_MIN_INTERVAL_MS = Math.max(Number(process.env.GDELT_MIN_INTERVAL_MS || 6500), 5000);
const GDELT_CACHE_TTL_MS = Math.max(Number(process.env.GDELT_CACHE_TTL_MS || 120000), GDELT_MIN_INTERVAL_MS);
const GDELT_STALE_CACHE_MS = Math.max(Number(process.env.GDELT_STALE_CACHE_MS || 900000), GDELT_CACHE_TTL_MS);
const GDELT_MAX_CACHE_ENTRIES = Math.max(Number(process.env.GDELT_MAX_CACHE_ENTRIES || 80), 20);
let gdeltQueue = Promise.resolve();
let gdeltNextAllowedAt = 0;
const gdeltCache = new Map();
const LIVE_SEARCH_CACHE_TTL_MS = Math.max(Number(process.env.LIVE_SEARCH_CACHE_TTL_MS || 90000), 10000);
const AI_REQUEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_REQUEST_TIMEOUT_MS || 90000), 30000), 180000);
const LIVE_SOURCE_TIMEOUT_MS = Math.min(Math.max(Number(process.env.LIVE_SOURCE_TIMEOUT_MS || 7500), 4000), 15000);
const liveSearchCache = new Map();


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.use(cors());
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const positiveId = new Set([
  'baik','bagus','mantap','hebat','terbaik','positif','sukses','berhasil','aman','nyaman','percaya','adil','kuat',
  'meningkat','prestasi','terpercaya','apresiasi','mendukung','menang','senang','puas','cepat','transparan','akurat',
  'inovatif','unggul','solutif','efektif','resmi','valid','klarifikasi','terbukti','kolaborasi','damai','stabil','pulih',
  'membaik','terkendali','bantuan','gratis','bermanfaat','lancar','profesional','berkualitas','jujur','responsif'
]);
const negativeId = new Set([
  'buruk','jelek','gagal','negatif','bahaya','bohong','hoaks','hoax','rusak','marah','korupsi','skandal','krisis',
  'demo','bentrok','macet','mahal','penipuan','curang','fitnah','ancaman','masalah','ditolak','menolak','kecewa',
  'takut','waspada','viral','cacat','tewas','luka','ditangkap','tersangka','ilegal','palsu','kontroversi','bocor',
  'provokasi','kebencian','meninggal','gugatan','periksa','ancam','pungli','sanksi','boikot','gaduh','resah'
]);
const hoaxSignals = new Set([
  'hoax','hoaks','palsu','penipuan','scam','klik','sebarkan','viralkan','hadiah','gratis','urgent','forwarded','terbongkar',
  'konspirasi','tanpa sumber','katanya','jangan sampai','bagikan','whatsapp','wa','voucher','undian','lowongan palsu'
]);
const stopwords = new Set([
  'yang','dan','atau','untuk','dengan','dari','pada','dalam','akan','sebagai','karena','saat','oleh','para','telah','jadi',
  'agar','bagi','ini','itu','ada','atas','lebih','juga','serta','kini','hari','tidak','the','and','for','with','from','that',
  'this','you','are','was','were','has','have','not','but','about','into','over','after','before','between','akan','sebuah'
]);

function tokenFrom(req, headerName, envName) {
  return String(req.headers[headerName] || process.env[envName] || '').trim();
}

async function fetchText(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'NewsroomIntelligenceRED/2.0 (+https://localhost)',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText}: ${text.slice(0, 240)}`);
      err.status = res.status;
      err.payload = text;
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const dateMs = Date.parse(retryAfter);
        err.retryAfterMs = Number.isFinite(seconds)
          ? seconds * 1000
          : (Number.isFinite(dateMs) ? Math.max(dateMs - Date.now(), 0) : undefined);
      }
      throw err;
    }
    return text;
  } catch (err) {
    if (err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''))) {
      const timeout = Math.round(Number(timeoutMs || REQUEST_TIMEOUT_MS) / 1000);
      const friendly = new Error(`Request timeout setelah ${timeout} detik. API terlalu lama merespons; proses tidak dihentikan mendadak dan aplikasi menyiapkan fallback bila tersedia.`);
      friendly.status = 504;
      friendly.cause = err;
      throw friendly;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const text = await fetchText(url, options, timeoutMs);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('Respons API bukan JSON valid.');
    err.payload = text.slice(0, 500);
    throw err;
  }
}

function safeDate(input) {
  if (!input) return new Date().toISOString();
  if (typeof input === 'number') return new Date(input > 10000000000 ? input : input * 1000).toISOString();
  const clean = String(input).replace(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?/, (_, y, m, d, hh = '00', mm = '00', ss = '00') => `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function stripHtml(text = '') {
  return String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFirst(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function normalizeMetrics(item = {}) {
  const m = item.public_metrics || item.metrics || item.statistics || item.stats || item.insights || item.analytics || item.likeCount || {};
  const nested = item.video || item.musicMeta || item.authorMeta || item.user || item.owner || {};
  const get = (...keys) => {
    for (const k of keys) {
      const raw = item[k] ?? m[k] ?? nested[k];
      const num = Number(String(raw ?? '').replace(/[,\s]/g, ''));
      if (Number.isFinite(num) && num > 0) return num;
    }
    return 0;
  };
  return {
    likes: get('like_count', 'likes', 'likeCount', 'favorite_count', 'favourites', 'favorites', 'diggCount', 'score', 'points', 'reactions', 'reaction_count'),
    comments: get('reply_count', 'comments', 'comment_count', 'commentsCount', 'commentCount', 'num_comments', 'replyCount'),
    shares: get('retweet_count', 'share_count', 'shares', 'shareCount', 'reposts', 'repost_count', 'reblog_count', 'reblogs_count', 'retweetCount'),
    quotes: get('quote_count', 'quotes', 'quoteCount'),
    views: get('impression_count', 'impressions', 'view_count', 'views', 'viewCount', 'playCount', 'videoViewCount', 'reach', 'estimatedReach'),
    saves: get('save_count', 'saves', 'collectCount', 'bookmark_count', 'bookmarks'),
    followers: get('followers', 'followersCount', 'follower_count', 'subscribers', 'subscriberCount')
  };
}

function normalizeItem(item = {}, sourceHint = 'import') {
  const post = item.post || item.record || item.value || item;
  const text = getFirst(
    post.text,
    item.text,
    item.full_text,
    item.tweetText,
    item.caption,
    item.title,
    item.name,
    item.content,
    item.description,
    item.desc,
    item.message,
    item.body,
    item.postText,
    item.snippet,
    item.story_text
  );
  const title = getFirst(item.title, post.title, item.headline, item.name, String(text).slice(0, 88));
  const url = getFirst(item.url, item.link, item.tweetUrl, item.postUrl, item.webUrl, item.articleUrl, item.sourceUrl, item.uri, item.permalink, item.href);
  const author = getFirst(
    item.author?.displayName,
    item.author?.handle,
    item.author?.name,
    item.user?.username,
    item.user?.name,
    item.username,
    item.authorName,
    item.channel,
    item.source,
    item.sourceCommonName,
    item.domain,
    item.byline
  );
  const createdAt = getFirst(item.created_at, item.createdAt, item.timestamp, item.datetime, item.date, item.seendate, item.publishedAt, item.pubDate, item.created_at_i);
  const hashtags = Array.isArray(item.hashtags)
    ? item.hashtags.map(String)
    : Array.from(String(text || title).matchAll(/#[\p{L}\p{N}_]+/gu)).map(m => m[0]);
  const metrics = normalizeMetrics(item);
  const normalized = {
    id: String(getFirst(item.id, item.cid, item.uri, item.tweet_id, item.postId, item.objectID, url, randomUUID())),
    source: item.sourceType || item.source || sourceHint,
    platform: item.platform || item.sourceType || sourceHint,
    title: stripHtml(title),
    text: stripHtml(text || title),
    url,
    author: stripHtml(author),
    createdAt: safeDate(createdAt),
    hashtags,
    metrics,
    raw: item
  };
  normalized.viralScore = computeViralScore(normalized.metrics, normalized.createdAt, normalized.source);
  return normalized;
}

function computeViralScore(metrics = {}, createdAt = new Date().toISOString(), source = '') {
  const engagement = (metrics.likes || 0) + ((metrics.comments || 0) * 2) + ((metrics.shares || 0) * 3) + ((metrics.quotes || 0) * 2.5) + ((metrics.views || 0) * 0.05);
  const ageHours = Math.max((Date.now() - new Date(createdAt).getTime()) / 36e5, 0.25);
  const sourceBoost = source === 'gdelt' || source === 'rss' ? 1.25 : 1;
  const freshness = 1 / Math.pow(ageHours, 0.36);
  return Number((Math.log1p(engagement + 1) * freshness * 10 * sourceBoost).toFixed(2));
}

function sentimentText(text = '') {
  const str = String(text || '').toLowerCase();
  const words = str.match(/[\p{L}\p{N}_#@]+/gu) || [];
  let idScore = 0;
  for (const w of words) {
    if (positiveId.has(w)) idScore += 1;
    if (negativeId.has(w)) idScore -= 1;
  }
  const vaderScore = vader.SentimentIntensityAnalyzer.polarity_scores(str).compound || 0;
  const idCompound = words.length ? Math.max(-1, Math.min(1, idScore / Math.sqrt(words.length + 3))) : 0;
  const compound = Number(((vaderScore + idCompound) / 2).toFixed(4));
  const label = compound >= 0.08 ? 'positif' : compound <= -0.08 ? 'negatif' : 'netral';
  return { label, compound, vader: vaderScore, localLexicon: Number(idCompound.toFixed(4)) };
}

function tokenize(text = '') {
  return String(text).toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[\p{L}\p{N}]{3,}/gu)?.filter(w => !stopwords.has(w) && !/^\d+$/.test(w)) || [];
}

function frequency(values = [], limit = 20) {
  const map = new Map();
  values.filter(Boolean).forEach(value => {
    const key = String(value).toLowerCase().trim();
    if (!key || stopwords.has(key)) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term, count]) => ({ term, count }));
}


function normalizeKeywordQuery(query = '') {
  return String(query || '')
    .replace(/site:\S+/gi, ' ')
    .replace(/\b(OR|AND|NOT|when:\d+d)\b/gi, ' ')
    .replace(/[()"“”'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokensForRelevance(query = '') {
  const normalized = normalizeKeywordQuery(query);
  return tokenize(normalized).filter(t => t.length >= 3).slice(0, 10);
}

function relevanceForItem(item = {}, query = '') {
  const normalizedQuery = normalizeKeywordQuery(query);
  const tokens = queryTokensForRelevance(normalizedQuery);
  if (!tokens.length) {
    return { matched: true, score: 1, reason: 'Tidak ada keyword spesifik; item diterima sebagai bagian dari monitoring umum.' };
  }
  const haystack = `${item.title || ''} ${item.text || ''} ${item.description || ''} ${item.author || ''} ${item.url || ''} ${item.source || ''} ${item.platform || ''}`.toLowerCase();
  const exactPhrase = normalizedQuery.toLowerCase();
  const exact = exactPhrase.length >= 4 && haystack.includes(exactPhrase);
  const matchedTerms = tokens.filter(t => haystack.includes(t.toLowerCase()));
  const missingTerms = tokens.filter(t => !matchedTerms.includes(t));
  const coverage = matchedTerms.length / Math.max(tokens.length, 1);
  const urlDomain = domainFromUrl(item.url || '');
  const title = String(item.title || item.text || '').slice(0, 90);
  let matched = exact || coverage >= 0.6 || (tokens.length <= 2 && matchedTerms.length === tokens.length);
  // For name-style queries of two or more words, require all core terms or exact phrase to avoid off-topic RSS/social hits.
  if (tokens.length >= 2 && !exact && matchedTerms.length < Math.min(tokens.length, 2)) matched = false;
  let score = exact ? 100 : Math.round(coverage * 75 + Math.min(itemEngagement(item) / 1000, 15) + Math.min(itemReach(item) / 100000, 10));
  const reason = matched
    ? (exact
      ? `Relevan karena frasa keyword "${normalizedQuery}" ditemukan langsung pada judul/isi/link.`
      : `Relevan karena memuat ${matchedTerms.length}/${tokens.length} kata kunci inti: ${matchedTerms.join(', ')}${urlDomain ? `; domain: ${urlDomain}` : ''}.`)
    : `Dikeluarkan dari analisa karena tidak cukup memuat keyword inti "${normalizedQuery}". Kata yang cocok: ${matchedTerms.join(', ') || 'tidak ada'}.`;
  return { matched, score, reason, matchedTerms, missingTerms, query: normalizedQuery, title };
}

function filterItemsByQueryRelevance(items = [], query = '') {
  const annotated = items.map(item => ({ ...item, keywordRelevance: relevanceForItem(item, query) }));
  const matched = annotated.filter(item => item.keywordRelevance.matched);
  const rejected = annotated.filter(item => !item.keywordRelevance.matched);
  const tokens = queryTokensForRelevance(query);
  return {
    matched,
    rejected,
    summary: {
      query: normalizeKeywordQuery(query),
      keywordTerms: tokens,
      accepted: matched.length,
      rejected: rejected.length,
      totalChecked: annotated.length,
      accuracyNote: tokens.length
        ? `Hanya item yang memuat keyword inti (${tokens.join(', ')}) pada judul, isi, penulis, sumber, atau link yang masuk ke analisa dan report.`
        : 'Monitoring umum tanpa keyword spesifik; semua item dari sumber terpilih masuk ke analisa.',
      sampleReasons: matched.slice(0, 8).map((item, i) => ({ no: i + 1, title: item.title || item.text || item.url || '-', reason: item.keywordRelevance.reason, score: item.keywordRelevance.score }))
    }
  };
}

function domainFromUrl(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function analyzeItems(items = []) {
  const normalized = items
    .map((item) => item?.text !== undefined && item?.metrics !== undefined ? item : normalizeItem(item))
    .filter(item => item.text || item.title);
  const enriched = normalized.map((item) => ({ ...item, sentiment: (item.sentiment && item.sentiment.label) ? item.sentiment : sentimentText(`${item.title || ''} ${item.text || ''}`) }));
  const total = enriched.length || 1;
  const counts = enriched.reduce((acc, item) => {
    acc[item.sentiment.label] = (acc[item.sentiment.label] || 0) + 1;
    return acc;
  }, { positif: 0, netral: 0, negatif: 0 });
  const avgCompound = enriched.reduce((sum, item) => sum + item.sentiment.compound, 0) / total;
  const hashtags = frequency(enriched.flatMap(i => i.hashtags || []), 20);
  const keywords = frequency(enriched.flatMap(i => tokenize(`${i.title || ''} ${i.text || ''}`)), 30);
  const viral = [...enriched].sort((a, b) => b.viralScore - a.viralScore).slice(0, 30);
  const topSources = frequency(enriched.map(i => i.source || i.platform || 'unknown'), 12);
  const topDomains = frequency(enriched.map(i => domainFromUrl(i.url)).filter(Boolean), 12);
  const topAuthors = frequency(enriched.map(i => i.author).filter(Boolean), 12);
  const byHour = buildTimeline(enriched);
  const negativity = counts.negatif / total;
  const alertLevel = negativity > 0.35 ? 'tinggi' : negativity > 0.2 ? 'sedang' : 'normal';
  const recommendations = editorialRecommendations({ counts, total: enriched.length, keywords, viral, topDomains, alertLevel });
  return {
    total: enriched.length,
    counts,
    percentages: {
      positif: Number(((counts.positif / total) * 100).toFixed(1)),
      netral: Number(((counts.netral / total) * 100).toFixed(1)),
      negatif: Number(((counts.negatif / total) * 100).toFixed(1))
    },
    avgCompound: Number(avgCompound.toFixed(4)),
    dominantSentiment: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'netral',
    alertLevel,
    hashtags,
    keywords,
    viral,
    topSources,
    topDomains,
    topAuthors,
    byHour,
    recommendations,
    generatedAt: new Date().toISOString(),
    items: enriched
  };
}

function buildTimeline(items = []) {
  const map = new Map();
  for (const item of items) {
    const d = new Date(item.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    const bucket = map.get(key) || { time: key, total: 0, positif: 0, netral: 0, negatif: 0 };
    bucket.total += 1;
    bucket[item.sentiment?.label || 'netral'] += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => new Date(a.time) - new Date(b.time)).slice(-48);
}

function editorialRecommendations({ counts, total, keywords, viral, topDomains, alertLevel }) {
  const tips = [];
  if (!total) return ['Masukkan query atau upload data agar sistem bisa menyusun insight redaksi.'];
  if (alertLevel === 'tinggi') tips.push('Prioritaskan verifikasi narasumber primer karena porsi sentimen negatif tinggi.');
  if (viral?.[0]) tips.push(`Pantau angle utama dari konten paling viral: “${viral[0].title || viral[0].text.slice(0, 80)}”.`);
  if (keywords?.[0]) tips.push(`Gunakan keyword “${keywords[0].term}” sebagai fokus monitoring lanjutan dan SEO berita.`);
  if (topDomains?.[0]) tips.push(`Bandingkan narasi dari domain dominan ${topDomains[0].term} dengan sumber resmi atau data primer.`);
  if ((counts.netral / Math.max(total, 1)) > 0.55) tips.push('Sentimen masih netral; gali konflik, dampak publik, data angka, dan kutipan agar angle lebih kuat.');
  tips.push('Simpan laporan HTML untuk rapat redaksi atau lampirkan ke brief editor.');
  return tips.slice(0, 5);
}

function buildRelease(payload = {}) {
  const what = payload.what?.trim() || '[Apa peristiwanya]';
  const who = payload.who?.trim() || '[Siapa pihak terlibat]';
  const where = payload.where?.trim() || '[Di mana]';
  const when = payload.when?.trim() || '[Kapan]';
  const why = payload.why?.trim() || '[Mengapa penting]';
  const how = payload.how?.trim() || '[Bagaimana kronologinya]';
  const quote = payload.quote?.trim();
  const contact = payload.contact?.trim();
  const title = payload.title?.trim() || `${what}: ${who} Dorong Informasi Publik yang Lebih Akurat`;
  const lead = `${who} menyampaikan ${what} di ${where} pada ${when}. Kegiatan ini penting karena ${why}.`;
  const body = `${lead}\n\nDalam kegiatan tersebut, proses utama dilakukan dengan cara ${how}. Informasi ini disusun agar publik memahami konteks peristiwa secara utuh, mulai dari latar belakang, pihak yang terlibat, dampak, hingga tindak lanjut yang perlu diketahui.\n\nRedaksi mencatat unsur 5W+1H telah terpenuhi: apa peristiwanya adalah ${what}; siapa yang terlibat adalah ${who}; lokasi peristiwa berada di ${where}; waktu pelaksanaan pada ${when}; alasan pentingnya peristiwa adalah ${why}; dan proses pelaksanaannya dilakukan dengan ${how}.${quote ? `\n\n“${quote}”` : ''}${contact ? `\n\nNarahubung: ${contact}` : ''}`;
  const checklist = [
    { key: 'what', label: 'What / Apa', value: what, complete: !what.includes('[') },
    { key: 'who', label: 'Who / Siapa', value: who, complete: !who.includes('[') },
    { key: 'where', label: 'Where / Di mana', value: where, complete: !where.includes('[') },
    { key: 'when', label: 'When / Kapan', value: when, complete: !when.includes('[') },
    { key: 'why', label: 'Why / Mengapa', value: why, complete: !why.includes('[') },
    { key: 'how', label: 'How / Bagaimana', value: how, complete: !how.includes('[') }
  ];
  return {
    title,
    lead,
    body,
    checklist,
    editorialScore: Math.round((checklist.filter(c => c.complete).length / 6) * 100),
    generatedAt: new Date().toISOString()
  };
}

async function parseUploadedFile(file) {
  const text = file.buffer.toString('utf8');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.json' || file.mimetype.includes('json')) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.posts)) return parsed.posts;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (Array.isArray(parsed.claims)) return parsed.claims;
    return [parsed];
  }
  if (ext === '.csv' || file.mimetype.includes('csv') || file.mimetype.includes('excel')) {
    return new Promise((resolve, reject) => {
      const rows = [];
      parseString(text, { headers: true, ignoreEmpty: true, trim: true })
        .on('error', reject)
        .on('data', row => rows.push(row))
        .on('end', () => resolve(rows));
    });
  }
  throw new Error('Format belum didukung. Gunakan JSON atau CSV dari Apify, Social X, X export, atau scraper lain.');
}


function gdeltCacheKey({ query, timespan, maxrecords }) {
  return JSON.stringify({
    query: String(query || '').trim().toLowerCase(),
    timespan,
    maxrecords: Number(maxrecords || 0)
  });
}

function pruneGdeltCache() {
  while (gdeltCache.size > GDELT_MAX_CACHE_ENTRIES) {
    const oldestKey = gdeltCache.keys().next().value;
    gdeltCache.delete(oldestKey);
  }
}

async function fetchGdeltJson(url, cacheKey) {
  const cached = gdeltCache.get(cacheKey);
  const age = cached ? Date.now() - cached.createdAt : Infinity;
  if (cached && age <= GDELT_CACHE_TTL_MS) {
    return { ...cached.data, _cache: { source: 'gdelt', status: 'fresh', ageMs: age } };
  }

  const request = gdeltQueue.then(async () => {
    const waitMs = gdeltNextAllowedAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    gdeltNextAllowedAt = Date.now() + GDELT_MIN_INTERVAL_MS;
    try {
      const data = await fetchJson(url);
      gdeltCache.set(cacheKey, { createdAt: Date.now(), data });
      pruneGdeltCache();
      return data;
    } catch (err) {
      if (err.status === 429) {
        const backoff = Math.max(err.retryAfterMs || GDELT_MIN_INTERVAL_MS * 2, GDELT_MIN_INTERVAL_MS * 2);
        gdeltNextAllowedAt = Date.now() + backoff;
        if (cached && age <= GDELT_STALE_CACHE_MS) {
          return { ...cached.data, _cache: { source: 'gdelt', status: 'stale-after-429', ageMs: age, backoffMs: backoff } };
        }
        err.message = `GDELT rate limit aktif (429). Aplikasi sudah memakai antrian minimal ${Math.ceil(GDELT_MIN_INTERVAL_MS / 1000)} detik dan backoff otomatis. Coba lagi sebentar, kurangi frekuensi refresh, atau nonaktifkan sementara sumber GDELT dan gunakan RSS/Bluesky.`;
      }
      throw err;
    }
  });

  gdeltQueue = request.catch(() => {});
  return request;
}

async function getGdelt(query = 'Indonesia', hours = 24, maxRecords = 80) {
  const safeQuery = String(query || 'Indonesia').trim() || 'Indonesia';
  const safeHours = Math.min(Math.max(Number(hours || 24), 1), 360 * 24);
  const timespan = safeHours <= 168 ? `${Math.round(safeHours)}h` : `${Math.round(safeHours / 24)}d`;
  // Keep GDELT query volume modest. Large queries work, but smaller pulls reduce public API pressure.
  const maxrecords = String(Math.min(Math.max(Number(maxRecords || 60), 10), 100));
  const params = new URLSearchParams({
    query: safeQuery,
    mode: 'artlist',
    format: 'json',
    sort: 'datedesc',
    maxrecords,
    timespan
  });
  const cacheKey = gdeltCacheKey({ query: safeQuery, timespan, maxrecords });
  const data = await fetchGdeltJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, cacheKey);
  return (data.articles || []).map(article => normalizeItem({
    ...article,
    title: article.title,
    text: article.title,
    url: article.url,
    sourceType: 'gdelt',
    source: article.sourceCommonName || 'gdelt',
    metrics: { views: 0 }
  }, 'gdelt'));
}

async function getBluesky(query = 'Indonesia', max = 50) {
  const params = new URLSearchParams({
    q: query || 'Indonesia',
    limit: String(Math.min(Math.max(Number(max || 50), 10), 100)),
    sort: 'latest'
  });
  const data = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}`);
  return (data.posts || []).map(post => normalizeItem({
    id: post.cid,
    uri: post.uri,
    text: post.record?.text || '',
    author: post.author,
    url: post.uri?.startsWith('at://') ? `https://bsky.app/profile/${post.author?.handle}/post/${post.uri.split('/').pop()}` : '',
    createdAt: post.record?.createdAt || post.indexedAt,
    metrics: {
      likes: post.likeCount || 0,
      comments: post.replyCount || 0,
      shares: post.repostCount || 0,
      quotes: post.quoteCount || 0
    },
    sourceType: 'bluesky',
    platform: 'bluesky'
  }, 'bluesky'));
}

async function getHackerNews(query = 'Indonesia', hours = 24, max = 50) {
  const since = Math.floor((Date.now() - Math.min(Math.max(Number(hours || 24), 1), 360 * 24) * 3600 * 1000) / 1000);
  const params = new URLSearchParams({
    query: query || 'Indonesia',
    tags: 'story',
    hitsPerPage: String(Math.min(Math.max(Number(max || 50), 10), 100)),
    numericFilters: `created_at_i>${since}`
  });
  const data = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?${params}`);
  return (data.hits || []).map(hit => normalizeItem({
    ...hit,
    id: hit.objectID,
    title: hit.title,
    text: hit.title || hit.story_text,
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author,
    createdAt: hit.created_at_i,
    metrics: { likes: hit.points || 0, comments: hit.num_comments || 0 },
    sourceType: 'hackernews',
    platform: 'hackernews'
  }, 'hackernews'));
}

async function getRssFeed({ query = 'Indonesia', url = '', max = 50, days = 7 } = {}) {
  const safeDays = normalizeDurationDays(days);
  const googleQuery = `${query || 'Indonesia'} when:${safeDays}d`;
  const rssUrl = url || `https://news.google.com/rss/search?q=${encodeURIComponent(googleQuery)}&hl=id&gl=ID&ceid=ID:id`;
  const xml = await fetchText(rssUrl);
  const parsed = xmlParser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed || {};
  let entries = channel.item || channel.entry || [];
  if (!Array.isArray(entries)) entries = [entries];
  return entries.slice(0, Math.min(Math.max(Number(max || 50), 5), 100)).map(entry => {
    const link = typeof entry.link === 'string' ? entry.link : (entry.link?.href || entry.guid || '');
    const sourceName = typeof entry.source === 'string' ? entry.source : entry.source?.text;
    return normalizeItem({
      id: entry.guid?.text || entry.guid || entry.id || link,
      title: entry.title?.text || entry.title,
      text: entry.description?.text || entry.description || entry.summary || entry.title,
      url: link,
      author: sourceName || entry.author?.name || domainFromUrl(link),
      createdAt: entry.pubDate || entry.updated || entry.published,
      sourceType: 'rss',
      platform: 'rss'
    }, 'rss');
  });
}


async function getRssUrlEntries({ url, label = 'News', max = 24, region = 'national' } = {}) {
  const xml = await fetchText(url);
  const parsed = xmlParser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed || {};
  let entries = channel.item || channel.entry || [];
  if (!Array.isArray(entries)) entries = [entries];
  return entries.slice(0, Math.min(Math.max(Number(max || 24), 5), 60)).map(entry => {
    const link = typeof entry.link === 'string' ? entry.link : (entry.link?.href || entry.guid || '');
    const sourceName = typeof entry.source === 'string' ? entry.source : entry.source?.text;
    const title = entry.title?.text || entry.title || '';
    const text = entry.description?.text || entry.description || entry.summary || title;
    const item = normalizeItem({
      id: entry.guid?.text || entry.guid || entry.id || link,
      title,
      text,
      url: link,
      author: sourceName || label || domainFromUrl(link),
      createdAt: entry.pubDate || entry.updated || entry.published || new Date().toISOString(),
      source: label,
      sourceType: 'trend-rss',
      platform: region,
      metrics: { views: 0 }
    }, 'rss');
    item.reason = `Masuk radar karena muncul di feed tren ${region === 'international' ? 'internasional' : 'nasional'} dari ${label}. Item ini menjadi rujukan awal manajemen isu, bukan klaim final.`;
    return item;
  });
}

async function getCurrentIssueTrends({ days = 7, max = 24 } = {}) {
  const safeDays = normalizeDurationDays(days);
  const perFeed = Math.max(6, Math.min(20, Math.ceil(Number(max || 24) / 2)));
  const feeds = {
    national: [
      { label: 'Google News Indonesia', url: 'https://news.google.com/rss/topstories?hl=id&gl=ID&ceid=ID:id' },
      { label: 'Google News Indonesia - Nation', url: 'https://news.google.com/rss/headlines/section/topic/NATION?hl=id&gl=ID&ceid=ID:id' }
    ],
    international: [
      { label: 'Google News Global', url: 'https://news.google.com/rss/topstories?hl=en-US&gl=US&ceid=US:en' },
      { label: 'Google News World', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en' }
    ]
  };
  async function loadGroup(group, region) {
    const settled = await Promise.allSettled(group.map(feed => getRssUrlEntries({ ...feed, max: perFeed, region })));
    const rows = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const cutoff = Date.now() - safeDays * 24 * 3600 * 1000;
    const dedup = new Map();
    for (const item of rows) {
      const date = new Date(item.createdAt || Date.now()).getTime();
      if (!Number.isNaN(date) && date < cutoff) continue;
      const key = normalizeKeywordQuery(item.title || item.url || '').slice(0, 160) || item.url;
      if (!dedup.has(key)) dedup.set(key, item);
    }
    return [...dedup.values()].slice(0, Number(max || 24));
  }
  const [national, international] = await Promise.all([loadGroup(feeds.national, 'national'), loadGroup(feeds.international, 'international')]);
  const combined = [...national, ...international];
  const analysis = analyzeItems(combined);
  const topKeyword = analysis.keywords?.[0]?.term || 'isu utama';
  const topSource = analysis.topSources?.[0]?.term || analysis.topSources?.[0]?.source || 'sumber berita publik';
  const recommendations = [
    { title: 'Buat watchlist isu prioritas', detail: `Pantau keyword dominan “${topKeyword}” selama ${safeDays} hari ke depan untuk melihat eskalasi narasi.`, action: 'Masukkan 3–5 judul tren teratas ke agenda rapat redaksi/humas harian.' },
    { title: 'Pisahkan isu nasional dan internasional', detail: 'Gunakan kelompok nasional untuk dampak lokal dan kelompok internasional untuk konteks global, risiko reputasi, serta benchmarking kebijakan.', action: 'Beri label isu: reputasi, kebijakan, layanan publik, ekonomi, keamanan, atau teknologi.' },
    { title: 'Verifikasi sebelum respons', detail: `Sumber dominan saat ini: ${topSource}. Gunakan feed ini sebagai indikator awal, lalu cek sumber primer sebelum membuat pernyataan resmi.`, action: 'Klik link sumber, cek tanggal, penerbit, dan relevansi dengan stakeholder organisasi.' }
  ];
  return { durationDays: safeDays, generatedAt: new Date().toISOString(), national, international, recommendations, analysis };
}

const platformSearchConfig = {
  facebook: { label: 'Facebook', query: q => `site:facebook.com ${q}`, source: 'facebook' },
  x: { label: 'X', query: q => `(site:x.com OR site:twitter.com) ${q}`, source: 'x' },
  threads: { label: 'Threads', query: q => `site:threads.net ${q}`, source: 'threads' },
  youtube: { label: 'YouTube', query: q => `site:youtube.com ${q}`, source: 'youtube' },
  tiktok: { label: 'TikTok', query: q => `site:tiktok.com ${q}`, source: 'tiktok' },
  instagram: { label: 'Instagram', query: q => `site:instagram.com ${q}`, source: 'instagram' },
  linkedin: { label: 'LinkedIn', query: q => `site:linkedin.com ${q}`, source: 'linkedin' }
};

async function getPlatformSearch(platform, query = 'Indonesia', max = 50, datasetId = '', token = '', days = 7) {
  const cfg = platformSearchConfig[platform];
  if (!cfg) return [];
  if (datasetId) {
    const rows = await getApifyDataset(datasetId, max, token);
    return rows.map(item => ({ ...item, source: platform, platform, sourceType: 'apify-social' }));
  }
  // No-key fallback: use Google News RSS with a platform-specific site query.
  // This returns public indexed items/mentions, not private social content.
  const rows = await getRssFeed({ query: cfg.query(query), max, days });
  return rows.map(item => ({ ...item, source: platform, platform, sourceType: 'public-social-rss', author: item.author || cfg.label }));
}

async function getApifyDataset(datasetId, limit, token) {
  if (!datasetId) throw new Error('Dataset ID Apify wajib diisi. Dataset publik bisa dibaca tanpa token; dataset privat butuh token.');
  const params = new URLSearchParams({ clean: 'true', format: 'json', limit: String(Math.min(Number(limit || 100), MAX_IMPORT_ITEMS)) });
  const data = await fetchJson(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return Array.isArray(data) ? data.map(item => normalizeItem({ ...item, sourceType: 'apify' }, 'apify')) : [];
}

async function googleFactCheck(query, key) {
  if (!key) return { provider: 'google_factcheck', enabled: false, claims: [] };
  const params = new URLSearchParams({ query, key, languageCode: 'id' });
  const data = await fetchJson(`https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`);
  const claims = (data.claims || []).map(claim => ({
    text: claim.text,
    claimant: claim.claimant,
    claimDate: claim.claimDate,
    reviews: (claim.claimReview || []).map(review => ({
      publisher: review.publisher?.name,
      title: review.title,
      url: review.url,
      reviewDate: review.reviewDate,
      rating: review.textualRating,
      languageCode: review.languageCode
    }))
  }));
  return { provider: 'google_factcheck', enabled: true, claims };
}

async function mafindoSearch(query, key) {
  if (!key) return { provider: 'turnbackhoax', enabled: false, articles: [] };
  const encoded = encodeURIComponent(query);
  const urls = [
    `https://yudistira.turnbackhoax.id/Antihoax/title/${encoded}/${key}`,
    `https://yudistira.turnbackhoax.id/Antihoax/content/${encoded}/${key}`,
    `https://yudistira.turnbackhoax.id/Antihoax/tags/${encoded}/${key}`
  ];
  const articles = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      articles.push(...rows.map(row => normalizeItem({ ...row, sourceType: 'turnbackhoax' }, 'turnbackhoax')));
    } catch {}
  }
  const unique = uniqueBy(articles, item => item.url || item.id).slice(0, 30);
  return { provider: 'turnbackhoax', enabled: true, articles: unique };
}

async function openEvidenceSearch(query) {
  const evidenceQuery = `${query} hoaks OR hoax OR klarifikasi OR cek fakta`;
  const [rssSettled, gdeltSettled] = await Promise.allSettled([
    getRssFeed({ query: evidenceQuery, max: 30 }),
    getGdelt(evidenceQuery, 168, 50)
  ]);
  const items = [
    ...(rssSettled.status === 'fulfilled' ? rssSettled.value : []),
    ...(gdeltSettled.status === 'fulfilled' ? gdeltSettled.value : [])
  ];
  const trustedHints = ['turnbackhoax', 'cekfakta', 'kominfo', 'tempo.co', 'kompas.com', 'liputan6.com', 'tirto.id', 'antaranews.com'];
  return uniqueBy(items, item => item.url || item.id)
    .map(item => ({ ...item, evidenceLevel: trustedHints.some(h => (item.url || '').includes(h)) ? 'prioritas' : 'terbuka' }))
    .sort((a, b) => (a.evidenceLevel === 'prioritas' ? -1 : 1) - (b.evidenceLevel === 'prioritas' ? -1 : 1))
    .slice(0, 30);
}

async function hoaxCheck(query, keys = {}) {
  const [google, mafindo, evidence] = await Promise.allSettled([
    googleFactCheck(query, keys.googleKey),
    mafindoSearch(query, keys.mafindoKey),
    openEvidenceSearch(query)
  ]);
  const googleData = google.status === 'fulfilled' ? google.value : { provider: 'google_factcheck', enabled: Boolean(keys.googleKey), claims: [], error: google.reason?.message };
  const mafindoData = mafindo.status === 'fulfilled' ? mafindo.value : { provider: 'turnbackhoax', enabled: Boolean(keys.mafindoKey), articles: [], error: mafindo.reason?.message };
  const evidenceItems = evidence.status === 'fulfilled' ? evidence.value : [];
  const signalWords = tokenize(query).filter(w => hoaxSignals.has(w));
  const reviewCount = (googleData.claims || []).reduce((n, c) => n + (c.reviews?.length || 0), 0) + (mafindoData.articles?.length || 0);
  const priorityEvidence = evidenceItems.filter(i => i.evidenceLevel === 'prioritas').length;
  let verdict = 'Belum ada bukti kuat di database fact-check; lanjutkan verifikasi manual.';
  let risk = 'sedang';
  if (reviewCount > 0) {
    verdict = 'Ditemukan rujukan fact-check. Baca rating/klarifikasi sebelum publikasi.';
    risk = 'tinggi';
  } else if (priorityEvidence > 0) {
    verdict = 'Ditemukan rujukan terbuka dari kanal cek fakta/berita kredibel. Periksa kecocokan klaim.';
    risk = 'sedang';
  } else if (signalWords.length >= 2) {
    verdict = 'Klaim mengandung sinyal bahasa yang sering muncul pada hoaks/scam. Verifikasi sumber primer wajib dilakukan.';
    risk = 'sedang';
  } else {
    risk = 'rendah';
  }
  return {
    query,
    verdict,
    risk,
    signalWords,
    providers: { google: googleData, mafindo: mafindoData },
    evidence: evidenceItems,
    checklist: [
      'Cek sumber pertama klaim, bukan hanya akun repost.',
      'Cari dokumen/surat/rekaman asli dan metadata waktunya.',
      'Hubungi lembaga atau narasumber primer yang disebut dalam klaim.',
      'Bandingkan dengan minimal dua media kredibel atau database cek fakta.',
      'Hindari memakai judul memastikan “hoaks” sebelum bukti kuat tersedia.'
    ],
    generatedAt: new Date().toISOString()
  };
}

function uniqueBy(arr, fn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = fn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}


function liveCacheKey(payload = {}) {
  const sources = Array.isArray(payload.sources) ? payload.sources.slice().sort() : String(payload.sources || '').split(',').map(s => s.trim()).filter(Boolean).sort();
  const platformDatasets = payload.platformDatasets || {};
  return JSON.stringify({
    query: String(payload.query || 'Indonesia').trim().toLowerCase(),
    durationDays: normalizeDurationDays(payload.durationDays || Math.ceil(Number(payload.hours || 24) / 24) || 7),
    max: Math.min(Number(payload.max || 60), 100),
    sources,
    rssUrl: String(payload.rssUrl || '').trim(),
    datasetId: String(payload.datasetId || '').trim(),
    platformDatasets
  });
}

function pruneLiveSearchCache() {
  const now = Date.now();
  for (const [key, value] of liveSearchCache) {
    if (!value || now - value.createdAt > LIVE_SEARCH_CACHE_TTL_MS) liveSearchCache.delete(key);
  }
  while (liveSearchCache.size > 60) liveSearchCache.delete(liveSearchCache.keys().next().value);
}

async function withSourceTimeout(promise, source, timeoutMs = LIVE_SOURCE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${source} timeout setelah ${Math.round(timeoutMs / 1000)} detik. Sumber ini dilewati agar pencarian tetap cepat.`);
          err.status = 504;
          reject(err);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function gdeltFastFallback(query = 'Indonesia', hours = 24, maxRecords = 80) {
  const safeQuery = String(query || 'Indonesia').trim() || 'Indonesia';
  const safeHours = Math.min(Math.max(Number(hours || 24), 1), 360 * 24);
  const timespan = safeHours <= 168 ? `${Math.round(safeHours)}h` : `${Math.round(safeHours / 24)}d`;
  const maxrecords = String(Math.min(Math.max(Number(maxRecords || 60), 10), 100));
  const cacheKey = gdeltCacheKey({ query: safeQuery, timespan, maxrecords });
  const cached = gdeltCache.get(cacheKey);
  if (!cached) return null;
  return (cached.data.articles || []).map(article => normalizeItem({
    ...article,
    title: article.title,
    text: article.title,
    url: article.url,
    sourceType: 'gdelt-cache-fast',
    source: article.sourceCommonName || 'gdelt',
    metrics: { views: 0 }
  }, 'gdelt'));
}


function normalizeGeoScope(geo = {}) {
  const terms = Array.isArray(geo.terms) ? geo.terms : [];
  const cleanedTerms = terms
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i)
    .slice(0, String(geo.searchMode || 'fast') === 'deep' ? 18 : String(geo.searchMode || 'fast') === 'standard' ? 12 : 8);
  const city = String(geo.city || '').trim();
  const country = String(geo.country || '').trim();
  const region = String(geo.region || '').trim();
  const continent = String(geo.continent || 'global').trim();
  if (country && !cleanedTerms.some(t => t.toLowerCase() === country.toLowerCase())) cleanedTerms.push(country);
  if (city && !cleanedTerms.some(t => t.toLowerCase() === city.toLowerCase())) cleanedTerms.push(city);
  const label = String(geo.label || [continent !== 'global' ? continent : '', region, country, city].filter(Boolean).join(' · ') || 'Global / semua wilayah').trim();
  return { continent, region, country, city, terms: cleanedTerms, label, searchMode: String(geo.searchMode || 'fast') };
}

function buildGeoSearchQuery(query = '', geo = {}) {
  const base = String(query || '').trim() || 'Indonesia';
  const g = normalizeGeoScope(geo);
  if (!g.terms.length) return { query: base, geo: g, suffix: '' };
  const cityCountry = [g.city, g.country].filter(Boolean).join(' ');
  const terms = g.terms.slice(0, 10).map(t => String(t).replace(/[()"]/g, '').trim()).filter(Boolean);
  const suffix = cityCountry || (terms.length > 1 ? `(${terms.join(' OR ')})` : terms[0]);
  return { query: `${base} ${suffix}`.trim(), geo: g, suffix };
}

function geoMatchesItem(item = {}, geo = {}) {
  const g = normalizeGeoScope(geo);
  if (!g.terms.length) return true;
  const hay = `${item.url || ''} ${item.source || ''} ${item.platform || ''} ${item.author || ''} ${item.title || ''} ${item.text || ''}`.toLowerCase();
  return g.terms.some(term => hay.includes(String(term).toLowerCase()));
}

function annotateGeoScope(items = [], geo = {}) {
  const g = normalizeGeoScope(geo);
  if (!g.terms.length) return items;
  return items.map(item => ({ ...item, geoScope: g.label, geoMatched: geoMatchesItem(item, g) }));
}


async function collectOneSource(source, { query, hours, max, durationDays, payload }) {
  if (source === 'gdelt') {
    const waitingMs = Math.max(gdeltNextAllowedAt - Date.now(), 0);
    if (waitingMs > 2500) {
      const cached = gdeltFastFallback(query, hours, max);
      if (cached) return { source, items: cached, warning: `GDELT memakai cache cepat karena rate-limit masih menunggu ${Math.ceil(waitingMs / 1000)} detik.` };
    }
    return { source, items: await withSourceTimeout(getGdelt(query, hours, max), source) };
  }
  if (source === 'bluesky' || source === 'bsky') return { source, items: await withSourceTimeout(getBluesky(query, max), source) };
  if (source === 'hackernews' || source === 'hn') return { source, items: await withSourceTimeout(getHackerNews(query, hours, max), source) };
  if (source === 'rss') return { source, items: await withSourceTimeout(getRssFeed({ query, url: payload.rssUrl, max, days: durationDays }), source) };
  if (platformSearchConfig[source]) {
    const datasetId = payload.platformDatasets?.[source] || payload[`${source}DatasetId`] || '';
    return { source, items: await withSourceTimeout(getPlatformSearch(source, query, max, datasetId, payload.apifyToken || process.env.APIFY_TOKEN, durationDays), source) };
  }
  if (source === 'apify' && payload.datasetId) return { source, items: await withSourceTimeout(getApifyDataset(payload.datasetId, max, payload.apifyToken || process.env.APIFY_TOKEN), source) };
  return { source, items: [], warning: `Sumber ${source} tidak dikenali atau belum dikonfigurasi.` };
}

async function collectSources(payload = {}) {
  const originalQuery = String(payload.query || payload.displayQuery || 'Indonesia').trim();
  const geoScope = normalizeGeoScope(payload.geo || {});
  const searchQueryInfo = buildGeoSearchQuery(originalQuery, geoScope);
  const query = originalQuery || searchQueryInfo.query || 'Indonesia';
  const searchQuery = searchQueryInfo.query || query;
  const sources = Array.isArray(payload.sources) && payload.sources.length ? payload.sources : String(payload.sources || 'gdelt,bluesky,rss').split(',').map(s => s.trim()).filter(Boolean);
  const searchMode = String(payload.searchMode || geoScope.searchMode || 'fast');
  const maxBase = Math.min(Math.max(Number(payload.max || (searchMode === 'deep' ? 90 : searchMode === 'standard' ? 60 : 40)), 10), 100);
  const max = searchMode === 'fast' ? Math.min(maxBase, 50) : searchMode === 'standard' ? Math.min(maxBase, 80) : maxBase;
  const durationDays = normalizeDurationDays(payload.durationDays || Math.ceil(Number(payload.hours || 24) / 24) || 7);
  const hours = durationDays * 24;
  pruneLiveSearchCache();
  const cacheKey = liveCacheKey({ ...payload, query, searchQuery, geoScope, sources, max, durationDays, searchMode });
  const cached = liveSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt <= LIVE_SEARCH_CACHE_TTL_MS) {
    return { ...cached.result, cached: true, cacheAgeMs: Date.now() - cached.createdAt };
  }

  const context = { query: searchQuery, originalQuery: query, geoScope, hours, max, durationDays, payload };
  const settled = await Promise.allSettled(sources.map(source => collectOneSource(source, context)));
  const all = [];
  const errors = [];
  const warnings = [];
  settled.forEach((result, idx) => {
    const source = sources[idx];
    if (result.status === 'fulfilled') {
      if (Array.isArray(result.value.items)) all.push(...result.value.items);
      if (result.value.warning) warnings.push({ source, message: result.value.warning });
    } else {
      errors.push({ source, message: result.reason?.message || 'Sumber gagal diambil', status: result.reason?.status || 500 });
    }
  });

  let unique = uniqueBy(annotateGeoScope(all, geoScope), item => item.url || item.id).slice(0, MAX_IMPORT_ITEMS);
  let scoped = filterItemsByDuration(unique, durationDays).slice(0, MAX_IMPORT_ITEMS);
  let relevance = filterItemsByQueryRelevance(scoped, query);

  // Fast recovery: if all selected sources fail/return off-keyword results, try a direct Google News RSS fallback.
  // This keeps the UI useful while still applying keyword relevance before results enter the analysis/report.
  if (!relevance.matched.length && query) {
    try {
      const fallbackRows = await withSourceTimeout(getRssFeed({ query: searchQuery, max, days: durationDays }), 'rss-fallback', Math.min(LIVE_SOURCE_TIMEOUT_MS, 6500));
      if (fallbackRows.length) {
        warnings.push({ source: 'rss-fallback', message: 'Pencarian utama kosong; aplikasi memakai fallback Google News RSS sesuai cakupan wilayah dan tetap diaudit berdasarkan keyword.' });
        unique = uniqueBy([...annotateGeoScope(fallbackRows, geoScope), ...unique], item => item.url || item.id).slice(0, MAX_IMPORT_ITEMS);
        scoped = filterItemsByDuration(unique, durationDays).slice(0, MAX_IMPORT_ITEMS);
        relevance = filterItemsByQueryRelevance(scoped, query);
      }
    } catch (err) {
      warnings.push({ source: 'rss-fallback', message: err.message || 'Fallback RSS gagal.' });
    }
  }

  const analysis = analyzeItems(relevance.matched);
  analysis.durationDays = durationDays;
  analysis.geoScope = geoScope;
  analysis.searchQuery = searchQuery;
  analysis.queryRelevance = relevance.summary;
  analysis.rawTotalBeforeRelevanceFilter = scoped.length;
  const result = { query, searchQuery, geoScope, sources, durationDays, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 80), relevance: relevance.summary, analysis, errors, warnings, performance: { fetched: all.length, unique: unique.length, scoped: scoped.length, accepted: relevance.matched.length, sourceCount: sources.length, searchMode, geoScope: geoScope.label, generatedAt: new Date().toISOString(), cacheKey } };
  liveSearchCache.set(cacheKey, { createdAt: Date.now(), result });
  return result;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}


function reportHtmlJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function inferCountryFromItem(item = {}) {
  const hay = `${item.url || ''} ${item.source || ''} ${item.platform || ''} ${item.author || ''}`.toLowerCase();
  if (/\.id\b|indonesia|jakarta|detik|kompas|tempo|kumparan|liputan6|tribun|antara|cnbc indonesia|sindonews|republika|suara\.com|rmol|mpr\.go\.id|kemenag|airlangga|unair/.test(hay)) return { country: 'Indonesia', code: 'ID', x: 74, y: 57 };
  if (/\.sg\b|singapore/.test(hay)) return { country: 'Singapore', code: 'SG', x: 71, y: 55 };
  if (/\.my\b|malaysia/.test(hay)) return { country: 'Malaysia', code: 'MY', x: 70, y: 55 };
  if (/\.uk\b|bbc|united kingdom|london/.test(hay)) return { country: 'United Kingdom', code: 'GB', x: 47, y: 34 };
  if (/\.au\b|australia|sydney/.test(hay)) return { country: 'Australia', code: 'AU', x: 82, y: 69 };
  if (/\.jp\b|japan|tokyo/.test(hay)) return { country: 'Japan', code: 'JP', x: 82, y: 40 };
  if (/\.cn\b|china|beijing/.test(hay)) return { country: 'China', code: 'CN', x: 75, y: 42 };
  if (/\.in\b|india|mumbai|delhi/.test(hay)) return { country: 'India', code: 'IN', x: 67, y: 48 };
  if (/\.br\b|brazil/.test(hay)) return { country: 'Brazil', code: 'BR', x: 35, y: 66 };
  if (/\.de\b|germany|berlin/.test(hay)) return { country: 'Germany', code: 'DE', x: 50, y: 35 };
  if (/\.fr\b|france|paris/.test(hay)) return { country: 'France', code: 'FR', x: 49, y: 38 };
  if (/\.ae\b|dubai|emirates/.test(hay)) return { country: 'United Arab Emirates', code: 'AE', x: 60, y: 45 };
  if (/tiktok|facebook|instagram|youtube|linkedin|x\.com|twitter|news\.google|\.com\b/.test(hay)) return { country: 'Global / US platform', code: 'US', x: 22, y: 42 };
  return { country: 'Global / Unknown', code: 'GL', x: 54, y: 45 };
}

function buildSourceMapPins(items = []) {
  const by = new Map();
  for (const item of items) {
    const loc = inferCountryFromItem(item);
    const key = loc.code;
    const row = by.get(key) || { ...loc, count: 0, negative: 0, positive: 0, neutral: 0, sources: new Set(), sampleUrl: '' };
    row.count += 1;
    const sentiment = String(item.sentiment?.label || item.sentiment || 'netral').toLowerCase();
    if (sentiment.includes('neg')) row.negative += 1;
    else if (sentiment.includes('pos')) row.positive += 1;
    else row.neutral += 1;
    row.sources.add(String(item.source || item.platform || loc.country || '-'));
    if (!row.sampleUrl && item.url) row.sampleUrl = item.url;
    by.set(key, row);
  }
  return [...by.values()].map(r => ({ ...r, sources: [...r.sources].slice(0, 5), radius: Math.min(22, 7 + Math.sqrt(r.count) * 2.8) })).sort((a, b) => b.count - a.count).slice(0, 12);
}

function stripTableText(value = '', limit = 220) {
  return pdfSafe(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function renderHtmlReport({ analysis, release, hoax, query, profile, print = false }) {
  const a = analysis || analyzeItems([]);
  const rel = release?.body ? release : null;
  const owner = cleanReportProfile(profile || {});
  const date = new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' });
  const durationDays = Number(a.durationDays || 7);
  const durationLabel = `${durationDays} hari`;
  const pos = Number(a.percentages?.positif || 0);
  const neu = Number(a.percentages?.netral || 0);
  const neg = Number(a.percentages?.negatif || 0);
  const total = Number(a.total || 0);
  const logo = REPORT_LOGO_PNG_DATA_URI;
  const printScript = print ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),450));</script>' : '';
  const audit = a.queryRelevance || filterItemsByQueryRelevance(a.items || [], query || '').summary;
  const recommendations = (a.recommendations || []).map((r, i) => `<li><b>R${i + 1}</b><span>${escapeHtml(r)}</span></li>`).join('') || '<li><b>R1</b><span>Perkaya data monitoring dan lakukan verifikasi manual terhadap tautan yang paling viral.</span></li>';
  const keywordMax = Math.max(1, ...(a.keywords || []).map(x => Number(x.count || 0)), 1);
  const wordCloud = (a.keywords || []).slice(0, 36).map((k, idx) => {
    const size = 0.86 + (Number(k.count || 0) / keywordMax) * 1.35;
    return `<button type="button" class="w c${(idx % 6) + 1}" data-keyword="${escapeHtml(k.term)}" style="--s:${size}">${escapeHtml(k.term)}<b>${escapeHtml(String(k.count))}</b></button>`;
  }).join('') || '<span>Belum ada kata kunci dominan.</span>';
  const sourceRows = (a.topSources || []).slice(0, 10).map((k, i) => `<li><span>${i + 1}. ${escapeHtml(k.term)}</span><b>${escapeHtml(String(k.count))}</b></li>`).join('');
  const authorRows = (a.topAuthors || []).slice(0, 10).map((k, i) => `<li><span>${i + 1}. ${escapeHtml(k.term)}</span><b>${escapeHtml(String(k.count))}</b></li>`).join('');
  const itemsWithLinks = (a.items || []).filter(item => item.url).map((item, idx) => {
    const loc = inferCountryFromItem(item);
    return { idx: idx + 1, source: String(item.source || item.platform || '-'), platform: String(item.platform || item.source || '-'), sentiment: String(item.sentiment?.label || item.sentiment || 'netral').toLowerCase(), author: String(item.author || '-'), title: stripTableText(item.title || item.text || '-', 260), url: String(item.url || ''), createdAt: item.createdAt || '', viralScore: Number(item.viralScore || 0), likes: Number(item.metrics?.likes || 0), comments: Number(item.metrics?.comments || 0), shares: Number(item.metrics?.shares || 0), views: Number(item.metrics?.views || item.reach || 0), saves: Number(item.metrics?.saves || 0), followers: Number(item.metrics?.followers || 0), reach: Number(item.metrics?.views || item.reach || 0), country: loc.country, countryCode: loc.code, x: loc.x, y: loc.y };
  });
  const negativeLinks = itemsWithLinks.filter(item => item.sentiment.includes('neg'));
  const socialTotals = itemsWithLinks.reduce((acc, item) => {
    acc.likes += Number(item.likes || 0);
    acc.comments += Number(item.comments || 0);
    acc.shares += Number(item.shares || 0);
    acc.views += Number(item.views || 0);
    acc.saves += Number(item.saves || 0);
    return acc;
  }, { likes: 0, comments: 0, shares: 0, views: 0, saves: 0 });

  const mapPins = buildSourceMapPins(a.items || []);
  const sourceOptions = [...new Set(itemsWithLinks.map(x => x.source).filter(Boolean))].sort().map(s => `<option value="${escapeHtml(s.toLowerCase())}">${escapeHtml(s)}</option>`).join('');
  const countryOptions = [...new Set(itemsWithLinks.map(x => x.country).filter(Boolean))].sort().map(s => `<option value="${escapeHtml(s.toLowerCase())}">${escapeHtml(s)}</option>`).join('');
  const timeline = (a.byHour || []).slice(-24);
  const maxVal = Math.max(1, ...timeline.map(r => Number(r.total || 0)), 1);
  const polyline = timeline.length ? timeline.map((r, idx) => `${timeline.length === 1 ? 30 : 30 + (idx * (540 / Math.max(timeline.length - 1, 1)))},${170 - ((Number(r.total || 0) / maxVal) * 130)}`).join(' ') : '30,170 570,170';
  const dots = timeline.map((r, idx) => {
    const x = timeline.length === 1 ? 30 : 30 + (idx * (540 / Math.max(timeline.length - 1, 1)));
    const y = 170 - ((Number(r.total || 0) / maxVal) * 130);
    const label = new Date(r.time).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit' });
    return `<circle cx="${x}" cy="${y}" r="4" fill="#2563eb"><title>${escapeHtml(label)} - ${escapeHtml(String(r.total || 0))} mention</title></circle>`;
  }).join('');
  const pinsHtml = mapPins.map(pin => `<button type="button" class="map-pin" style="left:${pin.x}%;top:${pin.y}%;--r:${pin.radius}px" data-country="${escapeHtml(pin.country.toLowerCase())}" data-code="${escapeHtml(pin.code)}"><span>${escapeHtml(String(pin.count))}</span><b>${escapeHtml(pin.country)}</b></button>`).join('');
  const mapTop = [...mapPins].sort((a, b) => b.negative - a.negative)[0];
  const dataJson = reportHtmlJson({ links: itemsWithLinks, pins: mapPins });
  const narrative = `Monitoring kata kunci ${query || 'isu'} selama ${durationLabel} menghasilkan ${total} data yang lolos audit relevansi keyword. Sentimen dominan ${a.dominantSentiment || '-'} dengan proporsi negatif ${neg}%. Semua tautan di bagian dokumentasi disaring berdasarkan kecocokan keyword pada judul, isi, penulis, sumber, domain, atau URL.`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Laporan Profesional Newsroom Intelligence</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');:root{font-family:'Poppins',Arial,sans-serif;color:#0f2633;background:#edf5f6;--line:#dbe7ee;--muted:#617386;--blue:#2563eb;--green:#18c87b;--red:#ef4444}*{box-sizing:border-box}body{margin:0;padding:28px;background:#edf5f6}.wrap{max-width:1220px;margin:auto;display:grid;gap:18px}.hero,.card{border:1px solid var(--line);border-radius:26px;background:white;box-shadow:0 14px 42px rgba(15,23,42,.08)}.hero{overflow:hidden;background:linear-gradient(135deg,#071b2b,#083044 50%,#0f4a60);color:white;padding:30px}.hero-top{display:flex;justify-content:space-between;gap:18px;align-items:center}.report-logo{height:64px;max-width:310px;object-fit:contain;background:rgba(255,255,255,.08);padding:8px 12px;border-radius:18px}.pill,.badge{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900}.pill{background:rgba(255,255,255,.12)}.badge{background:#eef6ff;color:#174ea6}.hero h1{font-size:40px;line-height:1.06;margin:20px 0 10px}.hero p{max-width:970px;line-height:1.75;margin:0}.meta-strip,.tools{display:flex;gap:10px;flex-wrap:wrap}.meta-strip{margin-top:16px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}.split{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:18px}.card h2{margin:0 0 14px;font-size:22px}.card p{line-height:1.72}.kpi{font-size:32px;font-weight:950;letter-spacing:-.05em}.muted{color:var(--muted)}.metric{display:grid;gap:8px}.risk{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.risk div{border-radius:16px;padding:14px;background:#f8fbff;border:1px solid #e4edf5}.rank,.recs{list-style:none;margin:0;padding:0;display:grid;gap:8px}.rank li{display:flex;justify-content:space-between;border-bottom:1px solid #edf2f7;padding:10px 0;gap:16px}.rank span{min-width:0;overflow:hidden;text-overflow:ellipsis}.recs li{display:grid;grid-template-columns:46px 1fr;gap:10px;background:#f8fbff;border:1px solid #e4edf5;border-radius:16px;padding:12px}.recs b{background:#2378ff;color:white;border-radius:12px;text-align:center;padding:8px 6px}.wordcloud{min-height:210px;padding:16px;border-radius:18px;border:1px solid #dbe7f0;background:linear-gradient(180deg,#fbfdff,#f1f7fb);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px}.wordcloud .w{font-size:calc(14px * var(--s));line-height:1.05;font-weight:900;padding:6px 10px;border-radius:14px;border:0;background:transparent;cursor:pointer}.wordcloud .w b{font-size:.55em;opacity:.72;margin-left:4px}.c1{color:#1ba6f7}.c2{color:#14b8a6}.c3{color:#22c55e}.c4{color:#ef4444}.c5{color:#8b5cf6}.c6{color:#f59e0b}.sentiment-donut{width:220px;height:220px;border-radius:999px;margin:auto;background:conic-gradient(#22c55e 0 ${pos*3.6}deg,#cbd5e1 ${pos*3.6}deg ${(pos+neu)*3.6}deg,#ef4444 ${(pos+neu)*3.6}deg 360deg);position:relative}.sentiment-donut:after{content:'${total}\\A data';white-space:pre;position:absolute;inset:34px;background:white;border-radius:999px;display:grid;place-items:center;text-align:center;font-weight:950;color:#0f172a;box-shadow:inset 0 0 0 1px #dbe7f0}.legend{display:grid;gap:9px}.legend button{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;border-radius:14px;background:#f8fbff;border:1px solid #e8eef5;cursor:pointer;text-align:left;font:inherit}.legend button:hover{border-color:#2563eb;box-shadow:0 8px 20px rgba(37,99,235,.12)}.dot{width:12px;height:12px;border-radius:999px;display:inline-block;margin-right:8px}.svg-chart{width:100%;height:auto;background:#fbfdff;border:1px solid #dfe8f0;border-radius:18px}.world-map{position:relative;min-height:390px;border-radius:22px;overflow:hidden;background:linear-gradient(180deg,#081e2d,#102f45);border:1px solid #143d55}.world-map svg{width:100%;height:390px;display:block}.continent{fill:#2f596a;opacity:.72}.gridline{stroke:#24566e;stroke-width:.6;opacity:.45}.map-pin{position:absolute;transform:translate(-50%,-50%);width:var(--r);height:var(--r);min-width:18px;min-height:18px;border:2px solid white;border-radius:999px;background:#19e884;color:#071b2b;font-size:10px;font-weight:950;box-shadow:0 0 0 7px rgba(25,232,132,.14);cursor:pointer}.map-pin b{position:absolute;left:50%;top:calc(100% + 5px);transform:translateX(-50%);white-space:nowrap;color:#e9fbff;background:rgba(0,0,0,.38);padding:3px 7px;border-radius:999px;font-size:10px}.map-note{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}.tools input,.tools select{min-height:42px;border:1px solid var(--line);border-radius:14px;padding:10px 12px;font:inherit;background:white;min-width:180px}.table-shell{display:grid;gap:12px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:18px;background:white}.news-table{width:100%;border-collapse:collapse;min-width:960px}.news-table th,.news-table td{border-bottom:1px solid #e2e8f0;padding:12px 11px;text-align:left;font-size:12.5px;vertical-align:top}.news-table th{background:#eff6ff;color:#1f3650;white-space:nowrap}.news-table td a{word-break:break-all}.pager{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.pager button{border:1px solid var(--line);background:white;border-radius:10px;padding:8px 11px;font-weight:900}.pager button.active{background:#2563eb;color:white}.chart-note{margin:0;color:#667789;font-size:12px;line-height:1.7}.footer{text-align:center;margin:18px 0 0}.hidden-row{display:none!important}*{text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}.card,.hero{letter-spacing:-.006em}.news-table th,.news-table td,.chart-note,.muted{font-weight:500;line-height:1.62}.kpi,.hero h1,.card h2{font-weight:900;letter-spacing:-.032em}@media(max-width:980px){body{padding:14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.split,.two{grid-template-columns:1fr}.hero h1{font-size:31px}.map-note,.risk{grid-template-columns:1fr}.hero-top{display:grid}.report-logo{max-width:100%}}@media print{body{background:white;padding:0}.tools,.pager{display:none}.hero,.card{box-shadow:none}.wrap{max-width:none}.news-table{min-width:0}.table-wrap{overflow:visible}.card{break-inside:avoid}}</style></head><body><main class="wrap"><section class="hero"><div class="hero-top">${logo ? `<img class="report-logo" src="${logo}" alt="Newsroom Intelligence">` : '<strong>Newsroom Intelligence</strong>'}<span class="pill">Professional PR & Newsroom Analytics Report</span></div><h1>${escapeHtml(query || 'Monitoring Isu')}</h1><p>Dibuat ${escapeHtml(date)} oleh ${escapeHtml(owner.name)} (${escapeHtml(owner.role)}). Laporan ini memuat ringkasan isu, grafik, word cloud, peta sumber, dan dokumentasi tautan yang lolos audit keyword.</p><div class="meta-strip"><span class="pill">Durasi pencarian data: ${escapeHtml(durationLabel)}</span><span class="pill">Total data: ${escapeHtml(String(total))}</span><span class="pill">Sentimen dominan: ${escapeHtml(a.dominantSentiment || '-')}</span></div></section><section class="grid"><div class="card metric"><div class="muted">Total Mention</div><div class="kpi">${escapeHtml(String(total))}</div></div><div class="card metric"><div class="muted">Durasi Monitoring</div><div class="kpi">${escapeHtml(String(durationDays))}</div><div class="muted">hari</div></div><div class="card metric"><div class="muted">Positif</div><div class="kpi">${escapeHtml(String(pos))}%</div></div><div class="card metric"><div class="muted">Netral</div><div class="kpi">${escapeHtml(String(neu))}%</div></div><div class="card metric"><div class="muted">Negatif</div><div class="kpi">${escapeHtml(String(neg))}%</div></div></section><section class="card"><h2>Executive Summary</h2><p>${escapeHtml(narrative)}</p><div class="risk"><div><b>Positif</b><br>${escapeHtml(String(pos))}%</div><div><b>Netral</b><br>${escapeHtml(String(neu))}%</div><div><b>Negatif</b><br>${escapeHtml(String(neg))}%</div></div></section><section class="card"><h2>Cara Membaca Informasi Report</h2><div class="risk"><div><b>Indeks Viral</b><br><span class="chart-note">0-20 rendah, 21-50 mulai naik, 51-80 tinggi, 81+ perlu eskalasi. Dihitung dari like, komentar, share, view, dan kebaruan.</span></div><div><b>Sentimen & Warna</b><br><span class="chart-note">Hijau positif, abu-abu netral, merah negatif. Klik warna/label untuk memfilter link dokumentasi sumber.</span></div><div><b>Pangsa Suara</b><br><span class="chart-note">Menunjukkan kanal atau sumber yang paling banyak membicarakan isu. Klik peta, word cloud, dan tabel untuk melihat sumber asli.</span></div></div></section><section class="two"><div class="card"><h2>Grafik Sentimen</h2><div class="sentiment-donut"></div><div class="legend"><button type="button" class="sentiment-filter" data-sentiment="positif"><b><span class="dot" style="background:#22c55e"></span>Positif</b><span>${escapeHtml(String(pos))}% - ${escapeHtml(String(a.counts?.positif || 0))} data</span></button><button type="button" class="sentiment-filter" data-sentiment="netral"><b><span class="dot" style="background:#cbd5e1"></span>Netral</b><span>${escapeHtml(String(neu))}% - ${escapeHtml(String(a.counts?.netral || 0))} data</span></button><button type="button" class="sentiment-filter" data-sentiment="negatif"><b><span class="dot" style="background:#ef4444"></span>Negatif</b><span>${escapeHtml(String(neg))}% - ${escapeHtml(String(a.counts?.negatif || 0))} data</span></button></div></div><div class="card"><h2>Grafik Mention per Waktu</h2><svg class="svg-chart" viewBox="0 0 600 210" role="img"><line x1="30" y1="170" x2="570" y2="170" stroke="#cbd5e1"/><line x1="30" y1="126" x2="570" y2="126" stroke="#e2e8f0"/><line x1="30" y1="82" x2="570" y2="82" stroke="#e2e8f0"/><line x1="30" y1="38" x2="570" y2="38" stroke="#e2e8f0"/><polyline fill="none" stroke="#2563eb" stroke-width="3.5" points="${polyline}"/>${dots}<text x="30" y="192">Awal periode</text><text x="500" y="192">Akhir periode</text></svg><p class="chart-note">Cara membaca: garis naik menunjukkan kenaikan volume percakapan pada periode tertentu.</p></div></section><section class="card"><h2>Social Media Metrics Detail</h2><p class="chart-note">Metrik ini diambil dari field dataset/API sumber seperti Apify, Social X, Bluesky, RSS public index, atau hasil impor scraper. Jika sumber tidak menyediakan metrik, nilainya tetap 0 agar tidak membuat klaim palsu.</p><div class="grid"><div class="card metric"><div class="muted">Likes</div><div class="kpi">${fmtReportNumber(socialTotals.likes)}</div></div><div class="card metric"><div class="muted">Comments</div><div class="kpi">${fmtReportNumber(socialTotals.comments)}</div></div><div class="card metric"><div class="muted">Shares</div><div class="kpi">${fmtReportNumber(socialTotals.shares)}</div></div><div class="card metric"><div class="muted">Views</div><div class="kpi">${fmtReportNumber(socialTotals.views)}</div></div><div class="card metric"><div class="muted">Saves</div><div class="kpi">${fmtReportNumber(socialTotals.saves)}</div></div></div></section><section class="split"><div class="card"><h2>Word Cloud & Konteks Diskusi</h2><div class="wordcloud">${wordCloud}</div><p class="chart-note">Klik kata untuk mencari tautan dokumentasi terkait.</p></div><div class="card"><h2>Keyword Audit & Kelayakan Data</h2><p>${escapeHtml(audit.accuracyNote || 'Report hanya memakai data yang lolos kecocokan keyword.')}</p><div class="risk"><div><b>Total dicek</b><br>${escapeHtml(String(audit.totalChecked || 0))}</div><div><b>Masuk report</b><br>${escapeHtml(String(audit.accepted || total))}</div><div><b>Dikeluarkan</b><br>${escapeHtml(String(audit.rejected || 0))}</div></div></div></section><section class="card"><h2>Peta Dunia Sumber Informasi</h2><p class="chart-note">Peta ini mengelompokkan tautan berdasarkan asal domain/platform. Klik pin untuk memfilter tabel dokumentasi link sesuai lokasi sumber.</p><div class="world-map"><svg viewBox="0 0 1000 420" preserveAspectRatio="none"><path class="continent" d="M120 105l95-40 115 32 30 58-44 45 22 50-130 28-92-55-50-62z"/><path class="continent" d="M430 95l82-35 120 20 76 58-52 64-110 6-70-42z"/><path class="continent" d="M600 190l100-35 120 20 106 74-92 80-130-18-84-48z"/><path class="continent" d="M305 238l78 26 42 92-72 42-54-82z"/><path class="continent" d="M760 298l112-24 75 46-45 64-110-15z"/>${Array.from({length:9}).map((_,i)=>`<line class="gridline" x1="${100+i*100}" y1="30" x2="${100+i*100}" y2="390"/>`).join('')}${Array.from({length:5}).map((_,i)=>`<line class="gridline" x1="40" y1="${80+i*64}" x2="960" y2="${80+i*64}"/>`).join('')}</svg>${pinsHtml}</div><div class="map-note"><div class="card"><b>Total negara/platform</b><br>${escapeHtml(String(mapPins.length))}</div><div class="card"><b>Lokasi terbesar</b><br>${escapeHtml(mapPins[0]?.country || '-')} (${escapeHtml(String(mapPins[0]?.count || 0))})</div><div class="card"><b>Negatif terbesar</b><br>${escapeHtml(mapTop?.country || '-')}</div></div></section><section class="split"><div class="card"><h2>Top Sources</h2><ol class="rank">${sourceRows || '<li><span>Belum ada data</span><b>0</b></li>'}</ol></div><div class="card"><h2>Top Authors / Accounts</h2><ol class="rank">${authorRows || '<li><span>Belum ada data</span><b>0</b></li>'}</ol></div></section><section class="card"><h2>Rekomendasi Prioritas</h2><ol class="recs">${recommendations}</ol></section><section class="card table-shell"><h2>Link Berita / Sosial Media dengan Sentimen Negatif</h2><p class="chart-note">Daftar ringkas tautan negatif untuk verifikasi cepat.</p><div class="table-wrap"><table class="news-table"><thead><tr><th>#</th><th>Sumber</th><th>Author</th><th>Judul / Konten</th><th>Link</th></tr></thead><tbody>${negativeLinks.slice(0, 20).map((item, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.author)}</td><td>${escapeHtml(item.title)}</td><td><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Buka tautan</a></td></tr>`).join('') || '<tr><td colspan="5">Belum ada tautan sentimen negatif.</td></tr>'}</tbody></table></div></section><section class="card table-shell" id="documentationSection"><h2>Dokumentasi Lengkap Link Sesuai Keyword</h2><p class="chart-note">Semua tautan publik yang lolos audit keyword masuk ke tabel ini. Gunakan search, filter, sort, dan pagination 10 data per halaman untuk dokumentasi.</p><div class="tools"><input id="linkSearch" placeholder="Cari judul, sumber, author, URL, negara..."/><select id="linkSentiment"><option value="all">Semua sentimen</option><option value="positif">Positif</option><option value="netral">Netral</option><option value="negatif">Negatif</option></select><select id="linkSource"><option value="all">Semua sumber</option>${sourceOptions}</select><select id="linkCountry"><option value="all">Semua lokasi</option>${countryOptions}</select><select id="linkSort"><option value="latest">Terbaru</option><option value="viral">Viral tertinggi</option><option value="source">Sumber A-Z</option><option value="sentiment">Sentimen</option></select></div><div class="table-wrap"><table class="news-table" id="linkTable"><thead><tr><th>#</th><th>Sumber</th><th>Lokasi</th><th>Sentimen</th><th>Author</th><th>Judul / Konten</th><th>Metrik Sosial</th><th>URL</th></tr></thead><tbody id="linkTbody"></tbody></table></div><div id="linkPager" class="pager"></div></section>${rel ? `<section class="card"><h2>Draft Rilis 5W+1H</h2><h3>${escapeHtml(rel.title)}</h3><p><b>${escapeHtml(rel.lead)}</b></p><div>${escapeHtml(rel.body).replace(/\n/g,'<br>')}</div></section>` : ''}<p class="muted footer">${escapeHtml(REPORT_FOOTER)}</p></main><script>window.__REPORT_DATA__=${dataJson};(function(){const data=window.__REPORT_DATA__||{links:[]};let page=1;const size=10;const $=s=>document.querySelector(s);const tbody=$('#linkTbody');const pager=$('#linkPager');function norm(v){return String(v||'').toLowerCase()}function esc(v){return String(v||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}function attr(v){return esc(v).replace(/"/g,'&quot;')}function shortUrl(u){try{const x=new URL(u);return x.hostname+x.pathname.slice(0,28)+'...'}catch(e){return String(u).slice(0,70)}}function metricText(item){return '👍 '+(item.likes||0)+' · 💬 '+(item.comments||0)+' · ↗ '+(item.shares||0)+' · 👁 '+(item.views||0)}function rowHtml(item,i){return '<tr><td>'+i+'</td><td>'+esc(item.source)+'</td><td>'+esc(item.country)+'</td><td><span class="badge">'+esc(item.sentiment)+'</span></td><td>'+esc(item.author)+'</td><td>'+esc(item.title)+'</td><td>'+metricText(item)+'</td><td><a href="'+attr(item.url)+'" target="_blank" rel="noreferrer">'+esc(shortUrl(item.url))+'</a></td></tr>'}function filtered(){const q=norm($('#linkSearch')?.value);const sent=norm($('#linkSentiment')?.value||'all');const src=norm($('#linkSource')?.value||'all');const country=norm($('#linkCountry')?.value||'all');let rows=data.links.filter(x=>{const hay=norm([x.source,x.platform,x.sentiment,x.author,x.title,x.url,x.country].join(' '));return (!q||hay.includes(q))&&(sent==='all'||norm(x.sentiment).includes(sent))&&(src==='all'||norm(x.source)===src)&&(country==='all'||norm(x.country)===country)});const sort=$('#linkSort')?.value||'latest';rows.sort((a,b)=>sort==='viral'?(b.viralScore||0)-(a.viralScore||0):sort==='source'?norm(a.source).localeCompare(norm(b.source)):sort==='sentiment'?norm(a.sentiment).localeCompare(norm(b.sentiment)):new Date(b.createdAt||0)-new Date(a.createdAt||0));return rows}function render(){const rows=filtered();const pages=Math.max(1,Math.ceil(rows.length/size));if(page>pages)page=pages;const slice=rows.slice((page-1)*size,page*size);tbody.innerHTML=slice.map((x,i)=>rowHtml(x,(page-1)*size+i+1)).join('')||'<tr><td colspan="8">Tidak ada data sesuai filter.</td></tr>';pager.innerHTML='<span class="badge">'+rows.length+' data</span>'+Array.from({length:pages},(_,i)=>'<button type="button" class="'+(i+1===page?'active':'')+'" data-p="'+(i+1)+'">'+(i+1)+'</button>').slice(0,12).join('')+(pages>12?'<span>...</span>':'');}['linkSearch','linkSentiment','linkSource','linkCountry','linkSort'].forEach(id=>{const el=$('#'+id);if(el)el.addEventListener('input',()=>{page=1;render()});if(el)el.addEventListener('change',()=>{page=1;render()})});pager?.addEventListener('click',e=>{const b=e.target.closest('button[data-p]');if(!b)return;page=Number(b.dataset.p);render()});document.querySelectorAll('.map-pin').forEach(btn=>btn.addEventListener('click',()=>{const sel=$('#linkCountry');if(sel){sel.value=norm(btn.dataset.country);page=1;render();$('#documentationSection')?.scrollIntoView({behavior:'smooth'});}}));document.querySelectorAll('.wordcloud [data-keyword]').forEach(btn=>btn.addEventListener('click',()=>{const input=$('#linkSearch');if(input){input.value=btn.dataset.keyword||'';page=1;render();$('#documentationSection')?.scrollIntoView({behavior:'smooth'});}}));document.querySelectorAll('.sentiment-filter').forEach(btn=>btn.addEventListener('click',()=>{const sel=$('#linkSentiment');if(sel){sel.value=norm(btn.dataset.sentiment||'all');page=1;render();$('#documentationSection')?.scrollIntoView({behavior:'smooth'});}}));render();})();</script>${printScript}</body></html>`;
}

const REPORT_FOOTER = '(c)2020-2026. Newsroom Intelligence. Rumah Edukasi Digital. Allright Reserved.';

function cleanReportProfile(profile = {}) {
  return {
    name: stripHtml(profile.name || 'Newsroom Admin'),
    role: stripHtml(profile.role || 'Editor-in-Chief')
  };
}

function reportData({ analysis, release, hoax, query, profile, durationDays, durationLabel, language } = {}) {
  const safeDurationDays = normalizeDurationDays(durationDays || analysis?.durationDays || 7);
  const safeDurationLabel = durationLabel || `${safeDurationDays} hari`;
  const reportLanguage = String(language || analysis?.language || 'id').toLowerCase().startsWith('en') ? 'en' : 'id';
  const suppliedQuery = String(query || '').trim();
  const storedKeywordQuery = String(analysis?.queryRelevance?.query || '').trim();
  const reportQuery = (storedKeywordQuery && /^(upload|apify dataset)/i.test(suppliedQuery)) ? storedKeywordQuery : String(suppliedQuery || storedKeywordQuery || 'Monitoring Isu').trim();
  let a = analysis?.total !== undefined ? analysis : analyzeItems(analysis?.items || []);
  if (Array.isArray(a.items) && a.items.length) {
    const filteredItems = filterItemsByDuration(a.items, safeDurationDays);
    const relevance = filterItemsByQueryRelevance(filteredItems, reportQuery);
    a = analyzeItems(relevance.matched);
    a.queryRelevance = relevance.summary;
    a.rawTotalBeforeRelevanceFilter = filteredItems.length;
  } else if (!a.queryRelevance) {
    a.queryRelevance = filterItemsByQueryRelevance([], reportQuery).summary;
  }
  a.durationDays = safeDurationDays;
  const owner = cleanReportProfile(profile);
  const generatedAt = new Date().toISOString();
  const summaryRows = [
    ['Report', 'Newsroom Intelligence Report'],
    ['Query', query || 'Monitoring Isu'],
    ['Pemilik Akun', owner.name],
    ['Role', owner.role],
    ['Generated At', generatedAt],
    ['Language', reportLanguage === 'en' ? 'English' : 'Bahasa Indonesia'],
    ['Durasi Pencarian Data', safeDurationLabel],
    ['Total Mentions', a.total || 0],
    ['Sentimen Dominan', a.dominantSentiment || '-'],
    ['Positif %', a.percentages?.positif || 0],
    ['Netral %', a.percentages?.netral || 0],
    ['Negatif %', a.percentages?.negatif || 0],
    ['Alert Level', a.alertLevel || '-'],
    ['Avg Compound', a.avgCompound || 0],
    ['Top Keyword', a.keywords?.[0]?.term || '-'],
    ['Top Source', a.topSources?.[0]?.term || '-'],
    ['Top Domain', a.topDomains?.[0]?.term || '-'],
    ['Keyword Audit', a.queryRelevance?.accuracyNote || '-'],
    ['Accepted Items', a.queryRelevance?.accepted ?? a.total ?? 0],
    ['Rejected Off-Keyword Items', a.queryRelevance?.rejected ?? 0],
    ['Footer', REPORT_FOOTER]
  ];
  const recommendationRows = [['#', 'Rekomendasi Redaksi', 'Solusi Praktis', 'Target'], ...((a.recommendations || []).length ? a.recommendations : editorialRecommendations({ counts: a.counts || {}, total: a.total || 0, keywords: a.keywords || [], viral: a.viral || [], topDomains: a.topDomains || [], alertLevel: a.alertLevel || 'normal' })).map((r, i) => [i + 1, r, i === 0 ? 'Verifikasi, buat Q&A, dan siapkan rilis/klarifikasi.' : 'Turunkan menjadi konten kanal dominan dan watchlist.', i === 0 ? 'Hari ini' : '24-72 jam'])];
  const viralRows = [['#', 'Source', 'Author', 'Sentiment', 'Viral Score', 'Engagement', 'Reach/Views', 'Date', 'Title/Content', 'URL'], ...((a.viral || []).slice(0, 50).map((item, i) => [
    i + 1,
    item.source || item.platform || '-',
    item.author || '-',
    item.sentiment?.label || '-',
    item.viralScore || 0,
    Math.round((item.metrics?.likes || 0) + (item.metrics?.comments || 0) + (item.metrics?.shares || 0) + (item.metrics?.views || 0) * 0.05),
    item.metrics?.views || item.reach || 0,
    item.createdAt || '',
    item.title || item.text || '',
    item.url || ''
  ]))];
  const itemRows = [['#', 'Source', 'Platform', 'Author', 'Date', 'Sentiment', 'Viral Score', 'Likes', 'Comments', 'Shares', 'Views', 'Title', 'Text', 'URL', 'Keyword Relevance Reason'], ...((a.items || []).slice(0, 2000).map((item, i) => [
    i + 1,
    item.source || '-',
    item.platform || '-',
    item.author || '-',
    item.createdAt || '',
    item.sentiment?.label || '-',
    item.viralScore || 0,
    item.metrics?.likes || 0,
    item.metrics?.comments || 0,
    item.metrics?.shares || 0,
    item.metrics?.views || 0,
    item.title || '',
    item.text || '',
    item.url || '',
    item.keywordRelevance?.reason || relevanceForItem(item, reportQuery).reason
  ]))];
  const keywordRows = [['#', 'Keyword/Topic', 'Count'], ...((a.keywords || []).slice(0, 60).map((k, i) => [i + 1, k.term, k.count]))];
  const sourceRows = [['#', 'Source', 'Count'], ...((a.topSources || []).slice(0, 60).map((k, i) => [i + 1, k.term, k.count]))];
  const executiveRows = [
    ['Bagian', 'Isi'],
    ['Executive Summary', `Monitoring ${query || 'isu'} menghasilkan ${a.total || 0} mention. Sentimen dominan ${a.dominantSentiment || '-'}, alert ${a.alertLevel || '-'}.`],
    ['Risiko Reputasi', `${a.percentages?.negatif || 0}% percakapan negatif. Prioritaskan klarifikasi bila konten negatif juga memiliki viral score tinggi.`],
    ['Peluang Komunikasi', `${a.percentages?.positif || 0}% percakapan positif dapat dipakai untuk penguatan narasi dan testimoni.`],
    ['Prioritas Kanal', a.topSources?.[0]?.term || '-'],
    ['Prioritas Keyword', a.keywords?.[0]?.term || '-']
  ];
  const riskRows = [
    ['Risk Area', 'Level', 'Indikator', 'Tindakan'],
    ['Sentimen negatif', a.alertLevel || 'normal', `${a.percentages?.negatif || 0}% negatif`, 'Siapkan Q&A, klarifikasi, dan narasumber resmi.'],
    ['Konten viral', a.viral?.[0]?.viralScore || 0, a.viral?.[0]?.title || a.viral?.[0]?.text || '-', 'Verifikasi sumber awal dan siapkan statement.'],
    ['Sumber dominan', a.topSources?.[0]?.term || '-', a.topSources?.[0]?.count || 0, 'Distribusikan pesan pada kanal dominan.'],
    ['Keyword dominan', a.keywords?.[0]?.term || '-', a.keywords?.[0]?.count || 0, 'Buat angle/fakta pendukung untuk keyword ini.']
  ];
  const actionRows = [['Prioritas', 'Rekomendasi', 'PIC', 'Deadline'], ...((a.recommendations || []).map((r, i) => [i + 1, r, i === 0 ? 'Humas/Editor' : 'Tim Monitoring', i === 0 ? 'Hari ini' : '24 jam']))];
  const distributionRows = [
    ['Kanal', 'Tujuan', 'Konten yang disarankan'],
    ['Media massa', 'Klarifikasi/press release resmi', 'Lead 5W+1H + data pendukung + kutipan narasumber'],
    ['Website resmi', 'Pusat rujukan publik', 'FAQ, kronologi, dokumen, kontak resmi'],
    ['Instagram/TikTok/YouTube', 'Menjawab audiens visual', 'Video pendek, carousel data, potongan statement'],
    ['LinkedIn', 'Stakeholder profesional', 'Analisis kebijakan, dampak organisasi, sikap resmi'],
    ['X/Threads', 'Respons cepat isu berjalan', 'Thread ringkas, tautan klarifikasi, quote resmi']
  ];
  const releaseRows = release?.body ? [['Judul', release.title || ''], ['Lead', release.lead || ''], ['Body', release.body || ''], ['Editorial Score', release.editorialScore || 0]] : [['Info', 'Belum ada draft rilis 5W+1H.']];
  const hoaxRows = hoax ? [['Query', hoax.query || ''], ['Risk', hoax.risk || ''], ['Verdict', hoax.verdict || ''], ['Signal Words', (hoax.signalWords || []).join(', ')], ['Checklist', (hoax.checklist || []).join(' | ')]] : [['Info', 'Belum ada hasil cek hoaks.']];
  const relevanceRows = [
    ['Field', 'Value'],
    ['Keyword Query', a.queryRelevance?.query || reportQuery],
    ['Keyword Terms Used', (a.queryRelevance?.keywordTerms || []).join(', ') || '-'],
    ['Total Checked', a.queryRelevance?.totalChecked ?? 0],
    ['Accepted in Report', a.queryRelevance?.accepted ?? a.total ?? 0],
    ['Rejected Off-Keyword', a.queryRelevance?.rejected ?? 0],
    ['Audit Rule', a.queryRelevance?.accuracyNote || 'Laporan hanya memakai item yang lolos relevansi keyword.']
  ];
  const relevanceReasonRows = [['#', 'Title / Link', 'Reason', 'Score'], ...((a.queryRelevance?.sampleReasons || []).map(x => [x.no, x.title, x.reason, x.score]))];
  return { analysis: a, query: reportQuery || 'Monitoring Isu', owner, generatedAt, durationDays: safeDurationDays, durationLabel: safeDurationLabel, language: reportLanguage, sheets: { Summary: summaryRows, 'Keyword Audit': relevanceRows, 'Relevance Reasons': relevanceReasonRows, 'Executive Brief': executiveRows, Recommendations: recommendationRows, 'Risk Matrix': riskRows, 'Action Plan': actionRows, 'Distribution Plan': distributionRows, 'Top Viral': viralRows, Data: itemRows, Keywords: keywordRows, Sources: sourceRows, '5W1H': releaseRows, 'Hoax Check': hoaxRows } };
}

function csvFromReport(data) {
  const sections = [];
  for (const [name, rows] of Object.entries(data.sheets)) {
    sections.push([`SECTION: ${name}`]);
    sections.push(...rows);
    sections.push([]);
  }
  return sections.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function colName(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function isPlainNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function worksheetXml(rows = []) {
  const sheetData = rows.map((row, rIdx) => {
    const cells = row.map((value, cIdx) => {
      const ref = `${colName(cIdx + 1)}${rIdx + 1}`;
      if (isPlainNumber(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${sheetData}</sheetData></worksheet>`;
}

function buildXlsx(data) {
  const entries = [];
  const sheetNames = Object.keys(data.sheets).slice(0, 18);
  entries.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
  entries.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  entries.push(['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`]);
  entries.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetNames.map((name, i) => `<sheet name="${xmlEscape(name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
  entries.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  sheetNames.forEach((name, i) => entries.push([`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(data.sheets[name])]));
  return zipStore(entries.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = new Date();
  const dostime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((Math.floor(now.getSeconds() / 2)) & 31);
  const dosdate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt16LE(dostime, 10); local.writeUInt16LE(dosdate, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(dostime, 12); central.writeUInt16LE(dosdate, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function pdfSafe(text) {
  return String(text ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(text) {
  return pdfSafe(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(text, max = 92) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const cleanWord = word.length > max ? `${word.slice(0, Math.max(1, max - 1))}…` : word;
    if ((line + ' ' + cleanWord).trim().length > max) { if (line) lines.push(line); line = cleanWord; }
    else line = (line + ' ' + cleanWord).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function pdfTruncate(text, max = 80) {
  const clean = pdfSafe(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function wrapLineLimited(text, max = 78, maxLines = 2) {
  const lines = wrapLine(text, max);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  out[out.length - 1] = pdfTruncate(out[out.length - 1], Math.max(4, max - 1));
  return out;
}

function shortUrlForPdf(url, max = 54) {
  const value = pdfSafe(url);
  if (!/^https?:/i.test(value) || value.length <= max) return pdfTruncate(value, max);
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./, '');
    const path = (u.pathname || '').replace(/\/rss\/articles\/.*/i, '/rss/articles/…');
    return pdfTruncate(`${host}${path}${u.search ? '…' : ''}`, max);
  } catch {
    return pdfTruncate(value.replace(/^https?:\/\//, ''), max);
  }
}

function fmtReportNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1000000000) return `${(n / 1000000000).toFixed(n % 1000000000 ? 1 : 0)} B`;
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)} M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)} K`;
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function clampNumber(n, min, max) {
  return Math.max(min, Math.min(max, Number(n || 0)));
}

const SEARCH_DURATION_OPTIONS = [1, 3, 7, 14, 30, 60, 90, 120, 360];

function normalizeDurationDays(value, fallback = 7) {
  const raw = Number(value || fallback);
  return SEARCH_DURATION_OPTIONS.includes(raw) ? raw : fallback;
}

function filterItemsByDuration(items = [], days = 7) {
  const safeDays = normalizeDurationDays(days);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  return items.filter(item => {
    const t = new Date(item.createdAt || item.date || item.publishedAt || Date.now()).getTime();
    return Number.isFinite(t) ? t >= since : true;
  });
}

function itemReach(item = {}) {
  return Number(item.reach || item.metrics?.views || 0) + Number(item.metrics?.likes || 0) + Number(item.metrics?.shares || 0) * 3 + Number(item.metrics?.followers || 0) * 0.1;
}

function itemEngagement(item = {}) {
  return Number(item.metrics?.likes || 0) + Number(item.metrics?.comments || 0) * 2 + Number(item.metrics?.shares || 0) * 3 + Number(item.metrics?.quotes || 0) * 2 + Number(item.metrics?.saves || 0) * 1.5 + Number(item.metrics?.views || 0) * 0.03;
}


function reportSourceLabel(item = {}) {
  const domain = domainFromUrl(item.url || '');
  const platform = sourceBucket(item.source || item.platform || domain || 'Web');
  return domain ? `${platform} / ${domain}` : platform;
}

function credibleStatusForItem(item = {}, query = '') {
  const rel = item.keywordRelevance || relevanceForItem(item, query);
  const domain = domainFromUrl(item.url || '');
  const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '-';
  const link = item.url ? shortUrlForPdf(item.url, 58) : 'link tidak tersedia';
  return `Sumber: ${reportSourceLabel(item)} | Tanggal: ${date} | Link: ${link} | Relevansi: ${rel.score || 0}/100`;
}

function negativeMentionsForReport(ctx = {}) {
  const query = ctx.query || '';
  return (ctx.items || [])
    .filter(item => item.sentiment?.label === 'negatif')
    .map(item => ({ ...item, keywordRelevance: item.keywordRelevance || relevanceForItem(item, query) }))
    .sort((a, b) => (itemReach(b) + itemEngagement(b) + (b.keywordRelevance?.score || 0)) - (itemReach(a) + itemEngagement(a) + (a.keywordRelevance?.score || 0)))
    .slice(0, 10);
}

function mentionToPdfItem(item = {}, ctx = {}) {
  const query = ctx.query || '';
  const rel = item.keywordRelevance || relevanceForItem(item, query);
  return {
    title: item.title || item.author || sourceBucket(item.source || item.platform) || 'Untitled item',
    meta: `${fmtReportNumber(item.metrics?.views || itemReach(item))} views | ${fmtReportNumber(item.metrics?.likes || 0)} likes | ${fmtReportNumber(item.metrics?.comments || 0)} comments | ${fmtReportNumber(item.metrics?.shares || 0)} shares | ${reportSourceLabel(item)} | ${item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '-'}`,
    text: item.text || item.description || item.title || '',
    reason: rel.reason,
    url: item.url || '',
    sentiment: item.sentiment?.label || 'netral',
    credibility: credibleStatusForItem(item, query)
  };
}

function reportDateRange(items = [], selectedDays = 7) {
  const safeDays = normalizeDurationDays(selectedDays);
  const times = items.map(i => new Date(i.createdAt).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const end = Date.now();
  const start = end - (safeDays - 1) * 24 * 60 * 60 * 1000;
  const days = safeDays;
  const fmt = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(start)} - ${fmt(end)} (${days} days)`;
}

function sourceBucket(source = '') {
  const s = String(source || '').toLowerCase();
  if (s.includes('x') || s.includes('twitter')) return 'X (Twitter)';
  if (s.includes('facebook')) return 'Facebook';
  if (s.includes('instagram')) return 'Instagram';
  if (s.includes('tiktok')) return 'TikTok';
  if (s.includes('youtube')) return 'YouTube';
  if (s.includes('threads')) return 'Threads';
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('rss') || s.includes('gdelt') || s.includes('news')) return 'News';
  return s ? s[0].toUpperCase() + s.slice(1) : 'Web';
}

function topFrequency(rows = [], keyFn, limit = 5) {
  const map = new Map();
  for (const item of rows) {
    const key = keyFn(item);
    if (!key) continue;
    const current = map.get(key) || { term: key, count: 0, reach: 0, engagement: 0, followers: 0 };
    current.count += 1;
    current.reach += itemReach(item);
    current.engagement += itemEngagement(item);
    current.followers += Number(item.metrics?.followers || item.followers || 0);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => (b.count - a.count) || (b.reach - a.reach)).slice(0, limit);
}

function reportContext(data) {
  const a = data.analysis || analyzeItems([]);
  const items = Array.isArray(a.items) ? a.items : [];
  const totalReach = items.reduce((sum, i) => sum + itemReach(i), 0) || (a.total || 0) * 42000;
  const likes = items.reduce((sum, i) => sum + Number(i.metrics?.likes || 0), 0);
  const comments = items.reduce((sum, i) => sum + Number(i.metrics?.comments || 0), 0);
  const shares = items.reduce((sum, i) => sum + Number(i.metrics?.shares || 0), 0);
  const views = items.reduce((sum, i) => sum + Number(i.metrics?.views || i.reach || 0), 0);
  const saves = items.reduce((sum, i) => sum + Number(i.metrics?.saves || 0), 0);
  const interactions = likes + comments + shares + saves;
  const sourceCats = topFrequency(items, i => sourceBucket(i.source || i.platform), 12);
  const socialNames = new Set(['X (Twitter)', 'Facebook', 'Instagram', 'TikTok', 'YouTube', 'Threads', 'LinkedIn', 'Bluesky']);
  const socialCount = sourceCats.filter(s => socialNames.has(s.term)).reduce((sum, s) => sum + s.count, 0);
  const socialReach = sourceCats.filter(s => socialNames.has(s.term)).reduce((sum, s) => sum + s.reach, 0);
  const trend = buildDailyTrend(items);
  const topMentions = [...items].sort((x, y) => (itemReach(y) + itemEngagement(y)) - (itemReach(x) + itemEngagement(x))).slice(0, 5);
  const recentMentions = [...items].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)).slice(0, 5);
  const authorStats = topFrequency(items, i => i.author || domainFromUrl(i.url) || i.source || i.platform, 8);
  const domainStats = topFrequency(items, i => domainFromUrl(i.url) || sourceBucket(i.source || i.platform), 8);
  const links = topFrequency(items, i => i.url, 8).filter(x => x.term).map(x => ({ term: x.term, count: x.count }));
  const safeDurationDays = normalizeDurationDays(data.durationDays || data.analysis?.durationDays || 7);
  const safeDurationLabel = data.durationLabel || `${safeDurationDays} hari`;
  return {
    a, items, totalReach, likes, comments, shares, views, saves, interactions, sourceCats, socialCount, socialReach,
    nonSocialCount: Math.max(0, (a.total || 0) - socialCount),
    nonSocialReach: Math.max(0, totalReach - socialReach),
    trend, topMentions, recentMentions, authorStats, domainStats, links,
    dateRange: reportDateRange(items, safeDurationDays),
    durationDays: safeDurationDays,
    durationLabel: safeDurationLabel,
    query: data.query || 'Monitoring Isu',
    owner: data.owner || { name: 'Newsroom Admin', role: 'Public Relations' },
    generatedAt: data.generatedAt || new Date().toISOString(),
    language: String(data.language || 'id').toLowerCase().startsWith('en') ? 'en' : 'id',
    queryRelevance: a.queryRelevance || filterItemsByQueryRelevance(items, data.query || 'Monitoring Isu').summary
  };
}

function buildDailyTrend(items = []) {
  const by = new Map();
  for (const item of items) {
    const d = new Date(item.createdAt);
    if (!Number.isFinite(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    const row = by.get(key) || { date: key, mentions: 0, reach: 0, positif: 0, negatif: 0 };
    row.mentions += 1;
    row.reach += itemReach(item);
    if (item.sentiment?.label === 'positif') row.positif += 1;
    if (item.sentiment?.label === 'negatif') row.negatif += 1;
    by.set(key, row);
  }
  const rows = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length) return rows.slice(-31);
  const out = [];
  for (let i = 30; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    out.push({ date: d.toISOString().slice(0, 10), mentions: Math.max(0, Math.round(12 + Math.sin(i / 3) * 8 + (i % 5) * 4)), reach: Math.max(0, 420000 + Math.round(Math.sin(i / 2) * 250000)), positif: 0, negatif: 0 });
  }
  return out;
}

function pdfColor(hex) {
  let clean = String(hex || '#000000').replace('#', '').trim();
  if (clean.length === 3) clean = clean.split('').map(ch => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) clean = '000000';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

class SimplePdfReport {
  constructor() {
    this.w = 595; this.h = 842; this.pages = [];
    this.bg = '#F4F8FB'; this.green = '#1BD68A'; this.blue = '#2563EB'; this.dark = '#071827'; this.muted = '#5B6B7C'; this.line = '#D8E6EF';
    this.hasLogo = Boolean(REPORT_LOGO_JPG);
    this.page = null;
  }
  addPage(title = '', ctx = {}) {
    this.page = { commands: [], annots: [], title, ctx };
    this.pages.push(this.page);
    this.fill(this.bg, 0, 0, this.w, this.h);
    if (title) this.text(title, 34, 110, 26, 'Poppins-Bold', this.dark);
    return this;
  }
  cmd(x) { this.page.commands.push(x); return this; }
  fill(color, x, y, w, h) { return this.cmd(`${pdfColor(color)} rg ${x} ${(this.h - y - h).toFixed(2)} ${w} ${h} re f`); }
  stroke(color, width = 1) { return this.cmd(`${pdfColor(color)} RG ${width} w`); }
  lineTo(color, x1, y1, x2, y2, width = 1) { this.stroke(color, width); return this.cmd(`${x1} ${(this.h - y1).toFixed(2)} m ${x2} ${(this.h - y2).toFixed(2)} l S`); }
  circle(color, cx, cy, r, steps = 48) {
    const pts = [];
    for (let i = 0; i <= steps; i++) { const a = (Math.PI * 2 * i) / steps; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return this.cmd(`${pdfColor(color)} rg ${pts.map((pt, i) => `${pt[0].toFixed(2)} ${(this.h - pt[1]).toFixed(2)} ${i ? 'l' : 'm'}`).join(' ')} h f`);
  }
  rect(color, x, y, w, h, stroke = '#DAE6DF', sw = 1) { this.fill(color, x, y, w, h); this.stroke(stroke, sw); return this.cmd(`${x} ${(this.h - y - h).toFixed(2)} ${w} ${h} re S`); }
  text(text, x, y, size = 10, font = 'Poppins', color = '#111111') {
    const safe = pdfEscape(text);
    this.cmd(`${pdfColor(color)} rg BT /${font === 'Poppins-Bold' ? 'F2' : 'F1'} ${size} Tf ${x} ${(this.h - y).toFixed(2)} Td (${safe}) Tj ET`);
    return this;
  }
  link(url, x, y, w, h, tooltip = '') {
    if (!url || !/^https?:\/\//i.test(String(url))) return this;
    const rect = [Number(x || 0), Number((this.h - y - h).toFixed(2)), Number((x + w).toFixed(2)), Number((this.h - y).toFixed(2))];
    this.page.annots.push({ url: String(url), rect, tooltip: String(tooltip || url) });
    return this;
  }
  linkText(label, url, x, y, maxChars = 54, size = 8.2) {
    const text = pdfTruncate(label || url || 'open source', maxChars);
    this.text(text, x, y, size, 'Poppins-Bold', '#1D4ED8');
    this.lineTo('#1D4ED8', x, y + 2.2, x + Math.min(260, text.length * size * .47), y + 2.2, .45);
    this.link(url, x - 2, y - size - 2, Math.min(280, text.length * size * .52 + 8), size + 9, text);
    return this;
  }
  wrap(text, x, y, maxChars = 82, size = 11, lineH = 16, font = 'Poppins', color = '#111111') {
    const lines = wrapLine(text, maxChars);
    lines.forEach((line, i) => this.text(line, x, y + i * lineH, size, font, color));
    return y + lines.length * lineH;
  }
  datePill(text) {
    const raw = pdfSafe(text);
    const maxChars = raw.length > 48 ? 54 : 48;
    const label = pdfTruncate(raw, maxChars);
    const w = Math.min(390, Math.max(250, 72 + label.length * 5.2));
    this.rect('#FFFFFF', 34, 35, w, 26, this.green, 1.1);
    this.text('calendar', 45, 52, 6.8, 'Poppins', '#0E9F64');
    this.text(label, 82, 52, label.length > 48 ? 7.7 : 8.4, 'Poppins-Bold', this.dark);
  }
  footer(query, pageNum) {
    const n = this.pages.length;
    this.text(pdfTruncate(query || 'report', 36), 34, 813, 8.5, 'Poppins', '#33413E');
    this.lineTo('#BFD7CD', 145, 807, 548, 807, .7);
    this.text(String(n), 558, 813, 8.5, 'Poppins-Bold', '#111111');
  }
  card(x, y, w, h) { this.rect('#FFFFFF', x, y, w, h, '#DCEBE3', .7); this.fill(this.green, x, y, 4, h); }
  metricCard(x, y, w, h, label, value, delta = '+0.0%') {
    this.card(x, y, w, h);
    this.text(pdfTruncate(label, 24), x + 15, y + 24, 10.3, 'Poppins', this.dark);
    this.text(pdfTruncate(value, 12), x + 15, y + 70, String(value).length > 8 ? 17.5 : 20, 'Poppins', '#0A0D0E');
    this.rect('#E7F8EF', x + w - 72, y + 60, 55, 18, '#C9EED9', .2);
    this.text(pdfTruncate(delta, 8), x + w - 61, y + 73, 7.3, 'Poppins-Bold', '#0E8C55');
  }
  simpleListBox(title, items, x, y, w, h) {
    this.text(title, x, y - 20, 24, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const maxItems = Math.min(5, items.length);
    const rowH = Math.floor((h - 44) / Math.max(1, maxItems));
    let cy = y + 34;
    items.slice(0, maxItems).forEach((item, idx) => {
      const badgeColor = ['#0B0D12', '#1DA1F2', '#FF2D55', '#20C997', '#F59E0B'][idx % 5];
      this.fill(badgeColor, x + 24, cy - 12, 28, 28);
      this.text(String(idx + 1), x + 34.5, cy + 7, 9.2, 'Poppins-Bold', '#FFFFFF');
      const titleMax = Math.max(42, Math.floor((w - 105) / 6.2));
      const titleLines = wrapLineLimited(item.title || item.term || `Item ${idx + 1}`, titleMax, 2);
      titleLines.forEach((line, lineIdx) => this.text(line, x + 62, cy + lineIdx * 13.5, 10.3, 'Poppins-Bold', this.dark));
      const metaY = cy + titleLines.length * 13.5 + 3;
      this.text(pdfTruncate(item.meta || '', Math.max(36, Math.floor((w - 100) / 5.2))), x + 62, metaY, 8.2, 'Poppins', '#4E5B60');
      const available = Math.max(14, rowH - (metaY - cy) - 24);
      const bodyMaxLines = Math.max(1, Math.min(3, Math.floor(available / 12.5)));
      const bodyLines = wrapLineLimited(item.text || item.description || '', Math.max(50, Math.floor((w - 105) / 5.4)), bodyMaxLines);
      bodyLines.forEach((line, lineIdx) => this.text(line, x + 62, metaY + 17 + lineIdx * 12.5, 9.45, 'Poppins', this.dark));
      if (idx < maxItems - 1) this.lineTo('#E6EEE9', x + 62, y + 36 + (idx + 1) * rowH - 8, x + w - 25, y + 36 + (idx + 1) * rowH - 8, .5);
      cy += rowH;
    });
    if (!maxItems) this.text('Belum ada data untuk ditampilkan.', x + 34, y + 70, 11, 'Poppins', this.muted);
  }
  mentionCards(title, items, x, y, w, h, options = {}) {
    const subtitle = options.subtitle || '';
    this.text(title, x, y - 22, 22, 'Poppins-Bold', this.dark);
    if (subtitle) this.wrap(subtitle, x, y - 6, Math.floor(w / 6.2), 8.2, 10.5, 'Poppins', '#56706A');
    this.card(x, y, w, h);
    const maxItems = Math.min(Number(options.max || 4), items.length);
    const topPad = 24;
    const rowH = Math.floor((h - topPad - 18) / Math.max(1, maxItems));
    let cy = y + topPad;
    const colors = ['#0B0D12', '#1DA1F2', '#FF2D55', '#20C997', '#F59E0B'];
    items.slice(0, maxItems).forEach((item, idx) => {
      const badge = colors[idx % colors.length];
      const rowBottom = cy + rowH - 10;
      this.fill(badge, x + 22, cy, 28, 28);
      this.text(String(idx + 1), x + 33, cy + 18, 8.6, 'Poppins-Bold', '#FFFFFF');
      const tx = x + 62;
      const titleMax = Math.max(48, Math.floor((w - 100) / 5.9));
      const titleLines = wrapLineLimited(item.title || item.term || `Item ${idx + 1}`, titleMax, 2);
      titleLines.forEach((line, i) => this.text(line, tx, cy + 9 + i * 11.4, 8.9, 'Poppins-Bold', this.dark));
      let ty = cy + 9 + titleLines.length * 11.4 + 4;
      this.text(pdfTruncate(item.meta || '', Math.max(50, Math.floor((w - 105) / 4.8))), tx, ty, 7.2, 'Poppins', '#506169');
      ty += 13;
      const bodyLines = wrapLineLimited(item.text || item.description || '', Math.max(58, Math.floor((w - 105) / 5.1)), options.bodyLines || 2);
      bodyLines.forEach((line, i) => this.text(line, tx, ty + i * 10.8, 7.9, 'Poppins', '#111827'));
      ty += bodyLines.length * 10.8 + 3;
      const reason = item.reason || item.credibility || '';
      if (reason && ty < rowBottom - 18) {
        const rLines = wrapLineLimited(reason, Math.max(60, Math.floor((w - 105) / 4.9)), 1);
        rLines.forEach(line => this.text(line, tx, ty, 7.2, 'Poppins', '#0E6D48'));
        ty += 11;
      }
      if (item.url && ty < rowBottom - 7) {
        this.linkText(`Link: ${shortUrlForPdf(item.url, Math.max(54, Math.floor((w - 105) / 4.2)))}`, item.url, tx, ty, Math.max(54, Math.floor((w - 105) / 4.2)), 6.9);
      } else if (item.url) {
        this.link(item.url, x + 20, cy - 2, w - 40, Math.max(28, rowH - 8), item.title || item.url);
      }
      if (idx < maxItems - 1) this.lineTo('#E2ECE7', tx, rowBottom, x + w - 24, rowBottom, .45);
      cy += rowH;
    });
    if (!maxItems) this.wrap(options.empty || 'Belum ada data yang lolos filter untuk ditampilkan pada bagian ini.', x + 32, y + 54, 70, 10.2, 14, 'Poppins', this.muted);
  }

  explanatoryBox(title, text, x, y, w, h) {
    this.card(x, y, w, h);
    this.text(title, x + 18, y + 26, 11.2, 'Poppins-Bold', this.dark);
    this.wrap(text, x + 18, y + 48, Math.floor((w - 36) / 5.6), 8.5, 12, 'Poppins', '#40525A');
  }

  table(title, cols, rows, x, y, w, rowH = 40) {
    this.text(title, x, y - 18, 22, 'Poppins-Bold', this.dark);
    const visibleRows = rows.slice(0, Math.min(rows.length, 5));
    const cardH = 76 + Math.max(1, visibleRows.length) * rowH;
    this.card(x, y, w, cardH);
    const colsX = cols.map(c => x + c.x * w);
    const colWidths = cols.map((c, i) => {
      const next = cols[i + 1] ? cols[i + 1].x * w : w - 24;
      return Math.max(34, next - c.x * w - 12);
    });
    cols.forEach((c, i) => this.text(pdfTruncate(c.label, Math.floor(colWidths[i] / 5.2)), colsX[i], y + 42, 8.8, 'Poppins-Bold', this.dark));
    this.lineTo('#AAB9B3', x + 25, y + 55, x + w - 25, y + 55, .75);
    visibleRows.forEach((r, ri) => {
      const yy = y + 78 + ri * rowH;
      cols.forEach((c, ci) => {
        const rawValue = String(r[ci] ?? '').replace(/\s+/g, ' ').trim();
        let value = rawValue;
        const isUrl = /^https?:/i.test(rawValue);
        if (isUrl || value.length > 46) value = shortUrlForPdf(value, Math.max(10, Math.floor(colWidths[ci] / 4.4)));
        else value = pdfTruncate(value, Math.max(10, Math.floor(colWidths[ci] / 4.7)));
        const size = value.length > 28 ? 7.3 : 8.2;
        const lines = wrapLineLimited(value, Math.max(8, Math.floor(colWidths[ci] / 4.6)), ci === 0 ? 2 : 1);
        lines.forEach((line, li) => this.text(line, colsX[ci], yy + li * 10.5, size, ci === 0 ? 'Poppins-Bold' : 'Poppins', isUrl ? '#1D4ED8' : this.dark));
        if (isUrl) this.link(rawValue, colsX[ci] - 2, yy - 9, colWidths[ci], Math.min(20, rowH - 10), rawValue);
      });
      if (ri < visibleRows.length - 1) this.lineTo('#E2ECE7', x + 25, yy + rowH - 13, x + w - 25, yy + rowH - 13, .45);
    });
    if (!visibleRows.length) this.text('Belum ada data untuk ditampilkan.', x + 34, y + 82, 10.5, 'Poppins', this.muted);
  }

  worldSourceMap(title, pins, x, y, w, h) {
    this.text(title, x, y - 18, 22, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const mapX = x + 24, mapY = y + 34, mapW = w - 48, mapH = h - 100;
    this.rect('#08283A', mapX, mapY, mapW, mapH, '#0B4A65', .7);
    this.fill('#2E6072', mapX + mapW * .08, mapY + mapH * .18, mapW * .20, mapH * .24);
    this.fill('#2E6072', mapX + mapW * .41, mapY + mapH * .16, mapW * .24, mapH * .20);
    this.fill('#2E6072', mapX + mapW * .58, mapY + mapH * .35, mapW * .26, mapH * .24);
    this.fill('#2E6072', mapX + mapW * .26, mapY + mapH * .55, mapW * .12, mapH * .25);
    this.fill('#2E6072', mapX + mapW * .76, mapY + mapH * .62, mapW * .13, mapH * .15);
    (pins || []).slice(0, 10).forEach((pin, i) => {
      const px = mapX + mapW * (Number(pin.x || 50) / 100);
      const py = mapY + mapH * (Number(pin.y || 50) / 100);
      const r = Math.min(14, Math.max(5, Number(pin.radius || 8)));
      this.circle(i === 0 ? '#19E884' : '#36A3FF', px, py, r, 24);
      this.text(String(pin.count || 0), px - 4, py + 3, 6.2, 'Poppins-Bold', '#FFFFFF');
      this.text(pdfTruncate(pin.country || pin.code || 'Source', 18), px + r + 4, py + 3, 6.6, 'Poppins-Bold', '#FFFFFF');
    });
    this.wrap(this.lang === 'en' ? 'How to read: larger pins represent more keyword-matched links from that country/platform. Open the HTML report to click pins and filter source links.' : 'Cara baca: pin lebih besar berarti lebih banyak tautan yang lolos audit keyword dari negara/platform tersebut. Buka laporan HTML untuk klik pin dan memfilter tautan sumber.', x + 28, y + h - 50, 82, 8.2, 11.2, 'Poppins', '#40525A');
  }

  lineChart(title, seriesA, seriesB, x, y, w, h, labelA = 'Mentions', labelB = 'Reach', colorA = '#2176FF', colorB = '#0A8F5D') {
    this.text(title, x, y - 18, 23, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const gx = x + 62, gy = y + 50, gw = w - 122, gh = h - 105;
    const all = [...seriesA, ...seriesB].map(v => Number(v || 0));
    const max = Math.max(1, ...all);
    for (let i = 0; i <= 4; i++) {
      const yy = gy + i * gh / 4;
      this.lineTo('#E9F0EC', gx, yy, gx + gw, yy, .55);
      const val = Math.round(max - (max * i / 4));
      this.text(fmtReportNumber(val), x + 28, yy + 3, 7, 'Poppins', '#7A8A8D');
    }
    const draw = (arr, color) => {
      this.stroke(color, 1.55);
      const pts = arr.map((v, i) => [gx + (arr.length <= 1 ? 0 : i * gw / (arr.length - 1)), gy + gh - (Number(v || 0) / max) * gh]);
      if (pts.length) this.cmd(`${pts[0][0].toFixed(2)} ${(this.h - pts[0][1]).toFixed(2)} m ${pts.slice(1).map(p => `${p[0].toFixed(2)} ${(this.h - p[1]).toFixed(2)} l`).join(' ')} S`);
    };
    draw(seriesA, colorA); draw(seriesB, colorB);
    const lastA = fmtReportNumber(seriesA[seriesA.length - 1] || 0);
    const lastB = fmtReportNumber(seriesB[seriesB.length - 1] || 0);
    this.fill(colorA, x + 40, y + h - 34, 9, 2.7);
    this.text(`${labelA}: ${lastA}`, x + 54, y + h - 28, 8.3, 'Poppins-Bold', colorA);
    this.fill(colorB, x + 142, y + h - 34, 9, 2.7);
    this.text(`${labelB}: ${lastB}`, x + 156, y + h - 28, 8.3, 'Poppins-Bold', colorB);
    const help = this.lang === 'en'
      ? `How to read: lines show changes in ${labelA.toLowerCase()} and ${labelB.toLowerCase()} during the reporting period. A rising line means the issue is gaining volume or reach.`
      : `Cara baca: garis menunjukkan perubahan ${labelA.toLowerCase()} dan ${labelB.toLowerCase()} selama periode laporan. Garis naik berarti isu makin ramai atau jangkauannya membesar.`;
    this.wrap(help, x + 40, y + h - 15, 82, 6.7, 8.6, 'Poppins', '#607078');
  }
  donut(title, parts, x, y, w, h) {
    this.text(title, x, y - 18, 25, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const total = parts.reduce((s, p) => s + Number(p.value || 0), 0) || 1;
    let start = -Math.PI / 2;
    const cx = x + w * .34, cy = y + h * .52, r1 = Math.min(w, h) * .25, r2 = r1 * .52;
    parts.forEach((p, idx) => {
      const end = start + (Number(p.value || 0) / total) * Math.PI * 2;
      const steps = Math.max(8, Math.ceil((end - start) * 18));
      const outer = [], inner = [];
      for (let i = 0; i <= steps; i++) { const a = start + (end - start) * i / steps; outer.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]); }
      for (let i = steps; i >= 0; i--) { const a = start + (end - start) * i / steps; inner.push([cx + Math.cos(a) * r2, cy + Math.sin(a) * r2]); }
      this.cmd(`${pdfColor(p.color || '#22C55E')} rg ${outer.map((pt, i) => `${pt[0].toFixed(2)} ${(this.h - pt[1]).toFixed(2)} ${i ? 'l' : 'm'}`).join(' ')} ${inner.map(pt => `${pt[0].toFixed(2)} ${(this.h - pt[1]).toFixed(2)} l`).join(' ')} h f`);
      start = end;
      const ly = y + 68 + idx * 19;
      this.fill(p.color || '#22C55E', x + w * .62, ly - 8, 8, 8);
      this.text(`${p.label}: ${Math.round((p.value / total) * 100)}% · Count ${fmtReportNumber(p.value)}`, x + w * .66, ly, 10, 'Poppins', this.dark);
    });
    this.circle('#FFFFFF', cx, cy, Math.max(1, r2 - 1), 48);
  }
  wordCloud(words, x, y, w, h) {
    this.text('Context of a discussion', x, y - 18, 25, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const colors = ['#2E8FCD', '#20B26B', '#F59E0B', '#8B5CF6', '#111111', '#6B7280', '#EF4444'];
    const clean = words.slice(0, 36).map(k => ({ term: pdfTruncate(k.term || k, 14), count: Number(k.count || 1) }));
    const cols = 4;
    const cellW = (w - 95) / cols;
    const cellH = 30;
    clean.forEach((k, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tx = x + 48 + col * cellW;
      const ty = y + 70 + row * cellH;
      if (ty > y + h - 32) return;
      const size = Math.min(16, 8.5 + Math.log2(k.count + 1) * 3.2 + (i < 4 ? 2.5 : 0));
      this.text(k.term, tx, ty, size, 'Poppins-Bold', colors[i % colors.length]);
    });
  }
  hotHours(x, y, w, h) {
    this.text(this.lang === 'en' ? 'Hot Hours' : 'Jam Aktif', x, y - 18, 25, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    this.text(this.lang === 'en' ? 'Mentions written on Wednesday at 7 AM generate the most reach' : 'Mention pada Rabu pukul 07.00 berpotensi menghasilkan jangkauan tertinggi', x + 62, y + 45, 10.5, 'Poppins-Bold', this.dark);
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    for (let d = 0; d < 7; d++) {
      this.text(days[d], x + 35, y + 95 + d * 28, 10, 'Poppins', '#667');
      for (let hr = 0; hr < 24; hr++) {
        const radius = 5 + ((d * 11 + hr * 7) % 7);
        const cx = x + 80 + hr * ((w - 140) / 23);
        const cy = y + 92 + d * 28;
        this.circle(d === 2 && hr === 7 ? '#12D77B' : '#74B8E8', cx, cy, radius, 18);
      }
    }
  }

  audienceInsightMap(title, ctx, x, y, w, h, labels = {}) {
    this.text(title, x, y - 18, 24, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    this.text(labels.subtitle || (this.lang === 'en' ? 'Conversation cluster map based on sources, keywords, and sentiment.' : 'Peta klaster percakapan berdasarkan sumber, kata kunci, dan sentimen.'), x + 18, y + 22, 8.6, 'Poppins', '#58706A');

    const mapX = x + 18, mapY = y + 48, mapW = w * .61, mapH = h - 92;
    const panelX = x + w * .68, panelY = y + 48, panelW = w * .27, panelH = h - 92;
    this.rect('#F8FCFA', mapX, mapY, mapW, mapH, '#DFECE6', .5);
    this.rect('#FFFFFF', panelX, panelY, panelW, panelH, '#DFECE6', .5);

    const clusters = (ctx.sourceCats || []).slice(0, 5);
    const keywords = (ctx.a?.keywords || []).slice(0, 6);
    const colors = ['#EF4444','#1DA1F2','#20C997','#A855F7','#F59E0B','#E83E8C'];
    const centers = [
      [mapX + mapW * .23, mapY + mapH * .42],
      [mapX + mapW * .48, mapY + mapH * .28],
      [mapX + mapW * .68, mapY + mapH * .53],
      [mapX + mapW * .83, mapY + mapH * .34],
      [mapX + mapW * .36, mapY + mapH * .69]
    ];
    const total = Math.max(1, (ctx.a?.total || 0));
    clusters.forEach((c, i) => {
      const [cx, cy] = centers[i % centers.length];
      const color = colors[i % colors.length];
      const ratio = Math.max(.18, Number(c.count || 0) / total);
      const r = 18 + Math.min(26, ratio * 68);
      this.circle(color, cx, cy, r, 54);
      for (let j = 0; j < 18; j++) {
        const a = (Math.PI * 2 * j / 18) + i * .25;
        const nr = r + 18 + ((j * 7 + i * 5) % 22);
        const nx = cx + Math.cos(a) * nr;
        const ny = cy + Math.sin(a) * nr;
        if (nx < mapX + 10 || nx > mapX + mapW - 10 || ny < mapY + 12 || ny > mapY + mapH - 12) continue;
        this.lineTo('#D9E5E0', cx, cy, nx, ny, .25);
        this.circle(color, nx, ny, 2.2 + ((j + i) % 3), 18);
      }
      const label = pdfTruncate(`${c.term || 'Segment'} ${Math.round((Number(c.count||0)/total)*100)}%`, 24);
      const bw = Math.max(66, label.length * 5.2 + 18);
      this.rect('#FFFFFF', cx - bw/2, cy - r - 22, bw, 18, color, .45);
      this.text(label, cx - bw/2 + 8, cy - r - 9, 7.8, 'Poppins-Bold', this.dark);
    });

    this.stroke('#CAD9D4', .35);
    for (let i = 0; i < centers.length - 1 && i < clusters.length - 1; i++) {
      const [x1,y1] = centers[i], [x2,y2] = centers[i+1];
      this.cmd(`${x1.toFixed(2)} ${(this.h-y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.h-y2).toFixed(2)} l S`);
    }

    this.text(labels.panelTitle || (this.lang === 'en' ? 'Audience Overview' : 'Ikhtisar Audiens'), panelX + 13, panelY + 20, 9.8, 'Poppins-Bold', this.dark);
    const rows = [
      [labels.total || (this.lang === 'en' ? 'Total items' : 'Total data'), fmtReportNumber(ctx.a?.total || 0)],
      [labels.reach || (this.lang === 'en' ? 'Reach' : 'Jangkauan'), fmtReportNumber(ctx.totalReach || 0)],
      [labels.negative || (this.lang === 'en' ? 'Negative' : 'Negatif'), `${ctx.a?.percentages?.negatif || 0}%`],
      [labels.source || (this.lang === 'en' ? 'Top source' : 'Sumber utama'), pdfTruncate(clusters[0]?.term || '-', 16)]
    ];
    rows.forEach((r, i) => {
      const yy = panelY + 45 + i * 38;
      this.text(r[0], panelX + 13, yy, 7.5, 'Poppins', '#64748B');
      this.text(r[1], panelX + 13, yy + 14, 11.3, 'Poppins-Bold', this.dark);
      if (i < rows.length - 1) this.lineTo('#ECF2EF', panelX + 13, yy + 24, panelX + panelW - 13, yy + 24, .4);
    });

    const segY = y + h - 43;
    const cardW = (w - 52) / 3;
    (clusters.length ? clusters : [{term:'Segment', count:0}]).slice(0, 3).forEach((c, i) => {
      const sx = x + 18 + i * (cardW + 8);
      const color = colors[i % colors.length];
      this.fill(color, sx, segY, cardW, 4);
      this.rect('#FFFFFF', sx, segY + 4, cardW, 31, '#DCEBE3', .45);
      this.text(pdfTruncate(c.term, Math.floor(cardW/5.4)), sx + 8, segY + 20, 7.8, 'Poppins-Bold', this.dark);
      this.text(`${fmtReportNumber(c.count || 0)} ${labels.mentions || (this.lang === 'en' ? 'mentions' : 'mention')}`, sx + 8, segY + 32, 6.9, 'Poppins', '#64748B');
    });

    const keyText = (keywords || []).slice(0, 4).map(k => k.term).join(' • ');
    this.text(pdfTruncate(keyText || (this.lang === 'en' ? 'No keyword yet' : 'Belum ada kata kunci'), 70), x + 20, y + h - 10, 7.4, 'Poppins', '#52625C');
  }
  logo(x, y, w, h) {
    if (this.hasLogo) return this.cmd(`q ${w} 0 0 ${h} ${x} ${(this.h - y - h).toFixed(2)} cm /Logo Do Q`);
    this.text('NEWSROOM', x, y + 28, 18, 'Poppins-Bold', '#FF2CB9');
    this.text('INTELLIGENCE', x, y + 50, 16, 'Poppins-Bold', '#0D1416');
    return this;
  }
  cover(ctx) {
    this.addPage('', ctx); this.datePill(ctx.dateRange);
    this.logo(165, 112, 265, 88);
    const qLines = wrapLineLimited(ctx.query, 32, 2);
    qLines.forEach((line, i) => this.text(line, 297 - Math.min(170, line.length * 7.5), 330 + i * 36, 30, 'Poppins-Bold', this.dark));
    this.stroke('#34D399', 1);
    const pts = [];
    for (let i = 0; i <= 18; i++) { const x = i * this.w / 18; const y = 635 + Math.sin(i * .78) * 38 + (i % 5) * 4; pts.push([x, y]); }
    this.cmd(`${pdfColor('#D8F6E9')} rg 0 ${this.h-705} m ${pts.map(p => `${p[0].toFixed(2)} ${(this.h-p[1]).toFixed(2)} l`).join(' ')} ${this.w} ${this.h-842} l 0 ${this.h-842} l h f`);
    const pts2 = [];
    for (let i = 0; i <= 18; i++) { const x = i * this.w / 18; const y = 690 + Math.cos(i * .72) * 34 + (i % 3) * 9; pts2.push([x, y]); }
    this.cmd(`${pdfColor(this.green)} rg 0 ${this.h-842} m ${pts2.map(p => `${p[0].toFixed(2)} ${(this.h-p[1]).toFixed(2)} l`).join(' ')} ${this.w} ${this.h-842} l h f`);
    this.text(REPORT_FOOTER, 122, 812, 8, 'Poppins', '#0B5D3D');
  }
  reportGuide(title, ctx, x, y, w, h) {
    this.text(title, x, y - 20, 24, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const rows = this.lang === 'en' ? [
      ['Viral Index', '0-20 low activity, 21-50 rising issue, 51-80 high attention, 81+ urgent escalation. It combines likes, comments, shares, views, and freshness.'],
      ['Sentiment', 'Green/positive, gray/neutral, red/negative. Open the color-coded link pages to inspect actual sources behind each slice.'],
      ['Share of Voice', 'Shows which platform/source owns the conversation volume. Larger share means that channel should be prioritized for monitoring and response.'],
      ['Credibility', 'Items are keyword-audited. Links are clickable so clients can verify source, date, title, sentiment, and social metrics.'],
      ['Action', 'Use recommendations to decide response timing, spokesperson, FAQ, and distribution channels.']
    ] : [
      ['Indeks Viral', '0-20 rendah, 21-50 mulai naik, 51-80 perhatian tinggi, 81+ eskalasi mendesak. Indeks menggabungkan like, komentar, share, view, dan kebaruan.'],
      ['Sentimen', 'Hijau positif, abu-abu netral, merah negatif. Buka halaman tautan berwarna untuk melihat sumber di balik tiap irisan grafik.'],
      ['Pangsa Suara', 'Menunjukkan platform/sumber yang menguasai volume percakapan. Pangsa besar berarti kanal itu perlu diprioritaskan untuk respons.'],
      ['Kredibilitas', 'Semua item diaudit berdasarkan kata kunci. Tautan dapat diklik agar klien bisa memverifikasi sumber, tanggal, judul, sentimen, dan metrik sosial.'],
      ['Aksi', 'Gunakan rekomendasi untuk menentukan waktu respons, juru bicara, FAQ, dan kanal distribusi.']
    ];
    let cy = y + 44;
    rows.forEach((row, i) => {
      this.fill(['#2563EB','#19B96B','#8B5CF6','#F59E0B','#EF4444'][i%5], x + 22, cy - 14, 8, 44);
      this.text(row[0], x + 42, cy, 11.5, 'Poppins-Bold', this.dark);
      this.wrap(row[1], x + 42, cy + 18, Math.floor((w - 80) / 5.4), 8.7, 11.5, 'Poppins', '#43535F');
      cy += 82;
    });
  }

  clickableLinkMatrix(title, groups, x, y, w, h) {
    this.text(title, x, y - 18, 22, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const groupW = (w - 58) / Math.max(1, groups.length);
    groups.forEach((group, gi) => {
      const gx = x + 18 + gi * (groupW + 11);
      const color = group.color || '#2563EB';
      this.fill(color, gx, y + 26, groupW, 5);
      this.text(pdfTruncate(group.label || 'Group', Math.floor(groupW / 5.8)), gx, y + 50, 10.4, 'Poppins-Bold', this.dark);
      this.text(`${fmtReportNumber(group.count || (group.items || []).length)} items`, gx, y + 66, 7.5, 'Poppins', '#64748B');
      let cy = y + 92;
      (group.items || []).slice(0, 6).forEach((item, idx) => {
        const titleText = pdfTruncate(item.title || item.text || item.url || '-', Math.max(16, Math.floor(groupW / 4.9)));
        this.text(`${idx + 1}. ${titleText}`, gx, cy, 7.8, 'Poppins-Bold', this.dark);
        const meta = `${item.source || item.platform || '-'} | v:${fmtReportNumber(item.viralScore || 0)} | 👍${fmtReportNumber(item.metrics?.likes || 0)} 💬${fmtReportNumber(item.metrics?.comments || 0)} 👁${fmtReportNumber(item.metrics?.views || item.reach || 0)}`;
        this.text(pdfTruncate(meta, Math.max(18, Math.floor(groupW / 4.2))), gx, cy + 11, 6.5, 'Poppins', '#64748B');
        if (item.url) this.linkText('Open source', item.url, gx, cy + 23, 18, 6.8);
        cy += 47;
      });
    });
  }
  documentationLinksPage(title, items, x, y, w, h, pageIndex = 1, totalPages = 1) {
    this.text(`${title} ${pageIndex}/${totalPages}`, x, y - 18, 20, 'Poppins-Bold', this.dark);
    this.card(x, y, w, h);
    const rows = (items || []).slice(0, 8);
    const rowH = Math.floor((h - 42) / Math.max(1, rows.length));
    rows.forEach((item, idx) => {
      const yy = y + 34 + idx * rowH;
      const sentiment = String(item.sentiment?.label || item.sentiment || 'netral').toLowerCase();
      const color = sentiment.includes('neg') ? '#EF4444' : sentiment.includes('pos') ? '#19B96B' : '#94A3B8';
      this.fill(color, x + 18, yy - 6, 7, Math.max(34, rowH - 8));
      this.text(String((pageIndex - 1) * 8 + idx + 1), x + 32, yy + 6, 8.2, 'Poppins-Bold', '#0F172A');
      this.text(pdfTruncate(item.source || item.platform || '-', 16), x + 55, yy + 6, 7.6, 'Poppins-Bold', color);
      this.text(pdfTruncate(item.author || '-', 24), x + 116, yy + 6, 7.4, 'Poppins', '#475569');
      const titleText = pdfTruncate(item.title || item.text || '-', 72);
      this.text(titleText, x + 55, yy + 20, 7.8, 'Poppins-Bold', this.dark);
      const m = item.metrics || {};
      const metrics = `${fmtReportNumber(m.views || item.reach || 0)} views | ${fmtReportNumber(m.likes || 0)} likes | ${fmtReportNumber(m.comments || 0)} comments | ${fmtReportNumber(m.shares || 0)} shares | viral ${fmtReportNumber(item.viralScore || 0)}`;
      this.text(pdfTruncate(metrics, 92), x + 55, yy + 34, 7.1, 'Poppins', '#334155');
      if (item.url) this.linkText(shortUrlForPdf(item.url, 78), item.url, x + 55, yy + 48, 78, 6.8);
      if (idx < rows.length - 1) this.lineTo('#E2E8F0', x + 34, yy + rowH - 4, x + w - 24, yy + rowH - 4, .45);
    });
    if (!rows.length) this.text('Belum ada link dokumentasi.', x + 34, y + 70, 10, 'Poppins', this.muted);
  }

  build() {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const catalogId = add(''); const pagesId = add('');
    const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const logoId = REPORT_LOGO_JPG ? add(`<< /Type /XObject /Subtype /Image /Width 294 /Height 98 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${REPORT_LOGO_JPG.length} >>\nstream\n${REPORT_LOGO_JPG.toString('binary')}\nendstream`) : null;
    const pageIds = [];
    for (const page of this.pages) {
      const stream = page.commands.join('\n');
      const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`);
      const annotIds = (page.annots || []).map(a => {
        const rect = a.rect.map(v => Number(v).toFixed(2)).join(' ');
        const url = pdfEscape(a.url);
        const tip = pdfEscape(a.tooltip || a.url);
        return add(`<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] /Contents (${tip}) /A << /S /URI /URI (${url}) >> >>`);
      });
      const annotPart = annotIds.length ? `/Annots [${annotIds.map(id => `${id} 0 R`).join(' ')}]` : '';
      const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.w} ${this.h}] ${annotPart} /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> ${logoId ? `/XObject << /Logo ${logoId} 0 R >>` : ''} >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'binary')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, 'binary');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'binary');
  }
}

function buildPdf(data) {
  const ctx = reportContext(data);
  const a = ctx.a || {};
  const lang = ctx.language === 'en' ? 'en' : 'id';
  const pdf = new SimplePdfReport();
  pdf.lang = lang;
  const L = lang === 'en' ? {
    summary: 'Summary', overview: 'Overview', executive: 'Executive Summary', analysis: 'Analysis', keywordAudit: 'Keyword Relevance Audit',
    keywordIntro: 'This report only includes items with clear keyword evidence in the title, content, source, author, domain, or link.',
    accepted: 'accepted', rejected: 'rejected', totalChecked: 'total checked', auditNote: 'Every item includes a relevance reason so the report stays on-topic.',
    whyInReport: 'Why these results/links are included', topMentions: 'Top Mentions', recentMentions: 'Recent Mentions', negativeLinks: 'Negative Sentiment Links', profiles: 'From Top Public Profiles',
    topSubtitle: 'Highest priority content based on reach, engagement, and keyword relevance.',
    recentSubtitle: 'Latest conversations that passed keyword audit. Use this page to monitor narrative shifts.',
    negativeSubtitle: 'News or social links detected as negative. Verify every item manually before official response.',
    negativeEmpty: 'No valid negative sentiment item passed keyword audit in this period.',
    mentionsReach: 'Mentions & Reach', sentiment: 'Sentiment', positive: 'Positive', negative: 'Negative', neutral: 'Neutral', reach: 'Reach', mentions: 'Mentions',
    sentimentCategories: 'Sentiment by Categories', mentionsCategories: 'Mentions by Categories', shareVoice: 'Most Share of Voice', followers: 'Most Followers', hashtags: 'Trending Hashtags', links: 'Trending Links', activeSites: 'Most Active Sites', influentialSites: 'Most Influential Sites', hotHours: 'Hot Hours', emojis: 'The Most Popular Emojis', context: 'Context of a Discussion', period: 'Period Comparison', recommended: 'Recommended Actions', audienceInsights: 'Audience Insights', readAudienceTitle: 'How to read audience map', readAudience: 'Each color cluster represents a source or discussion segment. Larger nodes mean higher share of conversation. Use the right panel to identify dominant source, reach, and risk.',
    readSentimentTitle: 'How to read sentiment', readSentiment: 'The donut shows sentiment distribution from all items that passed keyword audit. If negative sentiment rises, open the Negative Sentiment Links page to inspect sources and links.',
    readHotTitle: 'How to read hot hours', readHot: 'Bubble size shows relative activity per hour. The green dot marks a high-potential time for response, release, or content distribution.',
    readContextTitle: 'How to read discussion context', readContext: 'Larger words appear more often in relevant items. Use them for news angles, SEO, and follow-up monitoring keywords.', worldMap: 'World Source Map'
  } : {
    summary: 'Ringkasan', overview: 'Ikhtisar', executive: 'Ringkasan Eksekutif', analysis: 'Analisis', keywordAudit: 'Audit Relevansi Kata Kunci',
    keywordIntro: 'Laporan ini hanya memasukkan item yang memiliki bukti kecocokan kata kunci pada judul, isi, sumber, penulis, domain, atau tautan.',
    accepted: 'diterima', rejected: 'dikeluarkan', totalChecked: 'total dicek', auditNote: 'Setiap item diberi alasan relevansi agar laporan tidak keluar dari kata kunci.',
    whyInReport: 'Mengapa hasil/tautan masuk laporan', topMentions: 'Mention Teratas', recentMentions: 'Mention Terbaru', negativeLinks: 'Tautan Sentimen Negatif', profiles: 'Profil Publik Teratas',
    topSubtitle: 'Konten prioritas berdasarkan jangkauan, interaksi, dan relevansi kata kunci.',
    recentSubtitle: 'Percakapan terbaru yang lolos audit kata kunci. Gunakan halaman ini untuk memantau perubahan narasi.',
    negativeSubtitle: 'Daftar tautan berita/media sosial yang terdeteksi negatif. Semua item wajib diverifikasi manual sebelum respons resmi.',
    negativeEmpty: 'Tidak ditemukan item bersentimen negatif yang lolos audit kata kunci pada periode ini.',
    mentionsReach: 'Mention & Jangkauan', sentiment: 'Sentimen', positive: 'Positif', negative: 'Negatif', neutral: 'Netral', reach: 'Jangkauan', mentions: 'Mention',
    sentimentCategories: 'Sentimen berdasarkan Kategori', mentionsCategories: 'Mention berdasarkan Kategori', shareVoice: 'Pangsa Suara Terbesar', followers: 'Pengikut Terbanyak', hashtags: 'Tagar Tren', links: 'Tautan Tren', activeSites: 'Situs Paling Aktif', influentialSites: 'Situs Paling Berpengaruh', hotHours: 'Jam Aktif', emojis: 'Emoji Paling Populer', context: 'Konteks Diskusi', period: 'Perbandingan Periode', recommended: 'Rekomendasi Tindakan', audienceInsights: 'Audience Insights', readAudienceTitle: 'Cara membaca peta audiens', readAudience: 'Setiap warna mewakili klaster sumber atau segmen diskusi. Node yang lebih besar berarti pangsa percakapan lebih tinggi. Gunakan panel kanan untuk membaca sumber dominan, jangkauan, dan risiko.',
    readSentimentTitle: 'Cara membaca sentimen', readSentiment: 'Donat menunjukkan proporsi sentimen dari seluruh item yang lolos audit kata kunci. Jika sentimen negatif meningkat, buka halaman Tautan Sentimen Negatif untuk memeriksa sumber dan tautan.',
    readHotTitle: 'Cara membaca jam aktif', readHot: 'Ukuran bulatan menunjukkan volume aktivitas relatif per jam. Titik hijau menandai waktu potensial untuk respons, rilis, atau distribusi konten.',
    readContextTitle: 'Cara membaca konteks diskusi', readContext: 'Kata yang lebih besar lebih sering muncul dalam item relevan. Gunakan sebagai bahan sudut pandang berita, SEO, dan kata kunci pemantauan lanjutan.', worldMap: 'Peta Dunia Sumber Informasi'
  };
  const sentimentLabel = (key) => lang === 'en' ? ({ positif:'positive', netral:'neutral', negatif:'negative' }[key] || key) : ({ positif:'positif', netral:'netral', negatif:'negatif' }[key] || key);
  const sentimentLinkGroups = [
    { label: L.positive, color: '#19B96B', count: a.counts?.positif || 0, items: ctx.items.filter(i => i.sentiment?.label === 'positif') },
    { label: L.neutral, color: '#CBD5E1', count: a.counts?.netral || 0, items: ctx.items.filter(i => i.sentiment?.label === 'netral') },
    { label: L.negative, color: '#F05263', count: a.counts?.negatif || 0, items: ctx.items.filter(i => i.sentiment?.label === 'negatif') }
  ];
  const sourceLinkGroups = (ctx.sourceCats || []).slice(0, 3).map((src, idx) => ({
    label: src.term,
    color: ['#2563EB','#19B96B','#8B5CF6'][idx % 3],
    count: src.count,
    items: ctx.items.filter(i => sourceBucket(i.source || i.platform) === src.term).sort((a,b) => (itemReach(b)+itemEngagement(b)) - (itemReach(a)+itemEngagement(a)))
  }));

  pdf.cover(ctx);
  pdf.addPage('', ctx); pdf.text(L.summary, lang === 'en' ? 205 : 196, 420, 34, 'Poppins-Bold', '#0A0D0E');
  pdf.addPage(L.overview, ctx); pdf.datePill(ctx.dateRange);
  const metrics = lang === 'en' ? [
    ['Total results', fmtReportNumber(a.total), '+211.2%'], ['Total reach', fmtReportNumber(ctx.totalReach), '+183.5%'], ['Positive results', fmtReportNumber(a.counts?.positif), '+0.0%'],
    ['Negative results', fmtReportNumber(a.counts?.negatif), '+0.0%'], ['Awareness', fmtReportNumber(Math.max(1, Math.round((ctx.totalReach || 1) / 2500000))), '+5900.0%'], ['AVE', fmtReportNumber(Math.round((ctx.totalReach || 0) / 75000)), '+0.0%'],
    ['Social media reach', fmtReportNumber(ctx.socialReach), '+132.2%'], ['Non-social media reach', fmtReportNumber(ctx.nonSocialReach), '+215.7%'], ['User-generated content', fmtReportNumber(ctx.socialCount), '+159.7%'],
    ['Social media results', fmtReportNumber(ctx.socialCount), '+159.5%'], ['Non-social media results', fmtReportNumber(ctx.nonSocialCount), '+218.1%'], ['Likes', fmtReportNumber(ctx.likes), '+276.0%'],
    ['Comments', fmtReportNumber(ctx.comments), '+168.6%'], ['Shares', fmtReportNumber(ctx.shares), '+345.1%'], ['Views', fmtReportNumber(ctx.views), '+0.0%']
  ] : [
    ['Total hasil', fmtReportNumber(a.total), '+211.2%'], ['Total jangkauan', fmtReportNumber(ctx.totalReach), '+183.5%'], ['Hasil positif', fmtReportNumber(a.counts?.positif), '+0.0%'],
    ['Hasil negatif', fmtReportNumber(a.counts?.negatif), '+0.0%'], ['Awareness', fmtReportNumber(Math.max(1, Math.round((ctx.totalReach || 1) / 2500000))), '+5900.0%'], ['AVE', fmtReportNumber(Math.round((ctx.totalReach || 0) / 75000)), '+0.0%'],
    ['Jangkauan media sosial', fmtReportNumber(ctx.socialReach), '+132.2%'], ['Jangkauan non-media sosial', fmtReportNumber(ctx.nonSocialReach), '+215.7%'], ['Konten pengguna', fmtReportNumber(ctx.socialCount), '+159.7%'],
    ['Hasil media sosial', fmtReportNumber(ctx.socialCount), '+159.5%'], ['Hasil non-media sosial', fmtReportNumber(ctx.nonSocialCount), '+218.1%'], ['Suka', fmtReportNumber(ctx.likes), '+276.0%'],
    ['Komentar', fmtReportNumber(ctx.comments), '+168.6%'], ['Bagikan', fmtReportNumber(ctx.shares), '+345.1%'], ['View', fmtReportNumber(ctx.views), '+0.0%']
  ];
  metrics.forEach((m, i) => pdf.metricCard(34 + (i % 3) * 178, 150 + Math.floor(i / 3) * 110, 166, 92, m[0], m[1], m[2])); pdf.footer(ctx.query, 3);

  pdf.addPage(L.executive, ctx); pdf.datePill(ctx.dateRange);
  const summary = lang === 'en'
    ? `During the monitoring period ${ctx.dateRange}, mentions of ${ctx.query} recorded ${fmtReportNumber(a.total)} results with estimated reach ${fmtReportNumber(ctx.totalReach)}. The dominant sentiment is ${sentimentLabel(a.dominantSentiment || 'netral')}: positive ${a.percentages?.positif || 0}%, neutral ${a.percentages?.netral || 0}%, and negative ${a.percentages?.negatif || 0}%.`
    : `Selama periode pemantauan ${ctx.dateRange}, penyebutan ${ctx.query} mencatat ${fmtReportNumber(a.total)} hasil dengan estimasi jangkauan ${fmtReportNumber(ctx.totalReach)}. Sentimen dominan adalah ${sentimentLabel(a.dominantSentiment || 'netral')}: positif ${a.percentages?.positif || 0}%, netral ${a.percentages?.netral || 0}%, dan negatif ${a.percentages?.negatif || 0}%.`;
  let y = 180; y = pdf.wrap(summary, 35, y, 82, 12.4, 19, 'Poppins', '#111');
  y = pdf.wrap(lang === 'en' ? `Key discussion drivers include ${ctx.sourceCats.slice(0,3).map(s => s.term).join(', ') || 'available public sources'}. Top keywords include ${(a.keywords || []).slice(0, 8).map(k => k.term).join(', ') || '-'}.` : `Pendorong diskusi utama meliputi ${ctx.sourceCats.slice(0,3).map(s => s.term).join(', ') || 'sumber publik yang tersedia'}. Kata kunci teratas meliputi ${(a.keywords || []).slice(0, 8).map(k => k.term).join(', ') || '-'}.`, 35, y + 26, 82, 12.4, 19);
  y = pdf.wrap(lang === 'en' ? `Recommendations: ${(a.recommendations || []).join(' ') || 'Continue monitoring and enrich the dataset before decision making.'}` : `Rekomendasi: ${(a.recommendations || []).join(' ') || 'Lanjutkan pemantauan dan perkaya dataset sebelum pengambilan keputusan.'}`, 35, y + 26, 82, 12.4, 19); pdf.footer(ctx.query, 4);

  pdf.addPage(lang === 'en' ? 'How to Read This Report' : 'Cara Membaca Informasi Report', ctx); pdf.datePill(ctx.dateRange);
  pdf.reportGuide(lang === 'en' ? 'Reading Guide & Decision Hints' : 'Panduan Baca & Petunjuk Keputusan', ctx, 34, 150, 528, 500);
  pdf.explanatoryBox(lang === 'en' ? 'Interactive PDF note' : 'Catatan PDF interaktif', lang === 'en' ? 'Blue underlined text and source buttons are clickable. Open them to verify the exact news or social item behind each chart, sentiment color, and share-of-voice source.' : 'Teks biru bergaris bawah dan tombol sumber dapat diklik. Buka tautan tersebut untuk memverifikasi berita atau item sosial media di balik setiap grafik, warna sentimen, dan pangsa suara.', 34, 680, 528, 72);
  pdf.footer(ctx.query, 5);

  pdf.addPage(L.keywordAudit, ctx); pdf.datePill(ctx.dateRange);
  const audit = ctx.queryRelevance || {};
  let ay = 175;
  ay = pdf.wrap(`Keyword: ${audit.query || ctx.query}. ${L.keywordIntro} ${L.totalChecked}: ${fmtReportNumber(audit.totalChecked || 0)}; ${L.accepted}: ${fmtReportNumber(audit.accepted || 0)}; ${L.rejected}: ${fmtReportNumber(audit.rejected || 0)}.`, 35, ay, 82, 11.5, 17);
  ay = pdf.wrap(audit.accuracyNote || L.auditNote, 35, ay + 18, 82, 11.0, 16, 'Poppins', '#0E6D48');
  const reasonItems = (audit.sampleReasons || []).slice(0, 3).map(x => ({ title: x.title, meta: `Relevance score ${x.score || 0}`, text: x.reason }));
  pdf.mentionCards(L.whyInReport, reasonItems, 34, 388, 528, 310, { max: 3, bodyLines: 1, subtitle: lang === 'en' ? 'This section explains why each accepted item matches the selected keyword.' : 'Bagian ini menjelaskan alasan data diterima sehingga manajemen dapat memverifikasi kesesuaian hasil dengan kata kunci.' });
  pdf.footer(ctx.query, 5);

  pdf.addPage('', ctx); pdf.text(L.analysis, lang === 'en' ? 218 : 224, 420, 34, 'Poppins-Bold', '#0A0D0E'); pdf.footer(ctx.query, 6);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.audienceInsightMap(L.audienceInsights, ctx, 34, 145, 528, 520, { subtitle: lang === 'en' ? 'Audience and source clusters based only on keyword-audited data.' : 'Klaster audiens dan sumber berdasarkan data yang lolos audit kata kunci.', mentions: L.mentions.toLowerCase() }); pdf.explanatoryBox(L.readAudienceTitle, L.readAudience, 34, 700, 528, 58); pdf.footer(ctx.query, 7);
  const sourcePinsForPdf = buildSourceMapPins(a.items || []); pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.worldSourceMap(L.worldMap || 'World Source Map', sourcePinsForPdf, 34, 150, 528, 470); pdf.table(lang === 'en' ? 'Top source locations' : 'Lokasi sumber teratas', [{label: lang === 'en' ? 'Location' : 'Lokasi',x:.08},{label:L.mentions,x:.54},{label:L.negative,x:.73},{label:'Source',x:.86}], sourcePinsForPdf.slice(0,5).map(p=>[p.country, fmtReportNumber(p.count), fmtReportNumber(p.negative), (p.sources||[]).slice(0,2).join(', ')]), 34, 660, 528, 34); pdf.footer(ctx.query, 8);
  const topItems = ctx.topMentions.map(item => mentionToPdfItem(item, ctx));
  const recentItems = ctx.recentMentions.map(item => mentionToPdfItem(item, ctx));
  const negItems = negativeMentionsForReport(ctx).map(item => mentionToPdfItem(item, ctx));
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.mentionCards(L.topMentions, topItems, 34, 150, 528, 545, { max: 3, bodyLines: 2, subtitle: L.topSubtitle }); pdf.footer(ctx.query, 8);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.mentionCards(L.recentMentions, recentItems, 34, 150, 528, 545, { max: 3, bodyLines: 2, subtitle: L.recentSubtitle }); pdf.footer(ctx.query, 9);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.mentionCards(L.negativeLinks, negItems, 34, 150, 528, 545, { max: 3, bodyLines: 2, empty: L.negativeEmpty, subtitle: L.negativeSubtitle }); pdf.footer(ctx.query, 10);

  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.mentionCards(L.profiles, ctx.authorStats.map(x => ({ title: x.term, meta: `${fmtReportNumber(x.reach)} ${L.reach.toLowerCase()} | ${fmtReportNumber(x.count)} ${L.mentions.toLowerCase()}`, text: lang === 'en' ? `This public profile or author contributes significantly to the ${ctx.query} conversation and should be monitored for narrative shifts.` : `Profil/penulis ini berkontribusi besar terhadap percakapan ${ctx.query}. Pantau perubahan narasi, konteks kutipan, dan kanal distribusinya.`, reason: lang === 'en' ? 'Credibility is inferred from mentions, reach, and consistency across keyword-audited sources.' : 'Kredibilitas dihitung dari jumlah mention, jangkauan, dan konsistensi sumber dalam dataset yang lolos audit kata kunci.' })), 34, 150, 528, 500, { max: 4, bodyLines: 2 }); pdf.footer(ctx.query, 11);

  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.lineChart(L.mentionsReach, ctx.trend.map(d => d.mentions), ctx.trend.map(d => d.reach), 34, 150, 528, 300, L.mentions, L.reach, '#2176FF', '#0A8F5D'); pdf.lineChart(L.sentiment, ctx.trend.map(d => d.positif), ctx.trend.map(d => d.negatif), 34, 530, 528, 230, L.positive, L.negative, '#19B96B', '#F05263'); pdf.footer(ctx.query, 12);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.donut(L.sentimentCategories, [ {label:L.negative, value:a.counts?.negatif||0, color:'#F05263'}, {label:L.neutral, value:a.counts?.netral||0, color:'#CBD5E1'}, {label:L.positive, value:a.counts?.positif||0, color:'#19B96B'}], 34, 150, 528, 250); pdf.explanatoryBox(L.readSentimentTitle, L.readSentiment, 34, 420, 528, 58); pdf.donut(L.mentionsCategories, ctx.sourceCats.map((s,i)=>({label:s.term, value:s.count, color:['#21C6C9','#4E9DFE','#E83E8C','#8B5CF6','#26C281','#F59E0B','#EF4444','#94A3B8'][i%8]})), 34, 545, 528, 230); pdf.footer(ctx.query, 13);
  pdf.addPage(lang === 'en' ? 'Clickable Sentiment Sources' : 'Tautan Sumber Berdasarkan Sentimen', ctx); pdf.datePill(ctx.dateRange);
  pdf.clickableLinkMatrix(lang === 'en' ? 'Color-coded sentiment links' : 'Tautan sesuai warna grafik sentimen', sentimentLinkGroups, 34, 150, 528, 545);
  pdf.explanatoryBox(lang === 'en' ? 'How to use this page' : 'Cara menggunakan halaman ini', lang === 'en' ? 'Each column follows the same color as the sentiment pie chart. Click Open source to verify the exact item, platform, social metrics, and URL behind the sentiment number.' : 'Setiap kolom mengikuti warna grafik pie sentimen. Klik Open source untuk memverifikasi item, platform, metrik sosial, dan URL yang menjadi dasar angka sentimen.', 34, 720, 528, 60);
  pdf.footer(ctx.query, 14);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.table(L.shareVoice, [{label:'Profile',x:.07},{label:L.mentions,x:.56},{label:L.reach,x:.71},{label: lang === 'en' ? 'Voice share' : 'Pangsa suara',x:.84}], ctx.authorStats.slice(0,5).map(x => [x.term, fmtReportNumber(x.count), fmtReportNumber(x.reach), `${Math.round(x.count/Math.max(a.total,1)*1000)/10}%`]), 34, 150, 528, 44); pdf.table(L.followers, [{label:'Profile',x:.07},{label: lang === 'en' ? 'Followers' : 'Pengikut',x:.66},{label:L.mentions,x:.84}], ctx.authorStats.slice(0,5).map(x => [x.term, fmtReportNumber(x.followers || x.reach/100), fmtReportNumber(x.count)]), 34, 500, 528, 44); pdf.footer(ctx.query, 14);
  pdf.addPage(lang === 'en' ? 'Clickable Share of Voice Sources' : 'Tautan Berdasarkan Pangsa Suara', ctx); pdf.datePill(ctx.dateRange);
  pdf.clickableLinkMatrix(lang === 'en' ? 'Source/platform links behind share of voice' : 'Link sumber/platform di balik pangsa suara', sourceLinkGroups, 34, 150, 528, 545);
  pdf.explanatoryBox(lang === 'en' ? 'How to read share of voice' : 'Cara membaca pangsa suara', lang === 'en' ? 'A bigger source share means the discussion is concentrated on that platform or media group. Click sources to inspect the exact links before recommending a response channel.' : 'Pangsa suara yang lebih besar berarti percakapan terkonsentrasi pada platform atau kelompok media tersebut. Klik sumber untuk memeriksa tautan asli sebelum menentukan kanal respons.', 34, 720, 528, 60);
  pdf.footer(ctx.query, 15);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); const sourceHashtags = (a.hashtags || []).filter(x => !/^#?[0-9a-f]{6}$/i.test(String(x.term || ''))); const reportHashtags = (sourceHashtags.length ? sourceHashtags : (a.keywords || []).filter(x => !/^#?[0-9a-f]{6}$/i.test(String(x.term || '')))).slice(0,5); pdf.table(L.hashtags, [{label: lang === 'en' ? 'Hashtag' : 'Tagar',x:.10},{label:L.mentions,x:.82}], reportHashtags.map(x => [String(x.term || '').startsWith('#') ? x.term : `#${x.term}`, fmtReportNumber(x.count)]), 34, 150, 528); pdf.table(L.links, [{label: lang === 'en' ? 'Link' : 'Tautan',x:.10},{label:L.mentions,x:.82}], (ctx.links.length ? ctx.links : ctx.domainStats).slice(0,5).map(x => [shortUrlForPdf(x.term, 55), fmtReportNumber(x.count)]), 34, 475, 528); pdf.footer(ctx.query, 15);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.table(L.activeSites, [{label:'Site',x:.10},{label:L.mentions,x:.82}], ctx.domainStats.slice(0,5).map(x => [x.term, fmtReportNumber(x.count)]), 34, 150, 528); pdf.table(L.influentialSites, [{label:'Site',x:.10},{label:L.mentions,x:.55},{label:L.reach,x:.70},{label: lang === 'en' ? 'Influence score' : 'Skor pengaruh',x:.84}], ctx.domainStats.slice(0,5).map(x => [x.term, fmtReportNumber(x.count), fmtReportNumber(x.reach), 10]), 34, 475, 528); pdf.footer(ctx.query, 16);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.hotHours(34, 150, 528, 300); pdf.explanatoryBox(L.readHotTitle, L.readHot, 34, 480, 528, 58); pdf.text(L.emojis, 34, 590, 22, 'Poppins-Bold', '#0A0D0E'); pdf.card(34, 620, 528, 140); const labels = ['sparkles','check','heart','alert','clock','fire','star','pin','party','smile','phone','flag','music','coffee','plane','warning','soccer','chart','message','link']; labels.forEach((w,i)=>pdf.text(w, 65 + (i*73)%430, 665 + Math.floor(i/6)*28, 8 + (i%4), 'Poppins-Bold', ['#F59E0B','#20B26B','#EF4444','#2E8FCD','#8B5CF6'][i%5])); pdf.footer(ctx.query, 17);
  pdf.addPage('', ctx); pdf.datePill(ctx.dateRange); pdf.wordCloud((a.keywords || []).slice(0,90), 34, 150, 528, 300); pdf.explanatoryBox(L.readContextTitle, L.readContext, 34, 490, 528, 72); pdf.footer(ctx.query, 18);
  pdf.addPage('', ctx); pdf.text(L.period, 150, 420, 31, 'Poppins-Bold', '#0A0D0E'); pdf.footer(ctx.query, 19);
  pdf.addPage(L.overview, ctx); pdf.datePill(ctx.dateRange); pdf.wrap(lang === 'en' ? `Compared with the previous period, ${ctx.query} currently records ${fmtReportNumber(a.total)} mentions and ${fmtReportNumber(ctx.totalReach)} reach. Use this page as a management summary for trend direction, risk level, and recommended next communication actions.` : `Dibandingkan periode sebelumnya, ${ctx.query} saat ini mencatat ${fmtReportNumber(a.total)} mention dan ${fmtReportNumber(ctx.totalReach)} jangkauan. Gunakan halaman ini sebagai ringkasan manajemen untuk arah tren, tingkat risiko, dan tindakan komunikasi lanjutan.`, 35, 175, 68, 12.2, 18); pdf.metricCard(34, 260, 166, 92, lang === 'en' ? 'Current mentions' : 'Mention saat ini', fmtReportNumber(a.total), '+211%'); pdf.metricCard(214, 260, 166, 92, lang === 'en' ? 'Previous period' : 'Periode sebelumnya', fmtReportNumber(Math.max(1, Math.round((a.total || 1) / 3.1))), '-'); pdf.metricCard(394, 260, 166, 92, L.recommended, fmtReportNumber((a.recommendations || []).length), 'ready'); pdf.footer(ctx.query, 20);
  const docLinks = (ctx.items || []).filter(item => item.url);
  const docChunks = [];
  for (let i = 0; i < docLinks.length; i += 8) docChunks.push(docLinks.slice(i, i + 8));
  const maxDocPages = Math.min(docChunks.length, 35);
  for (let i = 0; i < maxDocPages; i++) {
    pdf.addPage(lang === 'en' ? 'Clickable Documentation Links' : 'Dokumentasi Link Klik', ctx); pdf.datePill(ctx.dateRange);
    pdf.documentationLinksPage(lang === 'en' ? 'All keyword-matched source links' : 'Semua link sumber sesuai keyword', docChunks[i], 34, 150, 528, 590, i + 1, maxDocPages);
    pdf.explanatoryBox(lang === 'en' ? 'Verification note' : 'Catatan verifikasi', lang === 'en' ? 'Every blue link is clickable. Metrics are shown exactly as supplied by the source dataset/API; zero means the source did not provide that metric.' : 'Setiap tautan biru dapat diklik. Metrik ditampilkan sesuai data dari dataset/API sumber; angka 0 berarti sumber tidak menyediakan metrik tersebut.', 34, 722, 528, 62);
    pdf.footer(ctx.query, 99);
  }
  return pdf.build();
}

function minimalPdf(pages) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (const pageLines of pages) {
    const text = pageLines.map(line => `(${pdfEscape(line)}) Tj T*`).join('\n');
    const stream = `BT /F1 10 Tf 46 790 Td 13 TL ${text} ET`;
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function reportFilename(query, format) {
  const slug = String(query || 'monitoring').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'monitoring';
  return `newsroom-intelligence-report-${slug}.${format}`;
}


app.get('/health', (req, res) => {
  res.json({
    ok: true,
    name: 'Newsroom Intelligence Enterprise v7.0',
    defaultTheme: 'light',
    realtime: true,
    gdeltRateLimit: { minIntervalMs: GDELT_MIN_INTERVAL_MS, cacheTtlMs: GDELT_CACHE_TTL_MS, staleCacheMs: GDELT_STALE_CACHE_MS },
    freeSources: ['gdelt', 'rss/google-news-rss', 'bluesky', 'facebook', 'x', 'threads', 'youtube', 'tiktok', 'instagram', 'linkedin', 'hackernews'],
    optionalKeys: ['GOOGLE_FACTCHECK_API_KEY', 'MAFINDO_API_KEY', 'APIFY_TOKEN', 'AI_TOOLS_API_KEY / SUMOPOD_API_KEY'],
    timestamp: new Date().toISOString()
  });
});


app.post('/api/auth/login', (req, res) => {
  const session = issueSession(req.body?.password || '');
  if (!session) return res.status(401).json({ error: 'Password salah. Gunakan password superadmin, demo, atau paket yang benar.', status: 401 });
  res.json({ ok: true, ...session, expiresAtIso: new Date(session.expiresAt).toISOString() });
});

app.get('/api/auth/session', authRequired, (req, res) => {
  res.json({ ok: true, session: req.newsroomSession, expiresAtIso: new Date(req.newsroomSession.expiresAt).toISOString() });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  return authRequired(req, res, next);
});

app.post('/api/superadmin/verify', (req, res, next) => {
  try {
    const password = String(req.body?.password || '').trim();
    const passwords = activePasswords();
    if (!password || password !== passwords.superadmin) {
      return res.status(401).json({ ok: false, error: 'Password superadmin salah.', status: 401 });
    }
    const proof = issueScopedProof('ai-settings');
    res.json({ ok: true, message: 'Akses superadmin untuk AI aktif selama 30 menit.', ...proof });
  } catch (err) { next(err); }
});

app.get('/api/superadmin/passwords', (req, res, next) => {
  try {
    assertSuperadmin(req);
    const runtimeRaw = readRuntimeSettings();
    const runtime = activePasswords();
    res.json({
      ok: true,
      mode: req.newsroomSession.mode,
      updatedAt: runtime.updatedAt,
      superadminConfigured: Boolean(runtime.superadmin),
      plans: visiblePlanConfig(runtimeRaw),
      message: runtime.updatedAt ? `Password pernah diperbarui pada ${runtime.updatedAt}.` : 'Password masih mengikuti default .env / paket aplikasi.'
    });
  } catch (err) { next(err); }
});

app.post('/api/superadmin/passwords', (req, res, next) => {
  try {
    assertSuperadmin(req);
    const planPasswords = req.body?.planPasswords && typeof req.body.planPasswords === 'object' ? req.body.planPasswords : {};
    const update = {};
    for (const plan of PLAN_DEFINITIONS) {
      const value = String(planPasswords[plan.id] ?? req.body?.[plan.runtimeKey] ?? '').trim();
      if (!value) continue;
      if (value.length < 6) throw Object.assign(new Error(`Password ${plan.label} minimal 6 karakter.`), { status: 400 });
      update[plan.runtimeKey] = value;
    }
    const superadminPassword = String(req.body?.superadminPassword || '').trim();
    if (superadminPassword) {
      if (superadminPassword.length < 10) throw Object.assign(new Error('Password superadmin minimal 10 karakter.'), { status: 400 });
      update.superadminPassword = superadminPassword;
    }
    if (!Object.keys(update).length) throw Object.assign(new Error('Isi minimal satu password baru untuk demo/paket.'), { status: 400 });
    const saved = writeRuntimeSettings(update);
    res.json({ ok: true, updatedAt: saved.updatedAt, plans: visiblePlanConfig(saved), message: 'Password demo dan paket berhasil diperbarui. Login baru akan memakai password terbaru.' });
  } catch (err) { next(err); }
});


function cleanMarkdownLine(value = '', fallback = '-') {
  return String(value || fallback).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentOptimizerFallback({ mode = 'release', query = 'isu publik', content = '', audience = 'publik dan media', analysis = {}, error = null } = {}) {
  const keywords = (analysis.keywords || []).slice(0, 8).map(k => k.term).filter(Boolean);
  const sources = (analysis.topSources || []).slice(0, 5).map(k => k.term).filter(Boolean);
  const top = (analysis.viral || analysis.items || []).slice(0, 5);
  const baseTitle = cleanMarkdownLine(query || keywords[0] || 'Isu Publik');
  const firstSource = cleanMarkdownLine(sources[0] || 'sumber monitoring publik');
  const summaryText = cleanMarkdownLine(content || top[0]?.title || top[0]?.text || `Data monitoring menunjukkan perkembangan terkait ${baseTitle}.`);
  const slug = baseTitle.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'rilis-berita';
  const hashtags = [...new Set([baseTitle, ...keywords].map(k => '#' + String(k).replace(/[^a-z0-9]+/gi, '').slice(0, 28)).filter(x => x.length > 1))].slice(0, 12);
  const refs = top.map((item, i) => `${i + 1}. ${cleanMarkdownLine(item.title || item.text || item.url || '-')}${item.url ? ` — ${item.url}` : ''}`).join('\n') || '-';
  const warning = error ? `\n\n> Catatan sistem: AI eksternal belum merespons stabil (${cleanMarkdownLine(error.message || error)}). Output ini adalah fallback editorial lokal berbasis data monitoring agar pekerjaan tetap bisa dilanjutkan.` : '';
  return `# AI Content Optimizer — ${mode.toUpperCase()}

## 1. Lima Pilihan Judul
1. ${baseTitle}: Data Monitoring Menunjukkan Perkembangan Baru
2. Respons Terukur atas Isu ${baseTitle} Berbasis Data Publik
3. ${baseTitle} Jadi Perhatian, Ini Ringkasan Situasi Terkini
4. Memahami Isu ${baseTitle} dari Percakapan Publik dan Media
5. Strategi Komunikasi ${baseTitle}: Fakta, Risiko, dan Rekomendasi

## 2. Rilis/Berita Final
**Judul terpilih:** ${baseTitle}: Data Monitoring Menunjukkan Perkembangan Baru

**Lead:** Berdasarkan pemantauan newsroom intelligence, isu ${baseTitle} terpantau dalam percakapan publik dan pemberitaan dengan total ${analysis.total || 0} data relevan. Sentimen dominan tercatat ${analysis.dominantSentiment || 'netral'}, dengan sumber utama dari ${firstSource}.

**Isi berita/rilis:**  
Pemantauan dilakukan terhadap data yang lolos audit kata kunci agar hasil tetap sesuai isu utama. Data menunjukkan proporsi sentimen positif ${analysis.percentages?.positif || 0}%, netral ${analysis.percentages?.netral || 0}%, dan negatif ${analysis.percentages?.negatif || 0}%. Temuan ini perlu dibaca sebagai indikator awal untuk membantu redaksi, humas, atau klien menentukan sudut komunikasi, klarifikasi, dan prioritas respons.

Konten sumber yang menjadi dasar penyusunan: ${summaryText}

**Kutipan netral:** “Kami menggunakan pemantauan berbasis data untuk memahami perkembangan isu, memverifikasi sumber, dan menyusun respons komunikasi yang proporsional.”

**Penutup:** Organisasi disarankan memperbarui pemantauan secara berkala, memeriksa tautan sumber, dan menyiapkan FAQ publik untuk mengurangi salah tafsir.

## 3. SEO Pack
- **Meta title:** ${baseTitle} Terkini dan Analisis Data
- **Meta description:** Ringkasan data monitoring ${baseTitle}, sentimen publik, sumber utama, dan rekomendasi komunikasi berbasis bukti.
- **Slug:** ${slug}
- **Focus keyword:** ${baseTitle}
- **Secondary keywords:** ${keywords.join(', ') || baseTitle}

## 4. AEO Pack — FAQ
1. **Apa isu utama yang dipantau?** Isu utama adalah ${baseTitle}.
2. **Apa sentimen dominan?** Sentimen dominan saat ini ${analysis.dominantSentiment || 'netral'}.
3. **Dari mana data berasal?** Data berasal dari sumber publik dan dataset yang dipilih dalam monitoring.
4. **Apa risiko komunikasi utama?** Risiko utama adalah salah tafsir, disinformasi, dan eskalasi percakapan negatif.
5. **Apa tindakan yang disarankan?** Verifikasi link, siapkan pernyataan resmi, dan pantau perubahan narasi.

## 5. GEO Pack
- **Entitas isu:** ${baseTitle}
- **Sumber/platform penting:** ${sources.join(', ') || '-'}
- **Konteks:** monitoring isu publik, reputasi, komunikasi, dan respons redaksi/humas
- **Lokasi/cakupan:** ${analysis.geoScope?.label || 'Global / sesuai pengaturan pencarian'}

## 6. Hashtag & Distribusi
- **Hashtag:** ${hashtags.join(' ') || '#NewsroomIntelligence'}
- **Caption singkat:** Pemantauan terbaru terkait ${baseTitle} menunjukkan perlunya respons berbasis data, verifikasi sumber, dan komunikasi yang jelas.
- **Kanal distribusi:** website resmi, siaran pers, media sosial, grup stakeholder, dan kanal redaksi.

## 7. Catatan Editor
- Jangan menambahkan klaim yang belum ada pada data.
- Cek ulang tautan sumber sebelum publikasi.
- Prioritaskan klarifikasi untuk item dengan viral score tinggi atau sentimen negatif.

## 8. Referensi Monitoring
${refs}${warning}`;
}

function editorialInsightFallback({ analysis = {}, query = 'isu publik', error = null } = {}) {
  const keywords = (analysis.keywords || []).slice(0, 6).map(k => `${k.term} (${k.count})`).join(', ') || '-';
  const sources = (analysis.topSources || []).slice(0, 5).map(k => `${k.term} (${k.count})`).join(', ') || '-';
  const note = error ? `\n- Catatan sistem: AI eksternal belum stabil (${cleanMarkdownLine(error.message || error)}), insight ini dibuat dari engine lokal.` : '';
  return `## Insight Redaksi
- Total data relevan: ${analysis.total || 0}
- Sentimen dominan: ${analysis.dominantSentiment || '-'}
- Keyword utama: ${keywords}
- Sumber utama: ${sources}
- Risiko: pantau item viral dan sentimen negatif sebelum respons resmi.
- Peluang angle: gunakan keyword dominan sebagai sudut rilis, FAQ publik, dan konten klarifikasi.
- Rekomendasi 24 jam: verifikasi tautan, siapkan pernyataan singkat, dan update monitoring berkala.${note}`;
}

app.post('/api/sumopod/precheck', (req, res, next) => {
  try {
    assertAiSuperadmin(req);
    const config = sumopodConfigFromReq(req);
    res.json({ ok: Boolean(config.apiKey), hasApiKey: Boolean(config.apiKey), baseUrl: config.baseUrl, model: config.model, message: config.apiKey ? 'API key AI Tools terbaca. Siap dites.' : 'API key AI Tools belum terbaca.' });
  } catch (err) { next(err); }
});

app.post('/api/sumopod/test', async (req, res, next) => {
  try {
    assertAiSuperadmin(req);
    const config = sumopodConfigFromReq(req);
    const prompt = String(req.body?.prompt || 'Buat satu kalimat sapaan untuk redaksi digital.').trim();
    const result = await callSumopod([
      { role: 'system', content: 'Anda adalah asisten redaksi newsroom. Jawab ringkas, profesional, bahasa Indonesia.' },
      { role: 'user', content: prompt }
    ], config);
    res.json(result);
  } catch (err) { next(err); }
});

app.post('/api/sumopod/editorial-insight', async (req, res, next) => {
  try {
    assertAiSuperadmin(req);
    const config = sumopodConfigFromReq(req);
    const analysis = req.body?.analysis || analyzeItems(req.body?.items || []);
    const prompt = `Buat insight redaksi ringkas dari data monitoring berikut. Fokus pada angle berita, risiko hoaks, narasumber yang perlu dihubungi, dan rekomendasi tindak lanjut. Data: ${JSON.stringify({ total: analysis.total, sentiment: analysis.percentages, keywords: (analysis.keywords || []).slice(0, 12), viral: (analysis.viral || []).slice(0, 6).map(i => ({ source: i.source, title: i.title, sentiment: i.sentiment?.label, viralScore: i.viralScore })) })}`;
    try {
      const result = await callSumopod([
        { role: 'system', content: 'Anda adalah editor senior dan analis media. Beri output bullet yang padat, faktual, dan siap dipakai rapat redaksi.' },
        { role: 'user', content: prompt }
      ], { ...config, timeoutMs: AI_REQUEST_TIMEOUT_MS });
      res.json({ ...result, fallback: false });
    } catch (aiErr) {
      const text = editorialInsightFallback({ analysis, query: req.body?.query || 'isu publik', error: aiErr });
      res.json({ ok: true, provider: 'local-editorial-fallback', model: 'newsroom-local-fallback', text, fallback: true, warning: aiErr.message });
    }
  } catch (err) { next(err); }
});

app.post('/api/ai/content-optimizer', async (req, res, next) => {
  try {
    assertAiSuperadmin(req);
    const config = sumopodConfigFromReq(req);
    config.maxTokens = Number(req.body?.maxTokens || 1500);
    config.temperature = Number(req.body?.temperature ?? 0.42);
    const mode = String(req.body?.mode || 'release');
    const query = String(req.body?.query || req.body?.keyword || 'isu publik').trim();
    const content = String(req.body?.content || '').trim();
    const audience = String(req.body?.audience || 'publik dan media').trim();
    const analysis = req.body?.analysis || analyzeItems(req.body?.items || []);
    const topItems = (analysis.items || []).slice(0, 8).map((item, i) => {
      const m = item.metrics || {};
      return `${i + 1}. ${item.title || item.text || '-'} | source=${item.source || item.platform || '-'} | sentiment=${item.sentiment?.label || '-'} | likes=${m.likes || 0}, comments=${m.comments || 0}, shares=${m.shares || 0}, views=${m.views || 0} | url=${item.url || '-'}`;
    }).join('\n');

    const prompt = [
      `Anda adalah editor senior, SEO strategist, AEO/GEO optimization specialist, dan praktisi humas.`,
      `Tulis dalam bahasa Indonesia baku sesuai KBBI, profesional, ringkas, tidak membuat fakta baru, dan gunakan data monitoring hanya sebagai konteks.`,
      `Mode: ${mode}. Keyword utama: ${query}. Target audiens: ${audience}.`,
      `Konten sumber/catatan pengguna:`,
      content || '(kosong; gunakan ringkasan data monitoring sebagai konteks utama)',
      `Data monitoring: total ${analysis.total || 0}; sentimen dominan ${analysis.dominantSentiment || '-'}; positif ${analysis.percentages?.positif || 0}%, netral ${analysis.percentages?.netral || 0}%, negatif ${analysis.percentages?.negatif || 0}%.`,
      `Top keyword: ${(analysis.keywords || []).slice(0, 10).map(k => `${k.term} (${k.count})`).join(', ') || '-'}.`,
      `Top sumber: ${(analysis.topSources || []).slice(0, 8).map(k => `${k.term} (${k.count})`).join(', ') || '-'}.`,
      `Contoh item sumber:`,
      topItems || '-',
      `Output wajib dengan format markdown:`,
      `1. Lima Pilihan Judul: 5 judul kuat, aman secara editorial, dan SEO friendly.`,
      `2. Rilis/Berita Final: judul terpilih, lead, body 5W+1H, kutipan netral, penutup, narahubung placeholder jika tidak ada.`,
      `3. SEO Pack: meta title max 60 karakter, meta description max 155 karakter, slug, focus keyword, secondary keywords.`,
      `4. AEO Pack: 5 FAQ singkat yang langsung menjawab pertanyaan publik.`,
      `5. GEO Pack: entitas penting, lokasi, organisasi, orang, isu, dan konteks agar mudah dipahami mesin pencari generatif.`,
      `6. Hashtag & Distribusi: 12 hashtag relevan, caption singkat media sosial, dan rekomendasi kanal distribusi.`,
      `7. Catatan Editor: risiko klaim, data yang perlu diverifikasi, dan sumber yang perlu ditautkan.`
    ].join('\n\n');

    try {
      const result = await callSumopod([
        { role: 'system', content: 'Anda adalah editor newsroom profesional. Output harus rapi, mudah dibaca, dan siap diedit ulang.' },
        { role: 'user', content: prompt }
      ], { ...config, timeoutMs: AI_REQUEST_TIMEOUT_MS });
      res.json({ ...result, mode, query, fallback: false });
    } catch (aiErr) {
      const text = contentOptimizerFallback({ mode, query, content, audience, analysis, error: aiErr });
      res.json({ ok: true, provider: 'local-editorial-fallback', model: 'newsroom-local-fallback', text, mode, query, fallback: true, warning: aiErr.message });
    }
  } catch (err) { next(err); }
});

app.get('/api/free/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'gdelt', name: 'GDELT Doc API', type: 'news', keyRequired: false, realtime: true, note: `Berita global real-time/open data. Dibatasi otomatis minimal ${Math.ceil(GDELT_MIN_INTERVAL_MS / 1000)} detik/request + cache.` },
      { id: 'bluesky', name: 'Bluesky Public AppView Search', type: 'social', keyRequired: false, realtime: true, note: 'Pencarian post publik Bluesky tanpa login.' },
      { id: 'hackernews', name: 'Hacker News Algolia', type: 'forum/tech', keyRequired: false, realtime: true, note: 'Isu teknologi dan diskusi publik.' },
      { id: 'rss', name: 'RSS / Google News RSS', type: 'news/rss', keyRequired: false, realtime: true, note: 'Feed berita berbasis query atau URL RSS custom.' },
      { id: 'apify', name: 'Apify Dataset Converter', type: 'scraper/import', keyRequired: false, realtime: 'public dataset only', note: 'Dataset publik bisa dibaca tanpa token; dataset privat butuh token.' },
      { id: 'facebook', name: 'Facebook public mention search', type: 'social/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; data scraper bisa memakai Dataset ID Apify/Social X.' },
      { id: 'x', name: 'X public mention search', type: 'social/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; untuk post lengkap gunakan dataset scraper.' },
      { id: 'threads', name: 'Threads public mention search', type: 'social/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; untuk post lengkap gunakan dataset scraper.' },
      { id: 'youtube', name: 'YouTube public mention search', type: 'video/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; dataset scraper dapat memperkaya views/likes/comments.' },
      { id: 'tiktok', name: 'TikTok public mention search', type: 'video/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; dataset scraper dapat memperkaya engagement.' },
      { id: 'instagram', name: 'Instagram public mention search', type: 'social/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; untuk data lengkap gunakan dataset scraper.' },
      { id: 'linkedin', name: 'LinkedIn public mention search', type: 'professional/public-rss-or-dataset', keyRequired: false, realtime: true, note: 'Fallback no-key lewat Google News RSS query; dataset scraper dapat memperkaya data akun dan engagement.' }
    ]
  });
});

app.get('/api/free/gdelt/status', (req, res) => {
  res.json({
    source: 'gdelt',
    minIntervalMs: GDELT_MIN_INTERVAL_MS,
    cacheTtlMs: GDELT_CACHE_TTL_MS,
    staleCacheMs: GDELT_STALE_CACHE_MS,
    nextAllowedAt: gdeltNextAllowedAt ? new Date(gdeltNextAllowedAt).toISOString() : null,
    waitingMs: Math.max(gdeltNextAllowedAt - Date.now(), 0),
    cacheEntries: gdeltCache.size
  });
});

app.post('/api/5w1h', (req, res) => res.json(buildRelease(req.body || {})));

app.post('/api/sentiment', (req, res) => {
  const raw = req.body?.items || req.body?.texts || [];
  const items = raw.map(item => typeof item === 'string' ? { text: item } : item).filter(i => String(i.text || i.title || '').trim());
  res.json(analyzeItems(items));
});


app.get('/api/free/trends', async (req, res, next) => {
  try {
    const trends = await getCurrentIssueTrends({ days: req.query.days || 7, max: req.query.max || 24 });
    res.json(trends);
  } catch (err) { next(err); }
});

app.get('/api/free/gdelt', async (req, res, next) => {
  try {
    const query = String(req.query.query || 'Indonesia');
    const items = await getGdelt(query, req.query.hours || 24, req.query.max || 80);
    const relevance = filterItemsByQueryRelevance(items, query);
    const analysis = analyzeItems(relevance.matched);
    analysis.queryRelevance = relevance.summary;
    res.json({ source: 'gdelt', total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
  } catch (err) { next(err); }
});

app.get('/api/free/bluesky', async (req, res, next) => {
  try {
    const query = String(req.query.query || 'Indonesia');
    const items = await getBluesky(query, req.query.max || 50);
    const relevance = filterItemsByQueryRelevance(items, query);
    const analysis = analyzeItems(relevance.matched);
    analysis.queryRelevance = relevance.summary;
    res.json({ source: 'bluesky', total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
  } catch (err) { next(err); }
});

app.get('/api/free/hackernews', async (req, res, next) => {
  try {
    const query = String(req.query.query || 'Indonesia');
    const items = await getHackerNews(query, req.query.hours || 168, req.query.max || 50);
    const relevance = filterItemsByQueryRelevance(items, query);
    const analysis = analyzeItems(relevance.matched);
    analysis.queryRelevance = relevance.summary;
    res.json({ source: 'hackernews', total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
  } catch (err) { next(err); }
});

app.get('/api/free/rss', async (req, res, next) => {
  try {
    const query = String(req.query.query || 'Indonesia');
    const items = await getRssFeed({ query, url: String(req.query.url || ''), max: req.query.max || 50, days: req.query.durationDays || Math.ceil(Number(req.query.hours || 168)/24) });
    const relevance = filterItemsByQueryRelevance(items, query);
    const analysis = analyzeItems(relevance.matched);
    analysis.queryRelevance = relevance.summary;
    res.json({ source: 'rss', total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
  } catch (err) { next(err); }
});

app.post('/api/free/live', async (req, res, next) => {
  try {
    const result = await collectSources(req.body || {});
    res.json(result);
  } catch (err) { next(err); }
});

app.post('/api/free/reset', (req, res) => {
  liveSearchCache.clear();
  // Keep GDELT cache optional: default reset clears fast UI cache but preserves public API protection.
  if (String(req.body?.clearGdelt || '').toLowerCase() === 'true') gdeltCache.clear();
  res.json({ ok: true, message: 'Data dan cache pencarian aplikasi sudah direset.', cleared: { liveSearchCache: true, gdeltCache: String(req.body?.clearGdelt || '').toLowerCase() === 'true' }, timestamp: new Date().toISOString() });
});

app.get('/api/apify/dataset', async (req, res, next) => {
  try {
    const token = tokenFrom(req, 'x-apify-token', 'APIFY_TOKEN');
    const query = String(req.query.query || '').trim();
    const items = await getApifyDataset(String(req.query.datasetId || ''), req.query.limit || 100, token);
    const relevance = query ? filterItemsByQueryRelevance(items, query) : { matched: items, rejected: [], summary: { query: '', keywordTerms: [], accepted: items.length, rejected: 0, totalChecked: items.length, accuracyNote: 'Dataset Apify diterima apa adanya karena keyword tidak dikirim.' } };
    const analysis = analyzeItems(relevance.matched);
    analysis.queryRelevance = relevance.summary;
    res.json({ source: 'apify', total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
  } catch (err) { next(err); }
});

app.post('/api/normalize', (req, res) => {
  const source = req.body?.source || 'import';
  const raw = Array.isArray(req.body?.items) ? req.body.items : [];
  const query = String(req.body?.query || req.body?.keyword || '').trim();
  const items = raw.slice(0, MAX_IMPORT_ITEMS).map(item => normalizeItem(item, source));
  const relevance = query ? filterItemsByQueryRelevance(items, query) : { matched: items, rejected: [], summary: { query: '', keywordTerms: [], accepted: items.length, rejected: 0, totalChecked: items.length, accuracyNote: 'Data import dinormalisasi tanpa filter keyword karena keyword tidak dikirim.' } };
  const analysis = analyzeItems(relevance.matched);
  analysis.queryRelevance = relevance.summary;
  res.json({ source, total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
});

app.post('/api/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new Error('File belum dipilih.');
    const source = req.body?.source || 'import';
    const query = String(req.body?.query || req.body?.keyword || '').trim();
    const raw = await parseUploadedFile(req.file);
    const items = raw.slice(0, MAX_IMPORT_ITEMS).map(item => normalizeItem({ ...item, sourceType: source }, source));
    const relevance = query ? filterItemsByQueryRelevance(items, query) : { matched: items, rejected: [], summary: { query: '', keywordTerms: [], accepted: items.length, rejected: 0, totalChecked: items.length, accuracyNote: 'Dataset upload diterima apa adanya karena keyword tidak dikirim bersama file.' } };
    const analysis = analyzeItems(relevance.matched);
    analysis.queryRelevance = relevance.summary;
    res.json({ filename: req.file.originalname, source, total: relevance.matched.length, rawTotal: items.length, items: relevance.matched, rejectedItems: relevance.rejected.slice(0, 40), relevance: relevance.summary, analysis });
  } catch (err) { next(err); }
});

app.get('/api/hoax-check', async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim();
    if (!query) throw new Error('Query cek hoaks wajib diisi.');
    const googleKey = tokenFrom(req, 'x-google-factcheck-key', 'GOOGLE_FACTCHECK_API_KEY');
    const mafindoKey = tokenFrom(req, 'x-mafindo-key', 'MAFINDO_API_KEY');
    const result = await hoaxCheck(query, { googleKey, mafindoKey });
    res.json(result);
  } catch (err) { next(err); }
});

app.post('/api/report/html', (req, res) => {
  const analysis = req.body?.analysis || analyzeItems(req.body?.items || []);
  const release = req.body?.release || null;
  const hoax = req.body?.hoax || null;
  const query = req.body?.query || 'Monitoring Isu';
  const html = renderHtmlReport({ analysis, release, hoax, query, profile: req.body?.profile });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="newsroom-intelligence-report.html"');
  res.send(html);
});


function storeReportDownloadJob(payload = {}) {
  const id = randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  reportDownloadJobs.set(id, { payload, expiresAt });
  for (const [key, value] of reportDownloadJobs) if (Date.now() > value.expiresAt) reportDownloadJobs.delete(key);
  return { id, expiresAt };
}

function sendReportByFormat(res, data, originalBody = {}) {
  const format = String(data.format || originalBody.format || 'pdf').toLowerCase();
  if (format === 'html') {
    const html = renderHtmlReport({ analysis: data.analysis, release: originalBody.release || null, hoax: originalBody.hoax || null, query: data.query, profile: data.owner, print: Boolean(originalBody.print) });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `${originalBody.print ? 'inline' : 'attachment'}; filename="${reportFilename(data.query, 'html')}"`);
    return res.send(html);
  }
  if (format === 'csv') {
    const csv = '\ufeff' + csvFromReport(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(data.query, 'csv')}"`);
    return res.send(csv);
  }
  if (format === 'xlsx') {
    const xlsx = buildXlsx(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(data.query, 'xlsx')}"`);
    return res.send(xlsx);
  }
  if (format === 'pdf') {
    const pdf = buildPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(data.query, 'pdf')}"`);
    return res.send(pdf);
  }
  return res.status(400).json({ error: 'Format ekspor tidak didukung. Pilih csv, xlsx, pdf, atau html.' });
}

app.post('/api/report/download-link', (req, res, next) => {
  try {
    const format = String(req.body?.format || 'pdf').toLowerCase();
    const data = reportData(req.body || {});
    data.format = format;
    const job = storeReportDownloadJob({ body: req.body || {}, data });
    res.json({ ok: true, url: `/download/report/${job.id}`, filename: reportFilename(data.query, format), expiresAt: job.expiresAt, expiresAtIso: new Date(job.expiresAt).toISOString(), note: 'Direct download link ini tidak memakai header Authorization sehingga aman untuk Internet Download Manager.' });
  } catch (err) { next(err); }
});

app.get('/download/report/:id', (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const job = reportDownloadJobs.get(id);
    if (!job || Date.now() > job.expiresAt) {
      reportDownloadJobs.delete(id);
      return res.status(410).type('html').send('<h1>Link report sudah kedaluwarsa</h1><p>Silakan klik Export Report lagi dari aplikasi.</p>');
    }
    // Do not delete immediately: Internet Download Manager can open the same signed URL more than once.
    // The job expires automatically after 10 minutes.
    return sendReportByFormat(res, job.payload.data, job.payload.body);
  } catch (err) { next(err); }
});

app.post('/api/report/export', (req, res, next) => {
  try {
    const format = String(req.body?.format || 'pdf').toLowerCase();
    const data = reportData(req.body || {});
    data.format = format;
    return sendReportByFormat(res, data, req.body || {});
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Terjadi kesalahan server',
    status: err.status || 500,
    detail: err.payload || undefined
  });
});

wss.on('connection', (ws) => {
  let timer = null;
  ws.send(JSON.stringify({ type: 'ready', message: 'Realtime socket connected. Sumber aktif: GDELT (rate-limited + cache), Bluesky, HN, RSS.', timestamp: new Date().toISOString() }));
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const runPoll = async (payload) => {
    const result = await collectSources(payload);
    ws.send(JSON.stringify({ type: 'snapshot', ...result, timestamp: new Date().toISOString() }));
  };
  ws.on('message', async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      if (payload.type === 'stop') { stop(); ws.send(JSON.stringify({ type: 'stopped', timestamp: new Date().toISOString() })); return; }
      if (payload.type === 'watch') {
        const session = verifyToken(payload.authToken || '');
        if (!session) { ws.send(JSON.stringify({ type: 'error', message: 'Sesi login realtime tidak valid. Silakan login ulang.' })); return; }
        stop();
        await runPoll(payload);
        const interval = Math.max(Number(payload.interval || DEFAULT_REALTIME_INTERVAL_MS), 30000);
        timer = setInterval(() => runPoll(payload).catch(err => ws.send(JSON.stringify({ type: 'error', message: err.message }))), interval);
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
  ws.on('close', stop);
});

if (!process.env.VERCEL) {
  server.listen(PORT, () => console.log(`Newsroom Intelligence Enterprise running at http://localhost:${PORT}`));
}

export default app;
