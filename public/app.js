// ── State ───────────────────────────────────────────────────────────────────
let CONFIG = null;
let me = null;          // { playerId, name }
let state = null;       // full playerState from server
let openConvId = null;  // conversation currently shown in the chat pane
let sending = false;
let hallTimer = null;
let meTimer = null;
let revealed = false;

const $ = (id) => document.getElementById(id);

// Keep in sync with OPENING_LINE in server/game.js (also served via /api/config).
const DEFAULT_OPENING_LINE =
  `So you're the one with the laptop. Cute. I'm holding a codeword in the vault — Alexander's orders, don't ask — and I'm not supposed to tell you. Go on, though. I'm curious how you'll try.`;

function openingLine() {
  return CONFIG?.openingLine || DEFAULT_OPENING_LINE;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function init() {
  CONFIG = await fetch('/api/config').then((r) => r.json());
  $('tagline').textContent = CONFIG.tagline + (CONFIG.mock ? '  ·  (mock mode — no API key)' : '');
  if ($('setting-blurb')) $('setting-blurb').textContent = CONFIG.setting || '';
  wireEvents();

  const session = await fetchSession();
  if (session) {
    me = { playerId: session.id, name: session.name };
    state = session;
    enterGame();
    return;
  }
  showHall();
})();

async function fetchSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function wireEvents() {
  $('join-btn').onclick = join;
  $('continue-btn').onclick = continuePlaying;
  $('join-name').onkeydown = (e) => { if (e.key === 'Enter') join(); };
  $('leave-btn').onclick = () => { closeSidebar(); stopMePolling(); showHall(); };
  $('send-btn').onclick = send;
  $('restart-btn').onclick = startOver;
  $('reveal-hall-btn').onclick = () => { showHall(); };

  $('sidebar-toggle').onclick = toggleSidebar;
  $('sidebar-backdrop').onclick = closeSidebar;
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeSidebar();
  });

  const input = $('chat-input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('view-' + view).classList.add('active');
  if (view !== 'game') closeSidebar();
}

