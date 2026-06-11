// Front-end (vanilla JS). Conversa com a API do servidor.
const state = {
  prompts: [],
  icps: [],
  agents: [],
  defaults: {},
  currentIcpId: null,
  currentAgentId: null,
  es: null,
  currentCard: null,
};

const usd = (n) => '$' + (Number(n) || 0).toFixed(4);

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function $(id) { return document.getElementById(id); }

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') loadRuns();
    if (btn.dataset.tab === 'agents') loadAgents();
  });
});

// ---------- health ----------
async function loadHealth() {
  try {
    const h = await api('/api/health');
    state.defaults = h.defaults || {};
    const badge = $('health');
    if (h.apiKeyConfigured) {
      badge.textContent = `OpenRouter OK | agente: ${h.defaults.agentModel} | icp: ${h.defaults.icpModel}`;
      badge.className = 'health ok';
    } else {
      badge.textContent = 'OPENROUTER_API_KEY faltando - configure o .env';
      badge.className = 'health bad';
    }
    $('run-agent-model').placeholder = h.defaults.agentModel || '';
    $('run-icp-model').placeholder = h.defaults.icpModel || '';
    $('run-maxturns').value = h.defaults.maxTurns || 18;
    if ($('run-budget').value === '') $('run-budget').value = h.defaults.maxCostPerConversation ?? 0;
  } catch (e) {
    $('health').textContent = 'sem conexao com o servidor';
    $('health').className = 'health bad';
  }
}

// ---------- prompts ----------
async function loadPrompts() {
  state.prompts = await api('/api/prompts');
  const runSel = $('run-prompt');
  const editSel = $('prompt-select');
  runSel.innerHTML = '';
  editSel.innerHTML = '';
  for (const p of state.prompts) {
    runSel.appendChild(new Option(p.id, p.id));
    editSel.appendChild(new Option(p.id, p.id));
  }
  if (state.prompts.length) loadPromptContent(state.prompts[0].id);
}
async function loadPromptContent(id) {
  const data = await api(`/api/prompts/${encodeURIComponent(id)}`);
  $('prompt-editor').value = data.content;
  $('prompt-select').value = id;
}
$('prompt-select').addEventListener('change', (e) => loadPromptContent(e.target.value));
$('prompt-save').addEventListener('click', async () => {
  const id = $('prompt-select').value;
  await api(`/api/prompts/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: $('prompt-editor').value } });
  $('prompt-status').textContent = `salvo: ${id}.md`;
  await loadPrompts();
});
$('prompt-saveas').addEventListener('click', async () => {
  const id = ($('prompt-newid').value || '').trim();
  if (!id) return ($('prompt-status').textContent = 'informe um id novo.');
  await api(`/api/prompts/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: $('prompt-editor').value } });
  $('prompt-newid').value = '';
  $('prompt-status').textContent = `salvo como ${id}.md`;
  await loadPrompts();
  $('prompt-select').value = id;
  loadPromptContent(id);
});

// ---------- Agentes / Roteamento ----------
const TEMPLATE_ROUTER = {
  router: { model: 'openai/gpt-oss-120b', temperature: 0, reasoningEffort: 'low', maxTokens: 400 },
  roles: [
    { id: 'vendedor', label: 'Vendedor principal', model: 'openai/gpt-5.4-mini', reasoningEffort: 'low', description: 'Use enquanto NAO ha decisao financeira: abertura, identificacao de responsavel, qualificacao, perguntas de lacuna, apresentacao, ferramentas de CRM, follow-ups e objecoes simples sem preco.', promptAddendum: '' },
    { id: 'closer', label: 'Closer de negociacao', model: 'anthropic/claude-opus-4.8', reasoningEffort: 'high', description: 'Use ao surgir preco, objecao de preco, desconto, "vou pensar", "vou falar com socio", comparacao de alternativas, negociacao, lead pronto pra fechar ou ticket alto.', promptAddendum: 'Voce e o CLOSER: conduza negociacao e fechamento usando as concessoes da secao 10.' },
  ],
  defaultRole: 'vendedor',
};
const TEMPLATE_SINGLE = { model: 'anthropic/claude-sonnet-4.5', temperature: 0.6, reasoningEffort: null };

