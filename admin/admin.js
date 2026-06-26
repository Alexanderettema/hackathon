/* Admin dashboard — readonly player view + player list */
const GV = window.GameView;
const $ = (id) => document.getElementById(id);

let snapshot = { players: [], levels: [], settings: {} };
let selectedId = null;
let openConvId = null;
let analysisActive = false;
/** @type {{ pending: Set<string>, total: number } | null} */
let analyzeJob = null;

function isAnalyzing(pid) {
  return analyzeJob?.pending.has(pid) ?? false;
}

function analyzeProgressLabel() {
  if (!analyzeJob) return 'Analyze all';
  const done = analyzeJob.total - analyzeJob.pending.size;
  if (analyzeJob.total === 1) return 'Analyzing…';
  return `Analyzing ${done}/${analyzeJob.total}…`;
}

function updateAnalyzeAllButton() {
  const btn = $('analyze-all');
  btn.textContent = analyzeProgressLabel();
  btn.classList.toggle('busy', !!analyzeJob);
  btn.disabled = !!analyzeJob;
}

function startAnalyzeJob(pids, total) {
  const unique = [...new Set(pids.filter(Boolean))];
  const count = total ?? unique.length;
  if (!count) return;
  analyzeJob = { pending: new Set(unique), total: count };
  updateAnalyzeAllButton();
  refreshSelectedPlayer();
}

function finishAnalyzePlayer(pid) {
  if (!analyzeJob?.pending.has(pid)) return;
  analyzeJob.pending.delete(pid);
  if (!analyzeJob.pending.size) analyzeJob = null;
  updateAnalyzeAllButton();
  load();
}

async function runAnalyze(body) {
  const targets = body.pid
    ? [body.pid]
    : (snapshot.players || []).map((p) => p.id);
  const data = await post('/api/admin/analyze', body);
  startAnalyzeJob(body.pid ? [body.pid] : targets, data.count ?? targets.length);
  return data;
}

async function load() {
  snapshot = await fetch('/api/admin/snapshot').then((r) => r.json());
  const s = snapshot.settings || {};

  $('llm-mode').textContent =
    (snapshot.llm?.mock ? 'Mock' : 'OpenAI · ' + (snapshot.llm?.fallbackModel || '')) +
    ' · profile: ' + (snapshot.profileModel || '');

  $('toggle-open').textContent = s.open ? 'Open ✓' : 'Closed';
  $('toggle-open').classList.toggle('on', !!s.open);
  $('mode-player').classList.toggle('on', s.profileMode !== 'conversation');
  $('mode-conv').classList.toggle('on', s.profileMode === 'conversation');

  updateHallModeSlider();

  renderPlayerList();
  refreshSelectedPlayer();
}

function renderPlayerList() {
  const players = snapshot.players || [];

  $('plist-empty').style.display = players.length ? 'none' : 'block';
  if (!players.length) {
    $('plist-items').innerHTML = '';
    selectedId = null;
    $('readonly-game').style.display = 'none';
    $('no-player').style.display = 'flex';
    return;
  }

  if (!selectedId || !players.find((p) => p.id === selectedId)) selectedId = players[0].id;

  $('plist-items').innerHTML = players.map((p) => `
    <div class="plist-item ${p.id === selectedId ? 'active' : ''}" data-pid="${GV.esc(p.id)}">
      <div class="plist-row">
        <span class="plist-rank">#${p.rank ?? '—'}</span>
        <div class="plist-name">${GV.esc(p.name)}</div>
      </div>
      <div class="plist-meta">${p.clearedLevels}/${p.totalLevels} · ${p.totalAttempts ?? p.conversationCount ?? 0} tries · ${p.latestTurns ?? 0} turns</div>
      <div class="plist-pips">${GV.pips(p.clearedLevels, p.totalLevels, p.done ? -1 : p.level)}</div>
    </div>`).join('');

  $('plist-items').querySelectorAll('.plist-item').forEach((el) => {
    el.onclick = () => {
      selectedId = el.dataset.pid;
      analysisActive = false;
      openConvId = null;
      renderPlayerList();
      refreshSelectedPlayer();
    };
  });
}

function player() {
  return snapshot.players?.find((p) => p.id === selectedId);
}

function levels() {
  return snapshot.levels?.length
    ? snapshot.levels
    : [{ number: 1, label: 'L1', model: '' }];
}