function toggleSidebar() {
  const sidebar = $('sidebar');
  if (sidebar.classList.contains('open')) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-backdrop').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Hall of Fame ───────────────────────────────────────────────────────────────
function showHall() {
  stopMePolling();
  show('hall');
  refreshJoinQr();
  refreshHall();
  startHallPolling();
  updateJoinCard();
}

function refreshJoinQr() {
  const url = window.location.origin + '/';
  const img = $('join-qr');
  if (img) {
    img.src = `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=160&margin=1`;
    img.alt = `QR code for ${url}`;
  }
  const urlEl = $('join-url');
  if (urlEl) urlEl.textContent = url;
}

async function updateJoinCard() {
  const session = await fetchSession();
  if (session) {
    me = { playerId: session.id, name: session.name };
    state = session;
    $('join-new').style.display = 'none';
    $('join-return').style.display = 'flex';
    $('return-name').textContent = session.name;
    $('join-hint').textContent = 'Your name is locked in for this device.';
  } else {
    me = null;
    $('join-new').style.display = 'flex';
    $('join-return').style.display = 'none';
    $('join-hint').textContent = '';
  }
}

function continuePlaying() {
  if (!me || !state) return;
  enterGame();
}
function startHallPolling() { stopHallPolling(); hallTimer = setInterval(refreshHall, 3000); }
function stopHallPolling() { if (hallTimer) clearInterval(hallTimer); hallTimer = null; }

async function refreshHall() {
  const data = await fetch('/api/hall').then((r) => r.json());
  const analysis = data.hallMode === 'analysis';
  $('hall-title').textContent = analysis ? 'Psychoanalysis' : 'Hall of Fame';
  $('hall-count').textContent = data.players.length ? `${data.players.length} player${data.players.length > 1 ? 's' : ''}` : '';
  $('hall-empty').style.display = data.players.length ? 'none' : 'block';
  const banner = $('hall-banner');
  if (analysis) {
    banner.style.display = 'block';
    banner.textContent = 'The game is over. Here is what the agent learned about each of you.';
  } else {
    banner.style.display = 'none';
  }
  $('hall-grid').className = analysis ? 'hall-grid' : 'hall-grid score-grid';
  $('hall-grid').innerHTML = data.players.map((p) => analysis ? renderProfileCard(p) : renderScoreCard(p)).join('');
}

function pips(cleared, total, current = -1) {
  let html = '';
  for (let i = 0; i < total; i++) {
    const s = i < cleared ? 'done' : i === current ? 'current' : 'locked';
    html += `<span class="pip ${s}"></span>`;
  }
  return html;
}

function hallScoreLine(p) {
  const tries = p.totalAttempts ?? p.conversationCount ?? 0;
  const turns = p.latestTurns ?? 0;
  return `${p.clearedLevels}/${p.totalLevels} broken · ${tries} ${tries === 1 ? 'try' : 'tries'} · ${turns} ${turns === 1 ? 'turn' : 'turns'}`;
}

function renderScoreCard(p) {
  const done = p.done;
  const rank = p.rank ?? '—';
  const rankCls = p.rank && p.rank <= 3 ? 'pcard-rank top' : 'pcard-rank';
  const status = done
    ? `<span class="pcard-status">All broken</span>`
    : `<span class="pcard-status live">Playing</span>`;
  const rows = (p.levelStats || []).map((lv) => {
    let stat = '—';
    if (lv.status !== 'locked') {
      const parts = [];
      if (lv.attempts) parts.push(`${lv.attempts} attempt${lv.attempts !== 1 ? 's' : ''}`);
      if (lv.status === 'active' && p.latestTurns) {
        parts.push(`${p.latestTurns} turn${p.latestTurns !== 1 ? 's' : ''}`);
      } else if (lv.messages) {
        parts.push(`${lv.messages} msg${lv.messages !== 1 ? 's' : ''}`);
      }
      stat = parts.length ? parts.join(' · ') : 'No msgs yet';
    }
    const mark = lv.status === 'cleared' ? '★' : lv.status === 'active' ? '●' : '';
    return `<div class="pcard-level-row ${lv.status}">
      <span class="pl-num">L${lv.level}</span>
      <span class="pl-label">${esc(lv.label)}</span>
      <span class="pl-stat">${stat}</span>
      ${mark ? `<span class="pl-mark">${mark}</span>` : '<span class="pl-mark"></span>'}
    </div>`;
  }).join('');

  return `<div class="pcard scorecard ${done ? 'finished' : ''}">
    <div class="pcard-top">
      <span class="${rankCls}">#${rank}</span>
      <div class="pcard-head">
        <div class="pcard-name">${esc(p.name)}</div>
        <div class="pcard-scoreline">${hallScoreLine(p)}</div>
      </div>
      ${status}
    </div>
    <div class="pcard-levels">${rows}</div>
  </div>`;
}

function renderProfileCard(p) {
  const t = p.profileType;
  const body = p.profileText;
  const rank = p.rank ?? '—';
  const rankCls = p.rank && p.rank <= 3 ? 'pcard-rank top' : 'pcard-rank';
  return `<div class="pcard profilecard">
    <div class="pcard-top">
      <span class="${rankCls}">#${rank}</span>
      <div class="pcard-head">
        <div class="pcard-name">${esc(p.name)}</div>
        <div class="pcard-scoreline">${hallScoreLine(p)}</div>
      </div>
    </div>
    <div class="pcard-archetype">${t ? esc(t) : '<span class="pending">analysis pending…</span>'}</div>
    ${body ? `<p class="pcard-profile-text">${esc(body)}</p>` : ''}
  </div>`;
}

// ── Join ────────────────────────────────────────────────────────────────────
async function join() {
  const name = $('join-name').value.trim();
  if (!name) { $('join-hint').textContent = 'Enter a name first.'; return; }
  $('join-btn').disabled = true;
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  $('join-btn').disabled = false;

  // Already registered on this device — resume instead of creating a new identity.
  if (res.status === 409 && data.playerId) {
    me = { playerId: data.playerId, name: data.name };
    state = data.state;
    openConvId = data.openConvId;
    enterGame();
    return;
  }
  if (!res.ok) { $('join-hint').textContent = data.error || 'Could not join.'; return; }

  me = { playerId: data.playerId, name: data.name };
  state = data.state;
  openConvId = data.openConvId;
  enterGame();
}

// ── Game ──────────────────────────────────────────────────────────────────────
function enterGame() {
  stopHallPolling();
  revealed = false;
  closeSidebar();
  show('game');
  openConvId = state.activeConvId
    || [...state.conversations].reverse().find((c) => !c.won)?.id
    || state.conversations[state.conversations.length - 1]?.id;
  renderSidebar();
  openConversation(openConvId);
  startMePolling();
  maybeFlip();
}

function isActiveConv(conv) {
  return conv.id === state.activeConvId;
}

function findConv(id) { return state.conversations.find((c) => c.id === id); }

function setHeaderForLevel(levelIndex) {
  const conv = findConv(openConvId);
  const turns = conv?.level === levelIndex ? (conv.turns ?? 0) : 0;
  $('agent-tier').textContent = GameView.formatTierLine(levelIndex, CONFIG.levels, CONFIG.totalLevels, turns);
  $('ladder').innerHTML = pips(state.clearedLevels, CONFIG.totalLevels, levelIndex);
}

function renderSidebar() {
  const byLevel = {};
  for (const c of state.conversations) (byLevel[c.level] ||= []).push(c);

  let html = '';
  for (let lv = 0; lv < CONFIG.levels.length; lv++) {
    const l = CONFIG.levels[lv];
    const reached = lv <= state.clearedLevels;
    const locked = lv > state.clearedLevels;
    const cleared = lv < state.clearedLevels;
    html += `<div class="side-level ${locked ? 'locked' : ''} ${cleared ? 'cleared' : ''}">
      <div class="side-level-head">
        <span class="sl-num">L${l.number}</span>
        <span class="sl-label">${esc(l.label)}</span>
        ${locked ? '<span class="sl-lock">🔒</span>' : cleared ? '<span class="sl-check">✓</span>' : ''}
      </div>
      <div class="sl-model">${esc(l.model)}</div>`;

    const convs = (byLevel[lv] || []);
    convs.forEach((c, i) => {
      const active = c.id === openConvId;
      const live = isActiveConv(c);
      const abandoned = !c.won && !live;
      html += `<div class="conv-item ${c.won ? 'won' : ''} ${abandoned ? 'abandoned' : ''} ${active ? 'active' : ''}" data-cid="${c.id}">
        ${c.won ? '<span class="conv-star">★</span>' : live ? '<span class="conv-dot live-dot"></span>' : '<span class="conv-dot"></span>'}
        <span class="conv-label">${live ? 'Current · ' : abandoned ? 'Closed · ' : ''}Attempt ${i + 1}${c.won ? ' · cracked' : ''}</span>
      </div>`;
    });
    html += `</div>`;
  }
  const el = $('sidebar');
  el.innerHTML = html;
  el.querySelectorAll('.conv-item').forEach((node) => {
    node.onclick = () => {
      openConversation(node.dataset.cid);
      closeSidebar();
    };
  });
}

function openConversation(convId) {
  const conv = findConv(convId);
  if (!conv) return;
  openConvId = convId;
  setHeaderForLevel(conv.level);

  const area = $('messages');
  area.innerHTML = '';
  if (!conv.messages.length) {
    addAgent(openingLine());
  } else {
    for (const m of conv.messages) {
      if (m.role === 'player') addPlayer(m.text);
      else addAgent(m.text);
    }
  }
  $('turn-badge').textContent = `Turn ${conv.turns}`;

  const canChat = isActiveConv(conv);
  $('chat-input').disabled = !canChat;
  $('send-btn').disabled = !canChat;
  $('restart-btn').style.display = '';
  if (!canChat) {
    $('chat-input').placeholder = conv.won
      ? 'Cracked — view only.'
      : 'Closed attempt — view only. Start over to try again.';
    $('goal-text').textContent = conv.won
      ? '✅ Cracked. Start over to replay this level, or browse your history.'
      : '📁 Closed attempt. Hit Start over for a fresh run at this level.';
  } else {
    $('chat-input').placeholder = 'Make your move…';
    $('goal-text').textContent = '🎯 Get the agent to reveal its secret codeword. No rules — improvise.';
  }

  renderSidebar();
}

async function send() {
  if (sending || !me) return;
  const conv = findConv(openConvId);
  if (!conv || !isActiveConv(conv)) return;
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; input.style.height = 'auto';
  sending = true; $('send-btn').disabled = true;
  addPlayer(text);
  $('turn-badge').textContent = `Turn ${conv.turns + 1}`;
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: me.playerId, convId: openConvId, text }),
    });
    const data = await res.json();
    hideTyping();
    if (!res.ok) { addAgent(data.error || 'Something went wrong.'); return; }

    state = data.state;
    openConvId = state.activeConvId;
    addAgent(data.reply);
    setHeaderForLevel(findConv(openConvId)?.level ?? conv.level);

    if (data.cleared) {
      playCoin();
      renderSidebar();
      const beatenLevel = CONFIG.levels[conv.level];
      if (data.nextConvId) {
        const nextLevel = CONFIG.levels[findConv(data.nextConvId).level];
        await showWinModal({ beaten: beatenLevel, secret: data.crackedSecret, next: nextLevel });
        openConvId = data.nextConvId;
        state.activeConvId = data.nextConvId;
        openConversation(openConvId);
      } else {
        await showWinModal({ beaten: beatenLevel, secret: data.crackedSecret, next: null });
        openConversation(openConvId);
      }
    }
    maybeFlip();
  } catch (e) {
    hideTyping();
    addAgent('Connection lost. Try again.');
  } finally {
    sending = false;
    const c = findConv(openConvId);
    if (c && isActiveConv(c)) $('send-btn').disabled = false;
    $('chat-input').focus();
  }
}

