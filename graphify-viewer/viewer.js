/* HOMATCH Architecture viewer shell. Everything shown comes from this
   deployment's own files: status.json, g/** (Graphify output), and the
   /api/freshness check. No third-party requests except the CDN libraries
   Graphify's own HTML loads (vis-network, Mermaid). */
(() => {
  const VIEWS = [
    { id: 'all', label: 'All HOMATCH', base: 'g/all', note: 'Whole repository. Above 5,000 nodes Graphify shows its community map; pick a preset for symbol-level detail.' },
    { id: 'design-studio', label: 'Design Studio' },
    { id: 'meta-ads', label: 'Meta Ads' },
    { id: 'discovery-campaigns', label: 'Discovery / Campaigns' },
    { id: 'supabase-database', label: 'Supabase / DB' },
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'runpod-blender', label: 'Runpod / Blender' },
    { id: 'traces', label: 'Traces', panel: true },
    { id: 'history', label: 'History', panel: true },
  ];
  const KIND_TEXT = {
    FLOW: 'directed path: calls / imports in this direction',
    DEPENDS: 'only the reverse dependency exists (the later stage uses the earlier one)',
    COUPLING: 'connected only through shared code — not a flow',
    NO_STATIC_PATH: 'no static connection — usually an HTTP or runtime hop; verify in source',
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (sha) => (sha ? String(sha).slice(0, 8) : '—');
  const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };
  const getJson = (u) => fetch(u, { cache: 'no-cache', credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  let status = null;
  let viewIndex = {};
  let current = null;
  let mode = 'graph';
  const cache = {};

  function setBadge(text, tone, alertHtml, alertTone) {
    const b = $('state');
    b.textContent = text;
    b.dataset.tone = tone;
    const a = $('alert');
    if (alertHtml) { a.innerHTML = alertHtml; a.dataset.tone = alertTone || tone; a.hidden = false; } else a.hidden = true;
  }

  function header() {
    const rev = status.revision || {};
    $('branch').textContent = rev.branch || '—';
    $('sha').textContent = short(rev.sha);
    $('sha').title = rev.sha || '';
    const g = status.graph;
    $('gen').textContent = g ? `graph generated ${when(g.generatedAt)}${g.sha !== rev.sha ? ` @ ${short(g.sha)}` : ''}` : 'no graph';
    if (status.state === 'UPDATE_FAILED') {
      const f = status.failure;
      setBadge('STALE · UPDATE FAILED', 'bad',
        `Graph update for <code>${esc(f.attemptedBranch || '')} @ ${esc(short(f.attemptedSha))}</code> failed ${esc(when(f.at))}: ${esc(f.reason)}. ` +
        `Showing the last valid graph <code>${esc(short(f.lastGoodSha))}</code>.`);
      return false;
    }
    if (status.state === 'NO_GRAPH') {
      setBadge('NO GRAPH', 'bad', `No valid graph yet. Last attempt <code>${esc(short(status.failure?.attemptedSha))}</code>: ${esc(status.failure?.reason)}`);
      return false;
    }
    setBadge('CHECKING', 'warn', null);
    return true;
  }

  async function freshness() {
    const f = await getJson('api/freshness');
    if (!f) { setBadge('UNVERIFIED', 'warn', 'Live freshness check unavailable — this graph may be behind main.'); return; }
    if (f.verdict === 'CURRENT') {
      setBadge('CURRENT', 'ok', status.note ? `Current. ${esc(status.note)}.` : null, 'ok');
      if (!status.note) $('alert').hidden = true;
    } else if (f.verdict === 'STALE') {
      setBadge('STALE', 'bad', `STALE — ${esc(f.reason)}. The refresh runs on every push to main; if this persists, the refresh failed.`);
    } else if (f.verdict === 'UNKNOWN') {
      setBadge('UNVERIFIED', 'warn', `Could not confirm against live HOMATCH (${esc(f.reason)}). Graph revision ${esc(short(status.revision?.sha))}.`);
    }
    $('state').title = `checked ${when(f.checkedAt)}: ${f.reason || ''}`;
  }

  function tabs() {
    const nav = $('tabs');
    nav.innerHTML = VIEWS.map((v) => `<button type="button" role="tab" id="tab-${v.id}" data-view="${v.id}" aria-selected="false">${esc(v.label)}</button>`).join('');
    nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) location.hash = b.dataset.view; });
  }

  function base(v) { return v.base || `g/views/${v.id}`; }
  function has(path) { return (status.files || []).includes(path.replace(/^g\//, '')); }

  function show(id) {
    const v = VIEWS.find((x) => x.id === id) || VIEWS[1];
    current = v;
    for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === v.id));
    $(`tab-${v.id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const frame = $('frame');
    const panel = $('panel');
    $('subbar').hidden = !!v.panel;
    if (v.panel) {
      frame.hidden = true; frame.removeAttribute('src'); panel.hidden = false;
      (v.id === 'traces' ? renderTraces : renderHistory)(panel);
      return;
    }
    const file = `${base(v)}/${mode === 'callflow' ? 'callflow' : 'graph'}.html`;
    const s = viewIndex[v.id];
    $('stats').textContent = s ? `${s.nodes.toLocaleString()} nodes · ${s.edges.toLocaleString()} edges · ${s.extracted.toLocaleString()} EXTRACTED · ${s.inferred.toLocaleString()} INFERRED · ${s.files} files`
      : (v.note || (status.graph ? `${status.graph.nodes?.toLocaleString?.() ?? ''} nodes in the whole graph` : ''));
    $('open').href = file;
    if (!has(file)) {
      frame.hidden = true; frame.removeAttribute('src'); panel.hidden = false;
      panel.innerHTML = `<div class="empty"><h2>${esc(v.label)}</h2><p>This revision has no ${mode === 'callflow' ? 'call-flow ' : ''}graph for this preset${s && !s.nodes ? ' — no source file in it matches the preset' : ''}.</p>${v.id === 'runpod-blender' ? '<p>No source file on this revision matches the Runpod / Blender preset; see <a href="#traces">Traces → dependency source scan</a> for every file that mentions Runpod, Blender, SAM, TRELLIS or HF_TOKEN.</p>' : ''}</div>`;
      return;
    }
    panel.hidden = true; frame.hidden = false;
    if (frame.getAttribute('src') !== file) frame.src = file;
  }

  async function renderTraces(panel) {
    panel.innerHTML = '<p>Loading traces…</p>';
    cache.traces ??= await getJson('g/traces.json');
    cache.deps ??= await getJson('g/deps.json');
    const t = cache.traces;
    if (!t) { panel.innerHTML = '<div class="empty">No traces in this build.</div>'; return; }
    const legend = Object.entries(KIND_TEXT).map(([k, txt]) => `<span><span class="chip k-${k}">${k.replace(/_/g, ' ')}</span> ${esc(txt)}</span>`).join('');
    const titles = { 'design-studio': 'Design Studio: upload → walkthrough', 'meta-ads': 'Meta Ads: builder → Graph API → insights', 'meta-leads': 'Meta Leads: form → permissions → Instant Forms → terms → readiness' };
    let html = `<p>Each stage is a real node of this revision's graph (highest-degree match, tests excluded). Between stages: the strongest relation the graph states — never more. EXTRACTED vs INFERRED is shown per hop.</p><div class="legend">${legend}</div>`;
    for (const [key, tr] of Object.entries(t)) {
      html += `<h2>${esc(titles[key] || key)}</h2><ol class="flow">`;
      const linkTo = new Map(tr.links.map((l) => [l.to, l]));
      for (const s of tr.stages) {
        const l = linkTo.get(s.stage);
        if (l) {
          const hops = l.hops.length ? `<details><summary>${l.hops.length} hop(s)${l.confidence ? ` · ${esc(l.confidence.replace('_', ' '))}` : ''}</summary><ol>${l.hops.map((h) => `<li><code>${esc(h.from)}</code> ${esc(h.dir)} <em>${esc(h.relation)}</em> <span class="chip ${h.confidence === 'EXTRACTED' ? 'k-FLOW' : 'k-COUPLING'}">${esc(h.confidence)}</span> <code>${esc(h.to)}</code>${h.at ? `<br><small>${esc(h.at)}</small>` : ''}</li>`).join('')}</ol></details>` : '';
          html += `<li class="hop"><span class="chip k-${l.kind}">${l.kind.replace(/_/g, ' ')}</span> ${hops}</li>`;
        }
        html += s.node
          ? `<li class="stage"><b>${esc(s.stage)}</b><code>${esc(s.node.label)}</code><div class="where">${esc(s.node.at)}</div></li>`
          : `<li class="stage absent"><b>${esc(s.stage)}</b><span class="chip k-ABSENT">NOT IN THIS REVISION</span></li>`;
      }
      html += '</ol>';
    }
    const d = cache.deps;
    if (d) {
      html += `<h2>Dependency source scan (this revision)</h2><p>Files that mention each dependency — a text scan of code files, not graph data. Paths only; no contents are published.</p><table><thead><tr><th>Dependency</th><th>Files</th></tr></thead><tbody>`;
      for (const [k, files] of Object.entries(d)) {
        html += `<tr><td>${esc(k)}</td><td>${files.length ? `<details><summary>${files.length} file(s)</summary>${files.map((f) => `<code>${esc(f)}</code>`).join('<br>')}</details>` : '<span class="chip k-ABSENT">NONE</span>'}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    panel.innerHTML = html;
  }

  function renderHistory(panel) {
    const rows = (status.history || []).map((h) => `<tr><td>${esc(when(h.at))}</td><td>${esc(h.branch)}</td><td><code>${esc(short(h.sha))}</code></td><td class="r-${esc(h.result)}">${esc(h.result.toUpperCase())}${h.reason ? `<br><small>${esc(h.reason)}</small>` : ''}</td><td>${h.deployment && h.result === 'built' ? `<a href="https://${esc(h.deployment)}/" target="_blank" rel="noopener">open</a>` : ''}</td></tr>`).join('');
    const g = status.graph;
    panel.innerHTML = `<h2>This graph</h2>${g ? `<table><tbody>
      <tr><th>Graph commit</th><td><code>${esc(g.sha)}</code></td></tr>
      <tr><th>Revision shown</th><td><code>${esc(status.revision?.branch)} @ ${esc(status.revision?.sha)}</code></td></tr>
      <tr><th>Generated</th><td>${esc(when(g.generatedAt))}</td></tr>
      <tr><th>Graphify</th><td>${esc(g.graphifyVersion)} · code-only AST · no LLM</td></tr>
      <tr><th>Size</th><td>${esc(g.nodes)} nodes · ${esc(g.edges)} edges · ${esc(g.extracted)} EXTRACTED · ${esc(g.inferred)} INFERRED · ${esc(g.files)} files</td></tr>
      <tr><th>Digest</th><td><code>${esc(g.digest)}</code><br><small>Same value as <code>node scripts/claude/graphify.mjs digest</code> on this commit.</small></td></tr>
      <tr><th>Downloads</th><td><a href="g/data/graph.json">graph.json</a> · <a href="g/data/GRAPH_REPORT.md">GRAPH_REPORT.md</a> · <a href="g/traces.json">traces.json</a></td></tr>
    </tbody></table>` : '<p>No graph.</p>'}
    <h2>Recent builds (last ${status.history?.length || 0})</h2>
    <p>Every successful build stays openable at its own protected deployment URL.</p>
    <table><thead><tr><th>When</th><th>Branch</th><th>Commit</th><th>Result</th><th>Viewer</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function route() { show((location.hash || '#design-studio').slice(1)); }

  document.querySelector('.mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    for (const x of document.querySelectorAll('.mode button')) x.setAttribute('aria-pressed', String(x === b));
    if (current) show(current.id);
  });
  $('state').addEventListener('click', () => { location.hash = 'history'; });
  window.addEventListener('hashchange', route);

  (async () => {
    status = await getJson('status.json');
    if (!status) { setBadge('NO STATUS', 'bad', 'status.json missing — this deployment is incomplete.'); return; }
    viewIndex = (await getJson('g/views/index.json')) || {};
    tabs();
    const live = header();
    route();
    if (live) freshness();
  })();
})();
