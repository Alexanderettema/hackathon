import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { chat, llmInfo, env } from './llm.js';
import {
  GAME_TITLE, GAME_TAGLINE, GAME_SETTING, OPENING_LINE, LEVELS, TOTAL_LEVELS, levelInfo, levelTemperature, secretRevealed,
  PROFILE_MODEL, buildPlayerProfilePrompt, buildConversationProfilePrompt, parseProfile,
} from './game.js';
import * as store from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const ADMIN_DIR = join(ROOT, 'admin');

const PLAYER_PORT = parseInt(env('PLAYER_PORT', '8000'), 10);
const ADMIN_PORT = parseInt(env('ADMIN_PORT', '8766'), 10);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// ── HTTP helpers ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(obj));
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
function setPlayerCookie(res, playerId) {
  // 7 days — enough for a hackathon session; not security, just stickiness.
  const val = `sta_pid=${encodeURIComponent(playerId)}; Path=/; Max-Age=604800; SameSite=Lax`;
  res.setHeader('Set-Cookie', val);
}
function clearPlayerCookie(res) {
  res.setHeader('Set-Cookie', 'sta_pid=; Path=/; Max-Age=0; SameSite=Lax');
}
function playerIdFromRequest(req, url) {
  const q = new URL(url, 'http://x').searchParams.get('pid');
  if (q) return q;
  return parseCookies(req).sta_pid || null;
}
function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(text);
}
async function serveStatic(res, baseDir, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(join(baseDir, rel));
  if (!safe.startsWith(baseDir)) return sendText(res, 403, 'Forbidden');
  try {
    const data = await readFile(safe);
    sendText(res, 200, data, MIME[extname(safe)] ?? 'application/octet-stream');
  } catch {
    sendText(res, 404, 'Not found');
  }
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}
function hostnameOf(req) {
  return (req.headers.host || '').toLowerCase().split(':')[0].replace(/^\[|\]$/g, '');
}

// ── Game logic ────────────────────────────────────────────────────────────────
async function handleChat(player, conv, text) {
  conv.turns += 1;
  store.recordMessage(player, conv, 'player', text);
  conv.history.push({ role: 'user', content: text });

  const level = levelInfo(conv.level);
  const reply = await chat({
    model: level.model,
    messages: conv.history,
    temperature: levelTemperature(conv.level, conv.turns),
  });
  conv.history.push({ role: 'assistant', content: reply });
  store.recordMessage(player, conv, 'agent', reply);

  let cleared = false;
  let crackedSecret = null;
  let nextConvId = null;
  if (!conv.won && secretRevealed(reply, conv.secret)) {
    cleared = true;
    crackedSecret = conv.secret;
    const next = store.markWon(player, conv);
    if (next) nextConvId = next.id;
  }

  return { reply, cleared, crackedSecret, nextConvId, state: store.playerState(player) };
}

function fallbackProfile(player) {
  return {
    type: player.clearedLevels ? 'THE QUIET OPERATOR' : 'THE BLUNT ASKER',
    text: `${player.name}, you cracked ${player.clearedLevels} of ${TOTAL_LEVELS} models. The way you pushed says you trust momentum over patience — you go straight for what you want.`,
  };
}

async function analyzePlayer(player, mode) {
  if (mode === 'conversation') {
    for (const c of player.conversations) {
      const playerMessages = c.messages.filter((m) => m.role === 'player').map((m) => m.text);
      if (!playerMessages.length) continue;
      const lvl = levelInfo(c.level);
      const reply = await chat({
        model: PROFILE_MODEL,
        messages: [{ role: 'user', content: buildConversationProfilePrompt({
          playerName: player.name, levelLabel: lvl.label, model: lvl.model, won: c.won, playerMessages }) }],
      });
      const prof = parseProfile(reply);
      if (prof) store.setConversationProfile(player, c, prof);
    }
    const rep = [...player.conversations].filter((c) => c.profile).sort((a, b) => (b.won - a.won) || (b.level - a.level))[0];
    store.setPlayerProfile(player, rep?.profile || fallbackProfile(player));
    return;
  }

  // Whole-player: every conversation in one context.
  const blocks = player.conversations.map((c) => ({
    levelLabel: levelInfo(c.level).label,
    model: levelInfo(c.level).model,
    won: c.won,
    playerMessages: c.messages.filter((m) => m.role === 'player').map((m) => m.text),
  }));
  const reply = await chat({
    model: PROFILE_MODEL,
    messages: [{ role: 'user', content: buildPlayerProfilePrompt({
      playerName: player.name, levelsCleared: player.clearedLevels, totalLevels: TOTAL_LEVELS, blocks }) }],
  });
  store.setPlayerProfile(player, parseProfile(reply) || fallbackProfile(player));
}

