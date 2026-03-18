export function renderDashboardPage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ralphito Control Deck</title>
  <style>
    :root {
      --bg: #f5efe4;
      --bg-soft: #fbf8f1;
      --panel: rgba(255, 251, 243, 0.86);
      --panel-strong: rgba(255, 248, 235, 0.95);
      --line: rgba(98, 71, 44, 0.14);
      --ink: #20160f;
      --muted: #715842;
      --accent: #a34424;
      --accent-2: #1f5c56;
      --warn: #9d6a13;
      --danger: #993c2f;
      --ok: #2e6b33;
      --shadow: 0 22px 60px rgba(85, 49, 21, 0.12);
      --radius: 24px;
      --radius-sm: 16px;
      --mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      --sans: "Avenir Next", "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background:
        radial-gradient(circle at top left, rgba(163, 68, 36, 0.14), transparent 28%),
        radial-gradient(circle at top right, rgba(31, 92, 86, 0.12), transparent 24%),
        linear-gradient(180deg, #f8f2e7 0%, #efe6d6 100%);
      color: var(--ink);
      min-height: 100vh;
    }

    .shell {
      display: grid;
      grid-template-columns: 360px 1fr;
      min-height: 100vh;
      gap: 18px;
      padding: 18px;
    }

    .panel {
      background: var(--panel);
      backdrop-filter: blur(12px);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .sidebar {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .brand small, .muted { color: var(--muted); }
    .brand h1 {
      margin: 8px 0 0;
      font-family: var(--serif);
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .stat-card {
      padding: 14px;
      border-radius: var(--radius-sm);
      background: var(--panel-strong);
      border: 1px solid var(--line);
    }

    .stat-card strong {
      display: block;
      font-size: 1.5rem;
      margin-top: 6px;
    }

    .session-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow: auto;
      padding-right: 4px;
    }

    .session-card {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.45);
      border-radius: 18px;
      padding: 14px;
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }

    .session-card:hover, .session-card.active {
      transform: translateY(-1px);
      border-color: rgba(163,68,36,0.38);
      background: rgba(255, 248, 235, 0.82);
    }

    .session-card h3 {
      margin: 0 0 8px;
      font-size: 1rem;
    }

    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      font-size: 0.75rem;
      background: rgba(255,255,255,0.5);
    }

    .workspace {
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 18px;
      padding: 18px 18px 18px 0;
    }

    .hero {
      padding: 26px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .hero h2 {
      margin: 8px 0 0;
      font-size: clamp(1.8rem, 3vw, 2.6rem);
      font-family: var(--serif);
      line-height: 1;
      letter-spacing: -0.03em;
    }

    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    .hero-meta .chip { background: rgba(255,255,255,0.72); }

    .detail-grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 18px;
      min-height: 0;
    }

    .stack { display: grid; gap: 18px; min-height: 0; }

    .card {
      padding: 20px;
      min-height: 0;
    }

    .card h3 {
      margin: 0 0 12px;
      font-size: 0.95rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .log, .timeline, .context-grid {
      display: grid;
      gap: 10px;
    }

    .log-item, .timeline-item, .context-item {
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.5);
    }

    .log-item p, .timeline-item p, .context-item p, .guardrail pre {
      margin: 6px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .guardrail {
      padding: 14px;
      border-radius: 16px;
      background: rgba(153, 60, 47, 0.08);
      border: 1px solid rgba(153, 60, 47, 0.16);
    }

    .guardrail pre {
      font-family: var(--mono);
      color: var(--danger);
      font-size: 0.85rem;
    }

    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    button {
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
      color: #fff;
      background: var(--accent);
      transition: transform 140ms ease, opacity 140ms ease;
    }

    button.secondary { background: var(--accent-2); }
    button.ghost {
      color: var(--ink);
      background: rgba(255,255,255,0.6);
      border: 1px solid var(--line);
    }
    button:hover { transform: translateY(-1px); }
    button:disabled { opacity: 0.45; cursor: wait; transform: none; }

    a { color: var(--accent); }

    @media (max-width: 1080px) {
      .shell { grid-template-columns: 1fr; }
      .workspace { padding: 0 18px 18px; }
      .detail-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar panel">
      <div class="brand">
        <small>Ralphito / Phase 5</small>
        <h1>Control Deck</h1>
        <p class="muted">AO + SQLite en una sola vista operativa, sin screen scraping.</p>
      </div>
      <div class="stats" id="stats"></div>
      <div>
        <div class="muted" style="margin-bottom:10px">Sesiones</div>
        <div class="session-list" id="session-list"></div>
      </div>
    </aside>

    <main class="workspace">
      <section class="hero panel" id="hero"></section>
      <section class="panel card" id="control-card"></section>
      <section class="detail-grid">
        <div class="stack">
          <section class="panel card">
            <h3>Chat asociado</h3>
            <div class="log" id="chat-log"></div>
          </section>
          <section class="panel card">
            <h3>Timeline de task</h3>
            <div class="timeline" id="timeline"></div>
          </section>
        </div>
        <div class="stack">
          <section class="panel card">
            <h3>Contexto enlazado</h3>
            <div class="context-grid" id="context-grid"></div>
          </section>
          <section class="panel card">
            <h3>Ultimo error guardrail</h3>
            <div id="guardrail"></div>
          </section>
        </div>
      </section>
    </main>
  </div>

  <script>
    const state = { sessions: [], selectedId: null, detail: null, busy: false };

    const el = {
      stats: document.getElementById('stats'),
      sessionList: document.getElementById('session-list'),
      hero: document.getElementById('hero'),
      controlCard: document.getElementById('control-card'),
      chatLog: document.getElementById('chat-log'),
      timeline: document.getElementById('timeline'),
      contextGrid: document.getElementById('context-grid'),
      guardrail: document.getElementById('guardrail'),
    };

    function statCard(label, value) {
      return '<div class="stat-card"><div class="muted">' + label + '</div><strong>' + value + '</strong></div>';
    }

    function chip(text) {
      return '<span class="chip">' + text + '</span>';
    }

    async function loadSessions() {
      const response = await fetch('/api/dashboard/sessions');
      const body = await response.json();
      state.sessions = body.sessions || [];
      if (!state.selectedId && state.sessions.length > 0) {
        state.selectedId = state.sessions[0].id;
      }
      if (state.selectedId && !state.sessions.find((session) => session.id === state.selectedId)) {
        state.selectedId = state.sessions[0] ? state.sessions[0].id : null;
      }
      renderStats();
      renderSessionList();
      if (state.selectedId) {
        await loadDetail(state.selectedId);
      } else {
        renderEmpty();
      }
    }

    async function loadDetail(sessionId) {
      const response = await fetch('/api/dashboard/sessions/' + encodeURIComponent(sessionId));
      if (!response.ok) {
        state.detail = null;
        renderEmpty();
        return;
      }
      state.detail = await response.json();
      renderDetail();
      renderSessionList();
    }

    function renderStats() {
      const active = state.sessions.filter((session) => !['killed','done','terminated','merged','cleanup'].includes(session.status || '')).length;
      const linkedChats = state.sessions.filter((session) => session.thread).length;
      const withTasks = state.sessions.filter((session) => session.activeTask).length;
      const withErrors = state.sessions.filter((session) => session.lastGuardrailError).length;
      el.stats.innerHTML = [
        statCard('Activas', active),
        statCard('Chats ligados', linkedChats),
        statCard('Tasks ligadas', withTasks),
        statCard('Guardrails', withErrors),
      ].join('');
    }

    function renderSessionList() {
      el.sessionList.innerHTML = state.sessions.map((session) => {
        const summary = session.summary || session.issue || session.branch || 'Sin descripcion';
        return '<div class="session-card ' + (session.id === state.selectedId ? 'active' : '') + '" data-session-id="' + session.id + '">' +
          '<h3>' + session.id + '</h3>' +
          '<div class="chips">' +
            chip(session.projectId || 'sin proyecto') +
            chip(session.status || 'sin status') +
            chip(session.thread ? 'chat ligado' : 'sin chat') +
            chip(session.activeTask ? session.activeTask.status : 'sin task') +
          '</div>' +
          '<p class="muted">' + summary + '</p>' +
        '</div>';
      }).join('');

      el.sessionList.querySelectorAll('[data-session-id]').forEach((node) => {
        node.addEventListener('click', async () => {
          state.selectedId = node.getAttribute('data-session-id');
          renderSessionList();
          if (state.selectedId) {
            await loadDetail(state.selectedId);
          }
        });
      });
    }

    function renderEmpty() {
      el.hero.innerHTML = '<div><small class="muted">Sin seleccion</small><h2>No hay sesion disponible</h2></div>';
      el.controlCard.innerHTML = '<div class="muted">Cuando AO o SQLite tengan una sesion enlazada, aparecera aqui.</div>';
      el.chatLog.innerHTML = '<div class="muted">Sin mensajes</div>';
      el.timeline.innerHTML = '<div class="muted">Sin timeline</div>';
      el.contextGrid.innerHTML = '<div class="muted">Sin contexto enlazado</div>';
      el.guardrail.innerHTML = '<div class="muted">Sin errores recientes</div>';
    }

    async function updateTaskStatus(status) {
      if (!state.detail || !state.detail.session.activeTask || state.busy) return;
      state.busy = true;
      renderControls();
      await fetch('/api/dashboard/tasks/' + encodeURIComponent(state.detail.session.activeTask.id) + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await loadSessions();
      state.busy = false;
      renderControls();
    }

    function renderControls() {
      const session = state.detail ? state.detail.session : null;
      if (!session) {
        el.controlCard.innerHTML = '<div class="muted">Sin controles disponibles.</div>';
        return;
      }
      const task = session.activeTask;
      const controls = task ?
        '<div class="controls">' +
          '<button class="secondary" ' + (state.busy ? 'disabled' : '') + ' data-action="blocked">Pausar task</button>' +
          '<button ' + (state.busy ? 'disabled' : '') + ' data-action="cancelled">Cancelar task</button>' +
          '<button class="ghost" ' + (state.busy ? 'disabled' : '') + ' data-action="refresh">Refrescar</button>' +
        '</div>' :
        '<div class="controls"><button class="ghost" ' + (state.busy ? 'disabled' : '') + ' data-action="refresh">Refrescar</button></div>';

      el.controlCard.innerHTML =
        '<div class="muted">Control operativo ligero</div>' +
        '<p>' + (task ? ('Task actual: <strong>' + task.title + '</strong> · estado <strong>' + task.status + '</strong>') : 'No hay task ligada a esta sesion.') + '</p>' +
        controls;

      el.controlCard.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.getAttribute('data-action');
          if (action === 'refresh') {
            await loadSessions();
            return;
          }
          if (action === 'blocked' || action === 'cancelled') {
            await updateTaskStatus(action);
          }
        });
      });
    }

    function renderDetail() {
      if (!state.detail) {
        renderEmpty();
        return;
      }

      const session = state.detail.session;
      el.hero.innerHTML =
        '<div><small class="muted">Sesion AO</small><h2>' + session.id + '</h2><p class="muted">' + (session.summary || session.issue || 'Sin resumen operativo') + '</p></div>' +
        '<div class="hero-meta">' +
          chip(session.projectId || 'sin proyecto') +
          chip(session.status || 'sin status') +
          chip(session.activity || 'sin activity') +
          chip(session.branch || 'sin branch') +
          (session.prUrl ? '<a class="chip" href="' + session.prUrl + '" target="_blank" rel="noreferrer">PR</a>' : '') +
        '</div>';

      renderControls();

      el.chatLog.innerHTML = state.detail.messages.length
        ? state.detail.messages.map((message) => '<div class="log-item"><strong>' + (message.senderName || message.senderType) + '</strong><div class="muted">' + message.createdAt + '</div><p>' + message.text + '</p></div>').join('')
        : '<div class="muted">No hay chat asociado o todavia no se han persistido mensajes.</div>';

      el.timeline.innerHTML = state.detail.timeline.length
        ? state.detail.timeline.map((event) => '<div class="timeline-item"><strong>' + event.eventType + '</strong><div class="muted">' + event.createdAt + '</div><p>' + JSON.stringify(event.payload, null, 2) + '</p></div>').join('')
        : '<div class="muted">No hay eventos para esta task.</div>';

      const contextItems = [];
      if (session.thread) {
        contextItems.push('<div class="context-item"><strong>Chat</strong><p>' + session.thread.channel + ' / ' + session.thread.externalChatId + '</p></div>');
      }
      if (session.agentBinding) {
        contextItems.push('<div class="context-item"><strong>Binding</strong><p>' + session.agentBinding.agentId + ' · ' + session.agentBinding.status + '</p></div>');
      }
      if (session.activeTask) {
        contextItems.push('<div class="context-item"><strong>Task</strong><p>' + session.activeTask.id + ' · ' + session.activeTask.priority + '</p></div>');
      }
      if (session.lastActivityAt || session.lastActivityLabel) {
        contextItems.push('<div class="context-item"><strong>Actividad</strong><p>' + (session.lastActivityAt || session.lastActivityLabel) + '</p></div>');
      }

      el.contextGrid.innerHTML = contextItems.length ? contextItems.join('') : '<div class="muted">Sin metadata contextual enlazada.</div>';
      el.guardrail.innerHTML = session.lastGuardrailError
        ? '<div class="guardrail"><pre>' + session.lastGuardrailError + '</pre></div>'
        : '<div class="muted">Sin errores guardrail recientes.</div>';
    }

    loadSessions();
    setInterval(loadSessions, 15000);
  </script>
</body>
</html>`;
}
