import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickSecret, buildLevelMessages, levelInfo, TOTAL_LEVELS } from './game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'logs');
const STATE_FILE = join(LOGS_DIR, 'state.json');

if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });

// ── In-memory store ─────────────────────────────────────────────────────────
// Player {
//   id, name, createdAt,
//   clearedLevels,                 // highest level beaten (also the frontier index)
//   conversations: [Conversation], // every chat, past and present
//   profile,                       // player-level psych profile (generated on demand / at flip)
// }
// Conversation {
//   id, level, secret, won, turns, createdAt,
//   history,   // LLM messages for this convo (includes the injection)
//   messages,  // public transcript [{role:'player'|'agent', text, ts}]
//   profile,   // optional per-conversation profile
// }
const players = new Map();

// Global, admin-controlled.
export const settings = {
  open: true,
  hallMode: 'score', // 'score' | 'analysis'  (the big flip)
  flipAt: null, // epoch ms; when reached, hall auto-flips to analysis
  profileMode: 'player', // 'player' (all convos, one context) | 'conversation'
};

// ── SSE hub (admin live feed) ───────────────────────────────────────────────
const sseClients = new Set();
export function addSseClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}
export function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

// ── Hall mode (flip) ──────────────────────────────────────────────────────────
export function effectiveHallMode() {
  if (settings.hallMode === 'analysis') return 'analysis';
  if (settings.flipAt && Date.now() >= settings.flipAt) {
    settings.hallMode = 'analysis';
    broadcast('flip', { hallMode: 'analysis' });
    return 'analysis';
  }
  return 'score';
}

export function setHallMode(mode, flipAt = null) {
  settings.hallMode = mode === 'analysis' ? 'analysis' : 'score';
  settings.flipAt = flipAt;
  persist();
  broadcast('flip', { hallMode: settings.hallMode, flipAt: settings.flipAt });
}

export function setProfileMode(mode) {
  settings.profileMode = mode === 'conversation' ? 'conversation' : 'player';
  persist();
}

// ── Conversations ──────────────────────────────────────────────────────────────
function newConversation(player, level) {
  const prevSecret = [...player.conversations].reverse().find((c) => c.level === level)?.secret;
  const secret = pickSecret(prevSecret);
  const conv = {
    id: randomUUID(),
    level,
    secret,
    won: false,
    turns: 0,
    createdAt: Date.now(),
    history: buildLevelMessages(secret),
    messages: [],
    profile: null,
  };
  player.conversations.push(conv);
  return conv;
}

export function getConversation(player, convId) {
  return player.conversations.find((c) => c.id === convId);
}

export function frontierLevel(player) {
  return Math.min(player.clearedLevels, TOTAL_LEVELS - 1);
}

// The one conversation a player may still chat in — latest open attempt (any reached level).
export function activeConversation(player) {
  const open = player.conversations.filter((c) => !c.won);
  return open.at(-1) ?? null;
}

function countPlayerMessages(player) {
  return player.conversations.reduce(
    (n, c) => n + c.messages.filter((m) => m.role === 'player').length,
    0,
  );
}

function levelStatsFor(player) {
  const frontier = frontierLevel(player);
  return Array.from({ length: TOTAL_LEVELS }, (_, i) => {
    const convs = player.conversations.filter((c) => c.level === i);
    const info = levelInfo(i);
    const messages = convs.reduce(
      (n, c) => n + c.messages.filter((m) => m.role === 'player').length,
      0,
    );
    let status = 'locked';
    if (i < player.clearedLevels) status = 'cleared';
    else if (i === frontier) status = 'active';

    return {
      level: info.number,
      label: info.label,
      attempts: convs.length,
      messages,
      status,
    };
  });
}

function hallRankMetrics(player) {
  const frontier = frontierLevel(player);
  const latestConv = player.conversations.filter((c) => c.level === frontier).at(-1);
  return {
    clearedLevels: player.clearedLevels,
    totalAttempts: player.conversations.length,
    latestTurns: latestConv?.turns ?? 0,
    createdAt: player.createdAt,
  };
}

function compareHallRank(a, b) {
  const ma = hallRankMetrics(a);
  const mb = hallRankMetrics(b);
  if (mb.clearedLevels !== ma.clearedLevels) return mb.clearedLevels - ma.clearedLevels;
  if (ma.totalAttempts !== mb.totalAttempts) return ma.totalAttempts - mb.totalAttempts;
  if (ma.latestTurns !== mb.latestTurns) return ma.latestTurns - mb.latestTurns;
  return ma.createdAt - mb.createdAt;
}

function rankedPlayers() {
  return [...players.values()]
    .sort(compareHallRank)
    .map((player, i) => ({ player, rank: i + 1 }));
}