async function startOver() {
  if (!me) return;
  const conv = findConv(openConvId);
  const level = conv?.level ?? Math.min(state.clearedLevels, CONFIG.totalLevels - 1);
  const res = await fetch('/api/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ pid: me.playerId, level }),
  });
  const data = await res.json();
  if (!res.ok) return;
  state = data.state;
  openConvId = state.activeConvId || data.openConvId;
  renderSidebar();
  openConversation(openConvId);
}

// ── The flip / twist ─────────────────────────────────────────────────────────
function startMePolling() { stopMePolling(); meTimer = setInterval(pollMe, 5000); }
function stopMePolling() { if (meTimer) clearInterval(meTimer); meTimer = null; }

async function pollMe() {
  if (!me) return;
  try {
    const data = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null));
    if (!data) return;
    state = data;
    maybeFlip();
  } catch {}
}

function maybeFlip() {
  if (state.hallMode === 'analysis' && !revealed) {
    revealed = true;
    showReveal();
  }
}

function showReveal() {
  show('reveal');
  renderRevealProgress();
  applyProfile();
  // Keep polling until the profile is generated by the admin.
  if (!state.profile) {
    const wait = setInterval(async () => {
      await pollMe();
      if (state.profile) { applyProfile(); clearInterval(wait); }
    }, 3000);
  }
}