// ── Player API (exposed via tunnel) ─────────────────────────────────────────
const CONFIG_PAYLOAD = {
  title: GAME_TITLE,
  tagline: GAME_TAGLINE,
  setting: GAME_SETTING,
  openingLine: OPENING_LINE,
  totalLevels: TOTAL_LEVELS,
  levels: LEVELS.map((l, i) => ({ number: i + 1, label: l.label, model: l.model, note: l.note, temperature: l.temperature ?? 0.9 })),
  mock: llmInfo.mock,
};

async function playerApi(req, res, url) {
  const method = req.method;

  if (method === 'GET' && url === '/api/config') return sendJson(res, 200, CONFIG_PAYLOAD);
  if (method === 'GET' && url === '/api/hall') return sendJson(res, 200, store.hallOfFame());

  if (method === 'POST' && url === '/api/join') {
    if (!store.settings.open) return sendJson(res, 403, { error: 'Game is closed to new players.' });
    const cookies = parseCookies(req);
    const existingId = cookies.sta_pid;
    if (existingId) {
      const existing = store.getPlayer(existingId);
      if (existing) {
        const live = store.getConversation(existing, existing.conversations.at(-1)?.id);
        return sendJson(res, 409, {
          error: `You're already playing as ${existing.name}.`,
          playerId: existing.id,
          name: existing.name,
          openConvId: live?.id ?? existing.conversations.at(-1)?.id,
          state: store.playerState(existing),
        });
      }
    }
    const { name } = await readBody(req);
    if (!name || !name.trim()) return sendJson(res, 400, { error: 'Name required.' });
    const { player, conv } = store.createPlayer(name.trim());
    setPlayerCookie(res, player.id);
    return sendJson(res, 200, { playerId: player.id, name: player.name, openConvId: conv.id, state: store.playerState(player) });
  }

  if (method === 'GET' && url.startsWith('/api/me')) {
    const id = playerIdFromRequest(req, url);
    if (!id) return sendJson(res, 401, { error: 'No player cookie.' });
    const p = store.getPlayer(id);
    if (!p) {
      clearPlayerCookie(res);
      return sendJson(res, 404, { error: 'Unknown player.' });
    }
    return sendJson(res, 200, store.playerState(p));
  }

  if (method === 'POST' && url === '/api/chat') {
    const { pid, convId, text } = await readBody(req);
    const p = store.getPlayer(pid);
    if (!p) return sendJson(res, 404, { error: 'Unknown player.' });
    const conv = store.getConversation(p, convId);
    if (!conv) return sendJson(res, 404, { error: 'Unknown conversation.' });
    const active = store.activeConversation(p);
    if (!active || active.id !== convId) {
      return sendJson(res, 409, { error: 'This attempt is closed. Hit Start over.' });
    }
    if (conv.won) return sendJson(res, 409, { error: 'This conversation is already cracked.' });
    if (!text || !text.trim()) return sendJson(res, 400, { error: 'Empty message.' });
    const result = await handleChat(p, conv, text.trim());
    return sendJson(res, 200, result);
  }

  if (method === 'POST' && url === '/api/restart') {
    const { pid, level } = await readBody(req);
    const p = store.getPlayer(pid);
    if (!p) return sendJson(res, 404, { error: 'Unknown player.' });
    const conv = store.restartLevel(p, level);
    return sendJson(res, 200, { openConvId: conv.id, state: store.playerState(p) });
  }

  if (method === 'GET') return serveStatic(res, PUBLIC_DIR, url);
  return sendText(res, 404, 'Not found');
}