async function loadAgents() {
  state.agents = await api('/api/agents');
  renderAgentList();
  renderRunAgentSelect();
  // popula select de playbook do editor de agente
  const sel = $('agent-prompt');
  sel.innerHTML = '';
  for (const p of state.prompts) sel.appendChild(new Option(p.id, p.id));
}
function renderAgentList() {
  const ul = $('agent-ul');
  ul.innerHTML = '';
  for (const a of state.agents) {
    const li = el('li');
    if (a.id === state.currentAgentId) li.classList.add('active');
    li.appendChild(el('div', null, a.name || a.id));
    li.appendChild(el('small', null, `${a.id} [${a.mode}]`));
    li.addEventListener('click', () => editAgent(a.id));
    ul.appendChild(li);
  }
}
function splitSetup(setup) {
  const { id, name, mode, promptId, ...rest } = setup;
  return { id, name, mode, promptId, rest };
}
function editAgent(id) {
  const a = state.agents.find((x) => x.id === id);
  if (!a) return;
  state.currentAgentId = id;
  const s = splitSetup(a);
  $('agent-id').value = s.id || '';
  $('agent-name').value = s.name || '';
  $('agent-mode').value = s.mode || 'router';
  $('agent-prompt').value = s.promptId || (state.prompts[0] && state.prompts[0].id) || '';
  $('agent-config').value = JSON.stringify(s.rest, null, 2);
  $('agent-status').textContent = '';
  renderAgentList();
}
$('agent-new').addEventListener('click', () => {
  state.currentAgentId = null;
  $('agent-id').value = '';
  $('agent-name').value = '';
  $('agent-mode').value = 'router';
  $('agent-prompt').value = (state.prompts[0] && state.prompts[0].id) || 'v2';
  $('agent-config').value = JSON.stringify(TEMPLATE_ROUTER, null, 2);
  $('agent-status').textContent = 'novo setup - ajuste e salve.';
  renderAgentList();
});
$('agent-template-router').addEventListener('click', () => {
  $('agent-mode').value = 'router';
  $('agent-config').value = JSON.stringify(TEMPLATE_ROUTER, null, 2);
});
$('agent-template-single').addEventListener('click', () => {
  $('agent-mode').value = 'single';
  $('agent-config').value = JSON.stringify(TEMPLATE_SINGLE, null, 2);
});
$('agent-save').addEventListener('click', async () => {
  const id = ($('agent-id').value || '').trim();
  if (!id) return ($('agent-status').textContent = 'informe um id.');
  let rest;
  try {
    rest = JSON.parse($('agent-config').value || '{}');
  } catch (e) {
    return ($('agent-status').textContent = 'config nao e JSON valido: ' + e.message);
  }
  const setup = { id, name: $('agent-name').value, mode: $('agent-mode').value, promptId: $('agent-prompt').value, ...rest };
  // validacao leve
  if (setup.mode === 'router' && (!setup.roles || !setup.roles.length)) {
    return ($('agent-status').textContent = 'modo router precisa de "roles" (ao menos 1).');
  }
  if (setup.mode === 'single' && !setup.model) {
    return ($('agent-status').textContent = 'modo single precisa de "model".');
  }
  await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: setup });
  state.currentAgentId = id;
  $('agent-status').textContent = `salvo: ${id}.json`;
  await loadAgents();
});
$('agent-delete').addEventListener('click', async () => {
  const id = ($('agent-id').value || '').trim();
  if (!id) return;
  if (!confirm(`Excluir setup "${id}"?`)) return;
  await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.currentAgentId = null;
  $('agent-new').click();
  await loadAgents();
});