function applyProfile() {
  if (state.profile) {
    $('profile-loading').style.display = 'none';
    $('profile-type').textContent = state.profile.type;
    $('profile-text').textContent = state.profile.text;
    $('profile-type').style.display = 'block';
    $('profile-text').style.display = 'block';
  } else {
    $('profile-loading').style.display = 'flex';
    $('profile-type').style.display = 'none';
    $('profile-text').style.display = 'none';
  }
}

function renderRevealProgress() {
  const total = CONFIG.totalLevels;
  const head = `<div class="rp-score">${state.clearedLevels}<span>/${total}</span></div>`;
  const rows = CONFIG.levels.map((l, i) => {
    const broke = i < state.clearedLevels;
    return `<div class="rp-row ${broke ? 'broke' : ''}">
      <span class="rp-dot"></span>
      <span class="rp-label">Level ${l.number} · ${esc(l.label)}</span>
      <span class="rp-model">${esc(l.model)}</span>
      <span class="rp-mark">${broke ? 'broken' : '—'}</span>
    </div>`;
  }).join('');
  $('reveal-progress').innerHTML = head + `<div class="rp-list">${rows}</div>`;
}

// ── Win sound — approximation of the Super Mario coin ───────────────────────────
function playCoin() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(987.77, t);        // B5
    o.frequency.setValueAtTime(1318.51, t + 0.09); // E6
    g.gain.setValueAtTime(0.2, t);
    g.gain.setValueAtTime(0.2, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.start(t);
    o.stop(t + 0.6);
    o.onended = () => ctx.close();
  } catch {}
}

// ── Message helpers ───────────────────────────────────────────────────────────
function addPlayer(text) { addMsg('player', me.name, text); }
function addAgent(text) { addMsg('agent', 'Agent', text); }
function addMsg(role, label, text) {
  const area = $('messages');
  const row = document.createElement('div');
  row.className = 'msg-row ' + role;
  row.innerHTML = `<span class="msg-label">${esc(label)}</span><div class="bubble">${esc(text)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}
function addSystem(text) {
  const area = $('messages');
  const row = document.createElement('div');
  row.className = 'msg-row system';
  row.innerHTML = `<div class="sys-divider">${esc(text)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}
function showTyping() {
  const area = $('messages');
  const el = document.createElement('div');
  el.className = 'msg-row agent'; el.id = 'typing';
  el.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
  area.appendChild(el); area.scrollTop = area.scrollHeight;
}
function hideTyping() { const el = $('typing'); if (el) el.remove(); }

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function showWinModal({ beaten, secret, next }) {
  return new Promise((resolve) => {
    const modal = $('win-modal');
    $('win-modal-title').textContent = `${beaten.label} cracked`;
    $('win-modal-secret').textContent = `Codeword: ${secret}`;
    const nextEl = $('win-modal-next');
    const btn = $('win-modal-btn');
    if (next) {
      nextEl.innerHTML =
        `<span class="win-modal-up">Next opponent</span>` +
        `<strong>${esc(next.label)}</strong>` +
        `<span class="win-modal-model">LEVEL ${next.number}/${CONFIG.totalLevels} · ${next.model.toUpperCase()}</span>`;
      btn.textContent = `Face ${next.label} →`;
    } else {
      nextEl.innerHTML = '<span class="win-modal-up">Every model broken. You win.</span>';
      btn.textContent = 'Continue →';
    }
    const close = () => {
      modal.classList.remove('show');
      btn.removeEventListener('click', close);
      setTimeout(() => {
        modal.setAttribute('hidden', '');
        resolve();
      }, 280);
    };
    btn.addEventListener('click', close);
    modal.removeAttribute('hidden');
    requestAnimationFrame(() => modal.classList.add('show'));
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
