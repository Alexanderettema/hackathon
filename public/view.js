// Shared read-only / player UI helpers (sidebar, messages, header).
window.GameView = (() => {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function pips(cleared, total, current = -1) {
    let html = '';
    for (let i = 0; i < total; i++) {
      const s = i < cleared ? 'done' : i === current ? 'current' : 'locked';
      html += `<span class="pip ${s}"></span>`;
    }
    return html;
  }

  function renderSidebar(el, opts) {
    const {
      levels, totalLevels, clearedLevels, conversations,
      openConvId, activeConvId, playerMode,
      showAnalysisTab, analysisActive,
      onSelectConv, onSelectAnalysis,
    } = opts;

    const byLevel = {};
    for (const c of conversations) (byLevel[c.level] ||= []).push(c);

    let html = '';
    for (let lv = 0; lv < levels.length; lv++) {
      const l = levels[lv];
      const locked = lv > clearedLevels;
      const cleared = lv < clearedLevels;
      html += `<div class="side-level ${locked ? 'locked' : ''} ${cleared ? 'cleared' : ''}">
        <div class="side-level-head">
          <span class="sl-num">L${l.number}</span>
          <span class="sl-label">${esc(l.label)}</span>
          ${locked ? '<span class="sl-lock">🔒</span>' : cleared ? '<span class="sl-check">✓</span>' : ''}
        </div>
        <div class="sl-model">${esc(l.model)}</div>`;

      (byLevel[lv] || []).forEach((c, i) => {
        const active = !analysisActive && c.id === openConvId;
        const live = playerMode && c.id === activeConvId;
        const abandoned = playerMode && !c.won && !live;
        html += `<div class="conv-item ${c.won ? 'won' : ''} ${abandoned ? 'abandoned' : ''} ${active ? 'active' : ''}" data-cid="${esc(c.id)}">
          ${c.won ? '<span class="conv-star">★</span>' : live ? '<span class="conv-dot live-dot"></span>' : '<span class="conv-dot"></span>'}
          <span class="conv-label">${live ? 'Current · ' : abandoned ? 'Closed · ' : ''}Attempt ${i + 1}${c.won ? ' · cracked' : ''}</span>
        </div>`;
      });

      if (showAnalysisTab && lv === levels.length - 1) {
        html += `<div class="conv-item analysis-tab ${analysisActive ? 'active' : ''}" data-tab="analysis">
          <span class="conv-star">🧠</span>
          <span class="conv-label">Analysis</span>
        </div>`;
      }
      html += `</div>`;
    }

    el.innerHTML = html;
    el.querySelectorAll('.conv-item[data-cid]').forEach((node) => {
      node.onclick = () => onSelectConv(node.dataset.cid);
    });
    const tab = el.querySelector('.conv-item[data-tab="analysis"]');
    if (tab && onSelectAnalysis) tab.onclick = onSelectAnalysis;
  }

  function renderMessages(area, conv, playerName, emptyText) {
    area.innerHTML = '';
    if (!conv.messages?.length) {
      appendMsg(area, 'agent', 'Agent', emptyText || 'No messages yet.');
      return;
    }
    for (const m of conv.messages) {
      appendMsg(area, m.role === 'player' ? 'player' : 'agent', m.role === 'player' ? playerName : 'Agent', m.text);
    }
    area.scrollTop = area.scrollHeight;
  }

  function appendMsg(area, role, label, text) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + role;
    row.innerHTML = `<span class="msg-label">${esc(label)}</span><div class="bubble">${esc(text)}</div>`;
    area.appendChild(row);
  }

  function levelTemperature(levelIndex, turns, levels) {
    const n = levels.length;
    const i = Math.max(0, Math.min(levelIndex, n - 1));
    const base = levels[i].temperature ?? 0.9;
    const ramp = [0.03, 0.02, 0.01, 0.004, 0.002][i] ?? 0.01;
    const maxBoost = [0.18, 0.12, 0.06, 0.03, 0.02][i] ?? 0.06;
    return Math.min(base + turns * ramp, base + maxBoost);
  }

  function formatTierLine(levelIndex, levels, totalLevels, turns = 0) {
    const l = levels[levelIndex];
    if (!l) return '—';
    const temp = levelTemperature(levelIndex, turns, levels);
    return `LEVEL ${l.number}/${totalLevels} · ${l.label.toUpperCase()} · ${l.model.toUpperCase()} (${temp.toFixed(2)})`;
  }

  function setHeader({ tierEl, ladderEl }, levelIndex, levels, clearedLevels, totalLevels, turns = 0) {
    if (tierEl) tierEl.textContent = formatTierLine(levelIndex, levels, totalLevels, turns);
    if (ladderEl) ladderEl.innerHTML = pips(clearedLevels, totalLevels, levelIndex);
  }

  function renderAnalysis(area, profile, playerName, opts) {
    const onAnalyze = typeof opts === 'function' ? opts : opts?.onAnalyze;
    const analyzing = typeof opts === 'object' && opts?.analyzing;

    area.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'analysis-panel';
    if (analyzing) {
      wrap.innerHTML = `
        <span class="profile-label">Psychoanalysis · ${esc(playerName)}</span>
        <div class="analysis-progress">
          <div class="profile-loading"><span></span><span></span><span></span></div>
          <p class="analysis-pending">Generating analysis…</p>
        </div>`;
    } else if (profile) {
      wrap.innerHTML = `
        <span class="profile-label">Psychoanalysis · ${esc(playerName)}</span>
        <div class="profile-type">${esc(profile.type)}</div>
        <p class="profile-text">${esc(profile.text)}</p>`;
    } else {
      wrap.innerHTML = `
        <span class="profile-label">Psychoanalysis · ${esc(playerName)}</span>
        <p class="analysis-pending">No analysis yet.</p>
        ${onAnalyze ? '<button type="button" class="btn-primary analysis-gen">Generate analysis</button>' : ''}`;
      if (onAnalyze) wrap.querySelector('.analysis-gen')?.addEventListener('click', onAnalyze);
    }
    area.appendChild(wrap);
  }

  return { esc, pips, renderSidebar, renderMessages, appendMsg, setHeader, renderAnalysis, formatTierLine, levelTemperature };
})();