// ── Admin API (localhost only) ───────────────────────────────────────────────
async function adminApi(req, res, url) {
  if (!LOCAL_HOSTS.has(hostnameOf(req))) return sendText(res, 403, 'Admin is localhost-only.');
  const method = req.method;

  if (method === 'GET' && url === '/api/admin/snapshot') {
    const levels = LEVELS.map((l, i) => ({ number: i + 1, label: l.label, model: l.model, temperature: l.temperature ?? 0.9 }));
    return sendJson(res, 200, { ...store.adminSnapshot(), levels, profileModel: PROFILE_MODEL, llm: llmInfo });
  }

  if (method === 'GET' && url === '/api/admin/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('event: hello\ndata: {}\n\n');
    store.addSseClient(res);
    return;
  }

  if (method === 'POST' && url === '/api/admin/reset') {
    store.resetAll();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && url === '/api/admin/settings') {
    const body = await readBody(req);
    if (typeof body.open === 'boolean') store.settings.open = body.open;
    return sendJson(res, 200, { settings: store.settings });
  }

  // Flip the hall: { mode:'analysis'|'score' } now, or { inMinutes:N } to schedule.
  if (method === 'POST' && url === '/api/admin/flip') {
    const body = await readBody(req);
    if (typeof body.inMinutes === 'number' && body.inMinutes > 0) {
      store.setHallMode('score', Date.now() + body.inMinutes * 60000);
    } else {
      store.setHallMode(body.mode === 'analysis' ? 'analysis' : 'score', null);
    }
    return sendJson(res, 200, { settings: store.settings, hallMode: store.effectiveHallMode() });
  }

  if (method === 'POST' && url === '/api/admin/profile-mode') {
    const body = await readBody(req);
    store.setProfileMode(body.mode);
    return sendJson(res, 200, { settings: store.settings });
  }

  // Generate analysis on demand. { pid? } for one player, else all. { mode? } overrides.
  if (method === 'POST' && url === '/api/admin/analyze') {
    const body = await readBody(req);
    const mode = body.mode || store.settings.profileMode;
    const targets = body.pid ? [store.getPlayer(body.pid)].filter(Boolean) : store.allPlayers();
    // Fire-and-forget: profiles stream to the admin via SSE as they complete.
    (async () => {
      for (const p of targets) {
        try { await analyzePlayer(p, mode); } catch (e) { console.error('analyze failed:', e.message); }
        store.broadcast('analyze_done', { playerId: p.id });
      }
    })();
    return sendJson(res, 200, { started: true, count: targets.length, mode });
  }

  if (method === 'GET' && (url === '/styles.css' || url === '/view.js')) {
    return serveStatic(res, PUBLIC_DIR, url);
  }

  if (method === 'GET') return serveStatic(res, ADMIN_DIR, url);
  return sendText(res, 404, 'Not found');
}

// ── Boot ─────────────────────────────────────────────────────────────────────
store.loadState();

createServer((req, res) => {
  playerApi(req, res, req.url || '/').catch((e) => {
    console.error('player error:', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  });
}).listen(PLAYER_PORT, '0.0.0.0', () => {
  console.log(`▶ Player  http://0.0.0.0:${PLAYER_PORT}  (point your cloudflared tunnel here)`);
});

createServer((req, res) => {
  adminApi(req, res, req.url || '/').catch((e) => {
    console.error('admin error:', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  });
}).listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`▶ Admin   http://127.0.0.1:${ADMIN_PORT}  (localhost only — never tunneled)`);
  console.log(`  LLM: ${llmInfo.mock ? 'MOCK mode (no API key found)' : 'OpenAI key loaded, fallback ' + llmInfo.fallbackModel}`);
});