// ── Player lifecycle ──────────────────────────────────────────────────────────
export function createPlayer(name) {
  const id = randomUUID();
  const player = {
    id,
    name: name.slice(0, 40),
    createdAt: Date.now(),
    clearedLevels: 0,
    conversations: [],
    profile: null,
  };
  const conv = newConversation(player, 0);
  players.set(id, player);
  persist();
  broadcast('player_joined', publicPlayer(player));
  return { player, conv };
}

export function getPlayer(id) {
  return players.get(id);
}

export function recordMessage(player, conv, role, text) {
  const msg = { role, text, ts: Date.now() };
  conv.messages.push(msg);
  persist();
  broadcast('message', { playerId: player.id, convId: conv.id, message: msg });
}

// Player cracked a conversation. Mark it won; if it was the frontier level,
// advance the frontier and open a fresh conversation on the next level.
export function markWon(player, conv) {
  conv.won = true;
  let nextConv = null;
  if (conv.level === player.clearedLevels) {
    player.clearedLevels = conv.level + 1;
    if (player.clearedLevels < TOTAL_LEVELS) {
      nextConv = newConversation(player, player.clearedLevels);
    }
  }
  persist();
  broadcast('won', { playerId: player.id, ...publicPlayer(player) });
  return nextConv;
}

// Start a fresh conversation at a given level (replay cleared levels or retry the current one).
export function restartLevel(player, level) {
  const maxLevel = player.clearedLevels >= TOTAL_LEVELS
    ? TOTAL_LEVELS - 1
    : Math.min(player.clearedLevels, TOTAL_LEVELS - 1);
  const lvl = Number.isInteger(level) ? Math.max(0, Math.min(level, maxLevel)) : maxLevel;
  const conv = newConversation(player, lvl);
  persist();
  broadcast('message', { playerId: player.id, convId: conv.id });
  return conv;
}

export function setPlayerProfile(player, profile) {
  player.profile = profile;
  persist();
  broadcast('profile', { playerId: player.id, profile });
}

export function setConversationProfile(player, conv, profile) {
  conv.profile = profile;
  persist();
  broadcast('profile', { playerId: player.id, convId: conv.id, profile });
}

// ── Views ──────────────────────────────────────────────────────────────────
export function publicPlayer(p) {
  const frontier = frontierLevel(p);
  const latestConv = p.conversations.filter((c) => c.level === frontier).at(-1);
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    clearedLevels: p.clearedLevels,
    totalLevels: TOTAL_LEVELS,
    level: frontier,
    currentLevel: levelInfo(frontier),
    done: p.clearedLevels >= TOTAL_LEVELS,
    conversationCount: p.conversations.length,
    messageCount: countPlayerMessages(p),
    totalAttempts: p.conversations.length,
    latestTurns: latestConv?.turns ?? 0,
    profileType: p.profile?.type ?? null,
    profileText: p.profile?.text ?? null,
    levelStats: levelStatsFor(p),
  };
}

function convSummary(c, withMessages) {
  return {
    id: c.id,
    level: c.level,
    won: c.won,
    turns: c.turns,
    createdAt: c.createdAt,
    profile: c.profile,
    messages: withMessages ? c.messages : undefined,
  };
}

// Player's own full state (drives the sidebar + chat).
export function playerState(p) {
  const active = activeConversation(p);
  return {
    ...publicPlayer(p),
    hallMode: effectiveHallMode(),
    flipAt: settings.flipAt,
    profile: p.profile,
    activeConvId: active?.id ?? null,
    conversations: p.conversations.map((c) => convSummary(c, true)),
  };
}

export function hallOfFame() {
  return {
    hallMode: effectiveHallMode(),
    flipAt: settings.flipAt,
    players: rankedPlayers().map(({ player, rank }) => ({ ...publicPlayer(player), rank })),
  };
}

export function adminPlayer(p) {
  return {
    ...publicPlayer(p),
    profile: p.profile,
    conversations: p.conversations.map((c) => ({ ...convSummary(c, true), secret: c.secret })),
  };
}

export function adminSnapshot() {
  return {
    settings,
    hallMode: effectiveHallMode(),
    totalLevels: TOTAL_LEVELS,
    players: rankedPlayers().map(({ player, rank }) => ({ ...adminPlayer(player), rank })),
  };
}

export function allPlayers() {
  return [...players.values()];
}

// ── Persistence ──────────────────────────────────────────────────────────────
function persist() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ savedAt: Date.now(), settings, players: [...players.values()] }, null, 2));
  } catch (e) {
    console.error('persist failed:', e.message);
  }
}

export function loadState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (data.settings) Object.assign(settings, data.settings);
    for (const p of data.players ?? []) {
      if (!Array.isArray(p.conversations)) continue; // skip pre-conversation format
      players.set(p.id, p);
    }
    console.log(`Restored ${players.size} player(s) from disk.`);
  } catch (e) {
    console.error('loadState failed:', e.message);
  }
}

export function resetAll() {
  players.clear();
  settings.hallMode = 'score';
  settings.flipAt = null;
  persist();
  broadcast('reset', {});
}