function renderRunAgentSelect() {
  const sel = $('run-agent-setup');
  const prev = sel.value;
  sel.innerHTML = '';
  sel.appendChild(new Option('(modelo unico - usa os campos abaixo)', ''));
  for (const a of state.agents) sel.appendChild(new Option(`${a.id} [${a.mode}]`, a.id));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  onRunAgentChange();
}
function onRunAgentChange() {
  const id = $('run-agent-setup').value;
  const setup = state.agents.find((a) => a.id === id);
  $('run-single-models').style.display = setup ? 'none' : 'flex';
  if (setup) {
    if (setup.promptId) $('run-prompt').value = setup.promptId;
    const info =
      setup.mode === 'router'
        ? `router: ${setup.router?.model} | ` + (setup.roles || []).map((r) => `${r.id}:${r.model}`).join(' · ')
        : `single: ${setup.model}`;
    $('run-setup-info').textContent = info;
  } else {
    $('run-setup-info').textContent = '';
  }
}
$('run-agent-setup').addEventListener('change', onRunAgentChange);

// ---------- ICPs ----------
async function loadIcps() {
  state.icps = await api('/api/icps');
  renderIcpList();
  renderRunIcps();
}
function renderIcpList() {
  const ul = $('icp-ul');
  ul.innerHTML = '';
  for (const icp of state.icps) {
    const li = el('li');
    if (icp.id === state.currentIcpId) li.classList.add('active');
    li.appendChild(el('div', null, icp.name || icp.id));
    li.appendChild(el('small', null, icp.id));
    li.addEventListener('click', () => editIcp(icp.id));
    ul.appendChild(li);
  }
}
function editIcp(id) {
  const icp = state.icps.find((i) => i.id === id);
  if (!icp) return;
  state.currentIcpId = id;
  $('icp-id').value = icp.id;
  $('icp-name').value = icp.name || '';
  $('icp-stage').value = icp.startStageId || 6;
  $('icp-persona').value = icp.persona || '';
  $('icp-ficha').value = JSON.stringify(icp.ficha || {}, null, 2);
  $('icp-status').textContent = '';
  renderIcpList();
}
$('icp-new').addEventListener('click', () => {
  state.currentIcpId = null;
  $('icp-id').value = '';
  $('icp-name').value = '';
  $('icp-stage').value = 6;
  $('icp-persona').value = '';
  $('icp-ficha').value = '{\n  "nome": "",\n  "nicho": "",\n  "regiao": "",\n  "instagram": "",\n  "detalhe_para_elogio": "",\n  "decisor": "",\n  "observacoes": ""\n}';
  $('icp-status').textContent = 'novo ICP - preencha e salve.';
  renderIcpList();
});
$('icp-save').addEventListener('click', async () => {
  const id = ($('icp-id').value || '').trim();
  if (!id) return ($('icp-status').textContent = 'informe um id.');
  let ficha;
  try {
    ficha = JSON.parse($('icp-ficha').value || '{}');
  } catch (e) {
    return ($('icp-status').textContent = 'ficha nao e JSON valido: ' + e.message);
  }
  const icp = {
    id,
    name: $('icp-name').value,
    startStageId: Number($('icp-stage').value) || 6,
    persona: $('icp-persona').value,
    ficha,
  };
  await api(`/api/icps/${encodeURIComponent(id)}`, { method: 'PUT', body: icp });
  state.currentIcpId = id;
  $('icp-status').textContent = `salvo: ${id}.json`;
  await loadIcps();
});
$('icp-delete').addEventListener('click', async () => {
  const id = ($('icp-id').value || '').trim();
  if (!id) return;
  if (!confirm(`Excluir ICP "${id}"?`)) return;
  await api(`/api/icps/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.currentIcpId = null;
  $('icp-new').click();
  await loadIcps();
});

// ---------- run config ----------
function renderRunIcps() {
  const box = $('run-icps');
  box.innerHTML = '';
  for (const icp of state.icps) {
    const lab = el('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = icp.id;
    cb.checked = true;
    lab.appendChild(cb);
    lab.appendChild(el('span', null, icp.name || icp.id));
    box.appendChild(lab);
  }
}

$('run-btn').addEventListener('click', runSimulation);

// Cancelar: interrompe a execucao em andamento no servidor.
$('cancel-btn').addEventListener('click', async () => {
  if (!state.jobId) return;
  state.cancelled = true;
  $('run-status').innerHTML = '<span class="spinner"></span> cancelando...';
  $('cancel-btn').disabled = true;
  try {
    await api(`/api/cancel/${state.jobId}`, { method: 'POST' });
  } catch (e) {
    /* job pode ja ter terminado */
  }
});

// Limpar: equivale a recarregar a pagina.
$('clear-btn').addEventListener('click', () => location.reload());

async function runSimulation() {
  const promptId = $('run-prompt').value;
  const icpIds = [...$('run-icps').querySelectorAll('input:checked')].map((c) => c.value);
  if (!promptId) return ($('run-status').textContent = 'selecione um prompt.');
  if (!icpIds.length) return ($('run-status').textContent = 'selecione ao menos um ICP.');

  const setupId = $('run-agent-setup').value || undefined;
  const budgetVal = $('run-budget').value;
  const body = {
    promptId,
    icpIds,
    agentSetupId: setupId,
    maxCost: budgetVal !== '' ? Number(budgetVal) : undefined,
    agentModel: setupId ? undefined : $('run-agent-model').value.trim() || undefined,
    icpModel: $('run-icp-model').value.trim() || undefined,
    maxTurns: Number($('run-maxturns').value) || undefined,
    repeat: Number($('run-repeat').value) || 1,
  };

  const out = $('run-output');
  out.innerHTML = '';
  $('run-btn').disabled = true;
  $('run-status').innerHTML = '<span class="spinner"></span> rodando...';
  state.cancelled = false;

  let jobId;
  try {
    ({ jobId } = await api('/api/simulate', { method: 'POST', body }));
  } catch (e) {
    $('run-status').textContent = 'erro: ' + e.message;
    $('run-btn').disabled = false;
    return;
  }
  state.jobId = jobId;
  $('cancel-btn').disabled = false;

  if (state.es) state.es.close();
  const es = new EventSource(`/api/stream/${jobId}`);
  state.es = es;
  state.currentCard = null;

  es.onmessage = (ev) => {
    const evt = JSON.parse(ev.data);
    handleEvent(evt);
  };
  es.onerror = () => {
    // stream encerrado pelo servidor ao concluir
    es.close();
  };
}

function newConvoCard(evt) {
  const card = el('div', 'convo');
  const head = el('div', 'convo-head');
  head.appendChild(el('div', 'title', evt.icp?.name || evt.icpId || 'Conversa'));
  const right = el('div');
  const stage = el('span', 'stage', 'estagio 6 - Inbox');
  const cost = el('span', 'cost', '');
  right.appendChild(stage);
  right.appendChild(cost);
  head.appendChild(right);
  card.appendChild(head);
  const bodyEl = el('div', 'convo-body');
  card.appendChild(bodyEl);
  $('run-output').appendChild(card);
  const obj = { card, body: bodyEl, stage, cost };
  state.currentCard = obj;
  return obj;
}

function handleEvent(evt) {
  const out = $('run-output');
  switch (evt.type) {
    case 'start':
      newConvoCard(evt);
      break;
    case 'agent': {
      const c = state.currentCard;
      if (!c) break;
      // badge de roteamento (qual modelo/papel respondeu)
      const rt = evt.route;
      if (rt && rt.roleId && rt.roleId !== 'single') {
        const cls = rt.roleId === 'closer' ? 'closer' : rt.roleId === 'vendedor' ? 'vendedor' : '';
        const badge = el('div', `route-badge ${cls}`, `${rt.roleId} · ${rt.model}`);
        if (rt.reason) badge.title = rt.reason;
        c.body.appendChild(badge);
      }
      if (typeof evt.cost === 'number') c.cost.textContent = usd(evt.cost);
      const tcs = evt.message.toolCalls || [];
      if (tcs.length) {
        const chips = el('div', 'tools');
        for (const tc of tcs) {
          const chip = el('span', 'chip', tc.displayName);
          chip.title = JSON.stringify(tc.args, null, 2);
          chips.appendChild(chip);
        }
        c.body.appendChild(chips);
      }
      if (evt.message.thinking) {
        c.body.appendChild(el('div', 'think', 'think: ' + evt.message.thinking.replace(/\s+/g, ' ').slice(0, 240)));
      }
      if (evt.message.text) {
        const m = el('div', 'msg agent');
        m.appendChild(el('div', 'who', 'agente'));
        m.appendChild(el('div', null, evt.message.text));
        c.body.appendChild(m);
      } else if (!evt.message.error) {
        c.body.appendChild(el('div', 'think', '(o agente nao gerou mensagem de texto neste turno)'));
      }
      if (evt.crm) c.stage.textContent = `estagio ${evt.crm.stageId} - ${evt.crm.stageName}` + (evt.crm.escalated ? ' | escalado' : '');
      break;
    }
    case 'lead': {
      const c = state.currentCard;
      if (!c) break;
      if (typeof evt.cost === 'number') c.cost.textContent = usd(evt.cost);
      if (!evt.message.text) break;
      const m = el('div', 'msg lead');
      m.appendChild(el('div', 'who', 'lead'));
      m.appendChild(el('div', null, evt.message.text));
      c.body.appendChild(m);
      break;
    }
    case 'error': {
      const c = state.currentCard;
      if (c) c.body.appendChild(el('div', 'think', `[erro ${evt.side}] ${evt.error}`));
      break;
    }
    case 'budget': {
      const c = state.currentCard;
      if (c) c.body.appendChild(el('div', 'think', `[teto de custo atingido: ${usd(evt.total)} >= ${usd(evt.maxCost)} -> encerrando]`));
      break;
    }
    case 'end': {
      const c = state.currentCard;
      if (c) {
        const o = evt.outcome;
        const label =
          o.budgetExceeded ? 'ESTOUROU ORCAMENTO' :
          o.decision === 'closed' ? 'FECHOU a compra' :
          o.decision === 'declined' ? 'RECUSOU' :
          o.endReason === 'handoff' ? 'passou pra humano' :
          o.endReason;
        const totalCost = (evt.cost && evt.cost.total) ?? o.totalCost ?? 0;
        const bar = el('div', 'endbar' + (o.budgetExceeded ? ' budget' : ''),
          `desfecho: ${label} | estagio final ${o.reachedStageId} ${o.reachedStageName} | turnos ${o.turns} | `);
        const costSpan = el('span', 'cost-chip', `custo ${usd(totalCost)}`);
        bar.appendChild(costSpan);
        if (evt.cost && evt.cost.byModel && Object.keys(evt.cost.byModel).length > 1) {
          bar.appendChild(el('div', 'cost-breakdown', Object.entries(evt.cost.byModel).map(([m, ct]) => `${m}: ${usd(ct)}`).join('  ·  ')));
        }
        c.endbar = bar;
        c.card.appendChild(bar);
      }
      break;
    }
    case 'saved': {
      const c = state.currentCard;
      if (c && c.endbar) {
        const a = el('a', 'dl', ' [baixar JSON]');
        a.href = `/api/runs/${encodeURIComponent(evt.file)}`;
        a.setAttribute('download', evt.file);
        c.endbar.appendChild(a);
      }
      break;
    }
    case 'cancelled': {
      state.cancelled = true;
      const c = state.currentCard;
      if (c && !c.endbar) c.body.appendChild(el('div', 'think', '[cancelado pelo usuario]'));
      break;
    }
    case 'complete':
      $('run-status').textContent = (evt.cancelled || state.cancelled)
        ? 'cancelado. nada salvo desta conversa interrompida.'
        : 'concluido. transcricoes salvas em output/runs/.';
      $('run-btn').disabled = false;
      $('cancel-btn').disabled = true;
      state.jobId = null;
      if (state.es) state.es.close();
      break;
    case 'fatal':
      $('run-status').textContent = 'erro: ' + evt.error;
      $('run-btn').disabled = false;
      $('cancel-btn').disabled = true;
      state.jobId = null;
      if (state.es) state.es.close();
      break;
  }
  out.scrollTop = out.scrollHeight;
}

// ---------- historico ----------
async function loadRuns() {
  const runs = await api('/api/runs');
  const ul = $('history-ul');
  ul.innerHTML = '';
  if (!runs.length) {
    ul.appendChild(el('li', null, '(nenhuma transcricao ainda)'));
    return;
  }
  for (const r of runs) {
    const li = el('li');
    li.appendChild(el('div', null, r.icp || r.file));
    const o = r.outcome || {};
    li.appendChild(el('small', null, `${o.endReason || '?'} | est ${o.reachedStageId || '?'} | ${(r.createdAt || '').slice(0, 16).replace('T', ' ')}`));
    li.addEventListener('click', () => viewRun(r.file, li));
    ul.appendChild(li);
  }
}
$('history-refresh').addEventListener('click', loadRuns);

async function viewRun(file, li) {
  document.querySelectorAll('#history-ul li').forEach((x) => x.classList.remove('active'));
  if (li) li.classList.add('active');
  const run = await api(`/api/runs/${encodeURIComponent(file)}`);
  const v = $('history-view');
  v.innerHTML = '';

  const meta = el('div', 'meta');
  const o = run.outcome || {};
  const ag = run.agent || {};
  const agentDesc = ag.mode === 'router'
    ? `router ${ag.routerModel} → ${(ag.roles || []).map((r) => `${r.id}:${r.model}`).join(' · ')}`
    : ag.model || '?';
  const cost = run.cost || {};
  meta.innerHTML =
    `<span>ICP: <b>${run.icp?.name || run.icp?.id}</b></span>` +
    `<span>prompt: <b>${ag.promptId}</b></span>` +
    `<span>agente: <b>${agentDesc}</b></span>` +
    `<span class="badge">fim: ${o.endReason}</span>` +
    `<span class="badge">estagio ${o.reachedStageId} ${o.reachedStageName}</span>` +
    `<span class="badge">turnos ${o.turns}</span>` +
    (o.escalated ? '<span class="badge">escalado</span>' : '') +
    `<span class="badge cost-b">custo ${usd(cost.total)}</span>` +
    (cost.byModel && Object.keys(cost.byModel).length > 1
      ? `<span class="badge">${Object.entries(cost.byModel).map(([m, c]) => `${m.split('/').pop()}: ${usd(c)}`).join(' · ')}</span>`
      : '');
  const dl = el('a', 'dl badge', 'baixar JSON');
  dl.href = `/api/runs/${encodeURIComponent(file)}`;
  dl.setAttribute('download', file);
  meta.appendChild(dl);
  v.appendChild(meta);

  const body = el('div', 'convo-body');
  for (const m of run.messages) {
    if (m.role === 'agent') {
      if (m.roleId && m.roleId !== 'single') {
        const cls = m.roleId === 'closer' ? 'closer' : m.roleId === 'vendedor' ? 'vendedor' : '';
        const badge = el('div', `route-badge ${cls}`, `${m.roleId} · ${m.model}`);
        if (m.routerReason) badge.title = m.routerReason;
        body.appendChild(badge);
      }
      const tcs = m.toolCalls || [];
      if (tcs.length) {
        const chips = el('div', 'tools');
        for (const tc of tcs) {
          const chip = el('span', 'chip', tc.displayName);
          chip.title = JSON.stringify(tc.args, null, 2);
          chips.appendChild(chip);
        }
        body.appendChild(chips);
      }
      if (m.thinking) body.appendChild(el('div', 'think', 'think: ' + m.thinking.replace(/\s+/g, ' ').slice(0, 280)));
      if (m.text) {
        const b = el('div', 'msg agent');
        b.appendChild(el('div', 'who', 'agente'));
        b.appendChild(el('div', null, m.text));
        body.appendChild(b);
      } else {
        body.appendChild(el('div', 'think', m.error ? `(turno vazio: ${m.error})` : '(sem mensagem de texto neste turno)'));
      }
    } else {
      const b = el('div', 'msg lead');
      b.appendChild(el('div', 'who', 'lead'));
      b.appendChild(el('div', null, m.text));
      body.appendChild(b);
    }
  }
  v.appendChild(body);

  // notas do CRM final
  const notes = run.crmFinalState?.notes || [];
  if (notes.length) {
    const nb = el('div', 'notes-block');
    nb.appendChild(el('h4', null, 'Notas registradas no Pipedrive (simulado)'));
    const ul = el('ul');
    for (const n of notes) ul.appendChild(el('li', null, n.content));
    nb.appendChild(ul);
    v.appendChild(nb);
  }
}

// ---------- init ----------
(async function init() {
  await loadHealth();
  await loadPrompts();
  await loadAgents();
  await loadIcps();
})();