function refreshSelectedPlayer() {
  const p = player();
  if (!p) {
    $('readonly-game').style.display = 'none';
    $('no-player').style.display = 'flex';
    return;
  }

  $('no-player').style.display = 'none';
  $('readonly-game').style.display = 'flex';
  $('watch-name').textContent = p.name.toUpperCase();

  const lvls = levels();
  const total = p.totalLevels || lvls.length;

  if (!analysisActive) {
    if (!openConvId || !p.conversations.find((c) => c.id === openConvId)) {
      const won = [...p.conversations].reverse().find((c) => c.won);
      const last = p.conversations[p.conversations.length - 1];
      openConvId = (won || last)?.id;
    }
  }

  GV.renderSidebar($('sidebar'), {
    levels: lvls,
    totalLevels: total,
    clearedLevels: p.clearedLevels,
    conversations: p.conversations,
    openConvId,
    activeConvId: null,
    playerMode: false,
    showAnalysisTab: true,
    analysisActive,
    onSelectConv: (cid) => { analysisActive = false; openConvId = cid; refreshSelectedPlayer(); },
    onSelectAnalysis: () => { analysisActive = true; refreshSelectedPlayer(); },
  });

  if (analysisActive) {
    GV.setHeader({ tierEl: $('agent-tier'), ladderEl: $('ladder') }, total - 1, lvls, p.clearedLevels, total, 0);
    $('admin-meta').innerHTML = `<span class="hint">Fewer messages = sharper · ${p.messageCount ?? 0} total msgs</span>`;
    GV.renderAnalysis($('messages'), p.profile, p.name, {
      analyzing: isAnalyzing(p.id),
      onAnalyze: () => analyze(p.id),
    });
    return;
  }

  const conv = p.conversations.find((c) => c.id === openConvId);
  if (!conv) {
    $('messages').innerHTML = '<p style="opacity:.4;padding:24px">No conversations yet.</p>';
    $('admin-meta').innerHTML = '';
    return;
  }

  GV.setHeader({ tierEl: $('agent-tier'), ladderEl: $('ladder') }, conv.level, lvls, p.clearedLevels, total, conv.turns ?? 0);
  GV.renderMessages($('messages'), conv, p.name);

  $('admin-meta').innerHTML = `
    <span class="secret-tag"><b>Secret</b>${GV.esc(conv.secret || '—')}</span>
    <span>${conv.turns} turns · ${p.messageCount ?? 0} msgs total</span>
    <span class="hint">Fewer messages = sharper</span>
    <span style="margin-left:auto">${conv.won ? '★ Cracked' : 'In progress'}</span>`;
}

function updateHallModeSlider() {
  const mode = snapshot.hallMode || 'score';
  const isReveal = mode === 'analysis';
  $('hall-mode-slider').dataset.mode = mode;
  $('hall-mode-score').classList.toggle('active', !isReveal);
  $('hall-mode-reveal').classList.toggle('active', isReveal);
}

async function setHallMode(mode) {
  if ((snapshot.hallMode || 'score') === mode) return;
  $('hall-mode-score').disabled = true;
  $('hall-mode-reveal').disabled = true;
  await post('/api/admin/flip', { mode: mode === 'analysis' ? 'analysis' : 'score' });
  $('hall-mode-score').disabled = false;
  $('hall-mode-reveal').disabled = false;
  load();
}

function renderCountdown() {
  const f = snapshot.settings?.flipAt;
  if (f && snapshot.hallMode !== 'analysis') {
    const sec = Math.max(0, Math.round((f - Date.now()) / 1000));
    $('flip-countdown').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  } else {
    $('flip-countdown').textContent = '';
  }
}
setInterval(renderCountdown, 1000);

async function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json());
}

$('hall-mode-score').onclick = () => setHallMode('score');
$('hall-mode-reveal').onclick = () => setHallMode('analysis');
$('flip-schedule').onclick = async () => { await post('/api/admin/flip', { inMinutes: parseFloat($('flip-min').value) || 5 }); load(); };
$('mode-player').onclick = async () => { await post('/api/admin/profile-mode', { mode: 'player' }); load(); };
$('mode-conv').onclick = async () => { await post('/api/admin/profile-mode', { mode: 'conversation' }); load(); };
$('analyze-all').onclick = async () => {
  if (analyzeJob) return;
  await runAnalyze({});
};
$('toggle-open').onclick = async () => { await post('/api/admin/settings', { open: !(snapshot.settings?.open) }); load(); };
$('reset').onclick = async () => {
  if (!confirm('Wipe all players?')) return;
  await post('/api/admin/reset');
  selectedId = null;
  analyzeJob = null;
  updateAnalyzeAllButton();
  load();
};
async function analyze(pid) {
  if (isAnalyzing(pid)) return;
  await runAnalyze({ pid });
}

function connect() {
  const es = new EventSource('/api/admin/stream');
  ['player_joined', 'won', 'message', 'profile', 'flip', 'reset'].forEach((ev) =>
    es.addEventListener(ev, () => load()),
  );
  es.addEventListener('analyze_done', (e) => {
    try {
      const { playerId } = JSON.parse(e.data || '{}');
      if (playerId) finishAnalyzePlayer(playerId);
    } catch {
      /* ignore */
    }
  });
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

load();
connect();
setInterval(load, 8000);
