// Front-end do Sparring (vanilla JS, zero dependências). Conversa com a API do servidor.
const state = {
  prompts: [],
  icps: [],
  agents: [],
  toolsCfg: { stages: [], tools: [], effects: [] },
  defaults: {},
  currentIcpId: null,
  currentIcpRaw: null,
  currentAgentId: null,
  currentAgentRaw: null,
  es: null,
  currentCard: null,
  jobId: null,
  cancelled: false,
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

function toast(msg, type = 'ok') {
  const t = el('div', `toast ${type}`, msg);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// ---------- navegação (com deep-link via #hash) ----------
function activateTab(tab) {
  const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  $(`tab-${tab}`).classList.add('active');
  if (history.replaceState) history.replaceState(null, '', `#${tab}`);
  if (tab === 'history') loadRuns();
  if (tab === 'agents') loadAgents();
  if (tab === 'tools') loadTools();
}
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});
window.addEventListener('hashchange', () => {
  const tab = location.hash.replace('#', '');
  if (document.querySelector(`.nav-item[data-tab="${tab}"]`)) activateTab(tab);
});

// ---------- health ----------
async function loadHealth() {
  const badge = $('health');
  try {
    const h = await api('/api/health');
    state.defaults = h.defaults || {};
    if (h.apiKeyConfigured) {
      badge.textContent = `OpenRouter ok · agente ${h.defaults.agentModel} · cliente ${h.defaults.icpModel}`;
      badge.className = 'health ok';
    } else {
      badge.textContent = 'OPENROUTER_API_KEY faltando — configure o .env';
      badge.className = 'health bad';
    }
    $('run-agent-model').placeholder = h.defaults.agentModel || '';
    $('run-icp-model').placeholder = h.defaults.icpModel || '';
    $('run-maxturns').value = h.defaults.maxTurns || 24;
    if ($('run-budget').value === '') $('run-budget').value = h.defaults.maxCostPerConversation ?? 0;
  } catch {
    badge.textContent = 'sem conexão com o servidor';
    badge.className = 'health bad';
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
  try {
    await api(`/api/prompts/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: $('prompt-editor').value } });
    toast(`Prompt salvo: ${id}.md`);
    await loadPrompts();
    $('prompt-select').value = id;
  } catch (e) { toast('Erro ao salvar: ' + e.message, 'error'); }
});
$('prompt-saveas').addEventListener('click', async () => {
  const id = ($('prompt-newid').value || '').trim();
  if (!id) return toast('Informe um id pra nova versão.', 'error');
  try {
    await api(`/api/prompts/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: $('prompt-editor').value } });
    $('prompt-newid').value = '';
    toast(`Salvo como ${id}.md`);
    await loadPrompts();
    $('prompt-select').value = id;
    loadPromptContent(id);
  } catch (e) { toast('Erro ao salvar: ' + e.message, 'error'); }
});

// ============================================================
// AGENTES / ROTEAMENTO — editor estruturado (sem JSON na mão)
// ============================================================
const EFFORTS = ['', 'low', 'medium', 'high'];

async function loadAgents() {
  state.agents = await api('/api/agents');
  renderAgentList();
  renderRunAgentSelect();
  const sel = $('agent-prompt');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const p of state.prompts) sel.appendChild(new Option(p.id, p.id));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  if (!state.currentAgentId && state.agents.length) editAgent(state.agents[0].id);
}

function renderAgentList() {
  const ul = $('agent-ul');
  ul.innerHTML = '';
  if (!state.agents.length) ul.appendChild(el('li', 'muted-item', 'nenhum setup ainda'));
  for (const a of state.agents) {
    const li = el('li');
    if (a.id === state.currentAgentId) li.classList.add('active');
    li.appendChild(el('div', null, a.name || a.id));
    li.appendChild(el('small', null, `${a.id} · ${a.mode === 'router' ? 'roteador' : 'modelo único'}`));
    li.addEventListener('click', () => editAgent(a.id));
    ul.appendChild(li);
  }
}

function numOrBlank(v) { return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''; }

function roleCard(role = {}) {
  const card = el('div', 'role-card');
  const head = el('div', 'role-head');
  head.appendChild(el('span', 'role-title', 'papel'));
  const rm = el('button', 'icon-btn', '×');
  rm.type = 'button';
  rm.title = 'Remover papel';
  rm.setAttribute('aria-label', 'Remover papel');
  rm.addEventListener('click', () => { card.remove(); syncDefaultRoleOptions(); updateAgentJsonPreview(); });
  head.appendChild(rm);
  card.appendChild(head);

  const row1 = el('div', 'row');
  row1.appendChild(fieldWrap('id', input('r-id', role.id || '', 'ex.: vendedor'), 'narrow'));
  row1.appendChild(fieldWrap('Rótulo', input('r-label', role.label || '', 'ex.: Vendedor principal')));
  row1.appendChild(fieldWrap('Modelo', input('r-model', role.model || '', 'ex.: openai/gpt-5.4-mini')));
  card.appendChild(row1);

  const row2 = el('div', 'row');
  const temp = input('r-temp', numOrBlank(role.temperature), 'padrão'); temp.type = 'number'; temp.min = 0; temp.max = 2; temp.step = 0.1;
  row2.appendChild(fieldWrap('Temperatura', temp, 'narrow'));
  const eff = document.createElement('select'); eff.className = 'r-effort';
  for (const o of EFFORTS) eff.appendChild(new Option(o || '—', o));
  eff.value = role.reasoningEffort || '';
  row2.appendChild(fieldWrap('Raciocínio', eff, 'narrow'));
  card.appendChild(row2);

  card.appendChild(fieldWrap('Quando usar (o roteador decide por esta descrição)', textarea('r-desc', role.description || '')));
  card.appendChild(fieldWrap('Adendo ao prompt (opcional, só pra este papel)', textarea('r-addendum', role.promptAddendum || '')));
  return card;
}
function fieldWrap(labelText, inputEl, cls) {
  const wrap = el('div', cls || null);
  const lab = el('label', null, labelText);
  wrap.appendChild(lab);
  wrap.appendChild(inputEl);
  return wrap;
}
function input(cls, value, placeholder) {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = cls;
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function textarea(cls, value) {
  const t = document.createElement('textarea');
  t.className = cls;
  t.value = value || '';
  return t;
}

function syncDefaultRoleOptions() {
  const sel = $('agent-default-role');
  const prev = sel.value;
  sel.innerHTML = '';
  document.querySelectorAll('#role-cards .role-card').forEach((c) => {
    const id = c.querySelector('.r-id').value.trim();
    if (id) sel.appendChild(new Option(id, id));
  });
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function onAgentModeChange() {
  const mode = $('agent-mode').value;
  $('agent-single-box').hidden = mode !== 'single';
  $('agent-router-boxes').hidden = mode !== 'router';
  if (mode === 'router' && !document.querySelector('#role-cards .role-card')) {
    $('role-cards').appendChild(roleCard({ id: 'vendedor', label: 'Vendedor principal' }));
    syncDefaultRoleOptions();
  }
  updateAgentJsonPreview();
}
$('agent-mode').addEventListener('change', onAgentModeChange);
$('role-add').addEventListener('click', () => {
  $('role-cards').appendChild(roleCard({}));
  syncDefaultRoleOptions();
  updateAgentJsonPreview();
});

function fillAgentForm(setup) {
  $('agent-id').value = setup.id || '';
  $('agent-name').value = setup.name || '';
  $('agent-mode').value = setup.mode || 'single';
  $('agent-prompt').value = setup.promptId || (state.prompts[0] && state.prompts[0].id) || '';

  $('single-model').value = setup.model || '';
  $('single-temp').value = numOrBlank(setup.temperature);
  $('single-effort').value = setup.reasoningEffort || '';
  $('single-maxtokens').value = numOrBlank(setup.maxTokens);

  const r = setup.router || {};
  $('router-model').value = r.model || '';
  $('router-temp').value = numOrBlank(r.temperature);
  $('router-effort').value = r.reasoningEffort || '';
  $('router-maxtokens').value = numOrBlank(r.maxTokens);

  const rc = $('role-cards');
  rc.innerHTML = '';
  for (const role of setup.roles || []) rc.appendChild(roleCard(role));
  syncDefaultRoleOptions();
  if (setup.defaultRole) $('agent-default-role').value = setup.defaultRole;

  onAgentModeChange();
}

function collectAgentFromForm() {
  // Parte do JSON original (preserva chaves extras, ex.: rerouteEveryTurn).
  const base = state.currentAgentRaw ? JSON.parse(JSON.stringify(state.currentAgentRaw)) : {};
  for (const k of ['id', 'name', 'mode', 'promptId', 'model', 'temperature', 'reasoningEffort', 'maxTokens', 'router', 'roles', 'defaultRole']) {
    delete base[k];
  }
  const mode = $('agent-mode').value;
  const setup = {
    id: ($('agent-id').value || '').trim(),
    name: $('agent-name').value,
    mode,
    promptId: $('agent-prompt').value,
    ...base,
  };
  const num = (v) => (v === '' ? undefined : Number(v));
  if (mode === 'single') {
    setup.model = $('single-model').value.trim();
    if (num($('single-temp').value) !== undefined) setup.temperature = num($('single-temp').value);
    setup.reasoningEffort = $('single-effort').value || null;
    if (num($('single-maxtokens').value) !== undefined) setup.maxTokens = num($('single-maxtokens').value);
  } else {
    setup.router = { model: $('router-model').value.trim() };
    if (num($('router-temp').value) !== undefined) setup.router.temperature = num($('router-temp').value);
    if ($('router-effort').value) setup.router.reasoningEffort = $('router-effort').value;
    if (num($('router-maxtokens').value) !== undefined) setup.router.maxTokens = num($('router-maxtokens').value);
    setup.roles = [...document.querySelectorAll('#role-cards .role-card')].map((c) => {
      const role = {
        id: c.querySelector('.r-id').value.trim(),
        label: c.querySelector('.r-label').value.trim(),
        model: c.querySelector('.r-model').value.trim(),
        description: c.querySelector('.r-desc').value.trim(),
        promptAddendum: c.querySelector('.r-addendum').value.trim(),
      };
      const t = c.querySelector('.r-temp').value;
      if (t !== '') role.temperature = Number(t);
      const e = c.querySelector('.r-effort').value;
      if (e) role.reasoningEffort = e;
      return role;
    });
    setup.defaultRole = $('agent-default-role').value || (setup.roles[0] && setup.roles[0].id);
  }
  return setup;
}

function updateAgentJsonPreview() {
  try {
    $('agent-json').textContent = JSON.stringify(collectAgentFromForm(), null, 2);
  } catch { /* formulário incompleto */ }
}
document.querySelector('#tab-agents .side-editor').addEventListener('input', () => {
  syncDefaultRoleOptions();
  updateAgentJsonPreview();
});

function editAgent(id) {
  const a = state.agents.find((x) => x.id === id);
  if (!a) return;
  state.currentAgentId = id;
  state.currentAgentRaw = a;
  fillAgentForm(a);
  renderAgentList();
}
$('agent-new').addEventListener('click', () => {
  state.currentAgentId = null;
  state.currentAgentRaw = null;
  fillAgentForm({ mode: 'single', model: '', temperature: 0.6 });
  renderAgentList();
});
$('agent-save').addEventListener('click', async () => {
  const setup = collectAgentFromForm();
  if (!setup.id) return toast('Informe um id pro setup.', 'error');
  if (setup.mode === 'single' && !setup.model) return toast('Modo único precisa de um modelo.', 'error');
  if (setup.mode === 'router') {
    if (!setup.router.model) return toast('Informe o modelo do roteador.', 'error');
    if (!setup.roles.length || setup.roles.some((r) => !r.id || !r.model)) {
      return toast('Cada papel precisa de id e modelo.', 'error');
    }
  }
  try {
    await api(`/api/agents/${encodeURIComponent(setup.id)}`, { method: 'PUT', body: setup });
    state.currentAgentId = setup.id;
    toast(`Setup salvo: ${setup.id}.json`);
    await loadAgents();
    state.currentAgentRaw = state.agents.find((x) => x.id === setup.id) || setup;
  } catch (e) { toast('Erro ao salvar: ' + e.message, 'error'); }
});
$('agent-delete').addEventListener('click', async () => {
  const id = ($('agent-id').value || '').trim();
  if (!id) return;
  if (!confirm(`Excluir o setup "${id}"? Esta ação não tem volta.`)) return;
  await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.currentAgentId = null;
  state.currentAgentRaw = null;
  toast(`Setup excluído: ${id}`);
  $('agent-new').click();
  await loadAgents();
});

function renderRunAgentSelect() {
  const sel = $('run-agent-setup');
  const prev = sel.value;
  sel.innerHTML = '';
  sel.appendChild(new Option('(modelo único — usa o campo abaixo)', ''));
  for (const a of state.agents) sel.appendChild(new Option(`${a.name || a.id} · ${a.mode === 'router' ? 'roteador' : 'único'}`, a.id));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  onRunAgentChange();
}
function onRunAgentChange() {
  const id = $('run-agent-setup').value;
  const setup = state.agents.find((a) => a.id === id);
  $('run-single-models').style.display = setup ? 'none' : 'flex';
  if (setup) {
    if (setup.promptId) $('run-prompt').value = setup.promptId;
    $('run-setup-info').textContent =
      setup.mode === 'router'
        ? `roteador ${setup.router?.model} → ${(setup.roles || []).map((r) => `${r.id}: ${r.model}`).join(' · ')}`
        : `modelo: ${setup.model}`;
  } else {
    $('run-setup-info').textContent = '';
  }
}
$('run-agent-setup').addEventListener('change', onRunAgentChange);

// ============================================================
// ICPs — ficha em campos (chave/valor), não JSON
// ============================================================
async function loadIcps() {
  state.icps = await api('/api/icps');
  renderIcpList();
  renderRunIcps();
  if (!state.currentIcpId && state.icps.length) editIcp(state.icps[0].id);
}
function renderIcpList() {
  const ul = $('icp-ul');
  ul.innerHTML = '';
  if (!state.icps.length) ul.appendChild(el('li', 'muted-item', 'nenhum perfil ainda'));
  for (const icp of state.icps) {
    const li = el('li');
    if (icp.id === state.currentIcpId) li.classList.add('active');
    li.appendChild(el('div', null, icp.name || icp.id));
    li.appendChild(el('small', null, icp.id));
    li.addEventListener('click', () => editIcp(icp.id));
    ul.appendChild(li);
  }
}

function renderStageSelect(sel, selectedId) {
  sel.innerHTML = '';
  const stages = state.toolsCfg.stages || [];
  for (const s of stages) sel.appendChild(new Option(`${s.id} · ${s.name}`, String(s.id)));
  if (selectedId != null && ![...sel.options].some((o) => o.value === String(selectedId))) {
    sel.appendChild(new Option(`${selectedId} · (fora do funil)`, String(selectedId)));
  }
  if (selectedId != null) sel.value = String(selectedId);
}

function fichaRow(key = '', value = '') {
  const row = el('div', 'kv-row');
  const k = input('k', key, 'campo (ex.: nome)');
  k.setAttribute('aria-label', 'Nome do campo');
  const v = input('v', value, 'valor');
  v.setAttribute('aria-label', 'Valor do campo');
  const rm = el('button', 'icon-btn', '×');
  rm.type = 'button';
  rm.title = 'Remover campo';
  rm.setAttribute('aria-label', 'Remover campo');
  rm.addEventListener('click', () => row.remove());
  row.appendChild(k); row.appendChild(v); row.appendChild(rm);
  return row;
}
$('ficha-add').addEventListener('click', () => $('ficha-rows').appendChild(fichaRow()));

function fillFicha(ficha) {
  const box = $('ficha-rows');
  box.innerHTML = '';
  const entries = Object.entries(ficha || {});
  if (!entries.length) {
    for (const k of ['nome', 'nicho', 'regiao', 'decisor', 'observacoes']) box.appendChild(fichaRow(k, ''));
    return;
  }
  for (const [k, v] of entries) {
    box.appendChild(fichaRow(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }
}
function collectFicha() {
  const ficha = {};
  document.querySelectorAll('#ficha-rows .kv-row').forEach((r) => {
    const k = r.querySelector('.k').value.trim();
    const v = r.querySelector('.v').value;
    if (k) ficha[k] = v;
  });
  return ficha;
}

function editIcp(id) {
  const icp = state.icps.find((i) => i.id === id);
  if (!icp) return;
  state.currentIcpId = id;
  state.currentIcpRaw = icp;
  $('icp-id').value = icp.id;
  $('icp-name').value = icp.name || '';
  renderStageSelect($('icp-stage'), icp.startStageId || (state.toolsCfg.stages[0] && state.toolsCfg.stages[0].id));
  $('icp-persona').value = icp.persona || '';
  fillFicha(icp.ficha);
  renderIcpList();
}
$('icp-new').addEventListener('click', () => {
  state.currentIcpId = null;
  state.currentIcpRaw = null;
  $('icp-id').value = '';
  $('icp-name').value = '';
  renderStageSelect($('icp-stage'), state.toolsCfg.stages[0] && state.toolsCfg.stages[0].id);
  $('icp-persona').value = '';
  fillFicha({});
  renderIcpList();
});
$('icp-save').addEventListener('click', async () => {
  const id = ($('icp-id').value || '').trim();
  if (!id) return toast('Informe um id pro perfil.', 'error');
  const base = state.currentIcpRaw ? JSON.parse(JSON.stringify(state.currentIcpRaw)) : {};
  const icp = {
    ...base,
    id,
    name: $('icp-name').value,
    startStageId: Number($('icp-stage').value) || undefined,
    persona: $('icp-persona').value,
    ficha: collectFicha(),
  };
  try {
    await api(`/api/icps/${encodeURIComponent(id)}`, { method: 'PUT', body: icp });
    state.currentIcpId = id;
    toast(`Perfil salvo: ${id}.json`);
    await loadIcps();
    state.currentIcpRaw = state.icps.find((i) => i.id === id) || icp;
  } catch (e) { toast('Erro ao salvar: ' + e.message, 'error'); }
});
$('icp-delete').addEventListener('click', async () => {
  const id = ($('icp-id').value || '').trim();
  if (!id) return;
  if (!confirm(`Excluir o perfil "${id}"? Esta ação não tem volta.`)) return;
  await api(`/api/icps/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.currentIcpId = null;
  toast(`Perfil excluído: ${id}`);
  $('icp-new').click();
  await loadIcps();
});

// ============================================================
// FERRAMENTAS & FUNIL — configuráveis pelo usuário
// ============================================================
const EFFECT_LABELS = {
  think: 'raciocínio interno (think)',
  create_person: 'criar contato',
  link_person: 'vincular contato ao deal',
  create_activity: 'criar atividade pra humano',
  create_note: 'criar nota no deal',
  update_stage: 'mover estágio do funil',
  notify_human: 'avisar a equipe humana',
  handoff: 'transferir pra humano (encerra)',
  log: 'registrar chamada (sem efeito no CRM)',
};
const EFFECT_PARAM_HINTS = {
  think: 'lê o argumento: input',
  create_person: 'lê os argumentos: name, phone',
  link_person: 'lê o argumento: person_id',
  create_activity: 'lê os argumentos: subject, type, note',
  create_note: 'lê o argumento: content',
  update_stage: 'lê o argumento: stage_id (a lista de estágios entra sozinha na descrição)',
  notify_human: 'lê o argumento: message',
  handoff: 'lê o argumento: motivo · encerra a conversa (handoff)',
  log: 'aceita qualquer argumento; só registra a chamada na transcrição',
};

async function loadTools() {
  state.toolsCfg = await api('/api/tools');
  renderToolsEditor();
  renderStageSelect($('icp-stage'), $('icp-stage').value || (state.toolsCfg.stages[0] && state.toolsCfg.stages[0].id));
}

function stageRow(stage = {}) {
  const row = el('div', 'kv-row');
  const id = input('stage-id', stage.id != null ? String(stage.id) : '', 'id');
  id.type = 'number';
  id.setAttribute('aria-label', 'Id do estágio');
  const name = input('v', stage.name || '', 'nome do estágio');
  name.setAttribute('aria-label', 'Nome do estágio');
  const rm = el('button', 'icon-btn', '×');
  rm.type = 'button';
  rm.title = 'Remover estágio';
  rm.setAttribute('aria-label', 'Remover estágio');
  rm.addEventListener('click', () => row.remove());
  row.appendChild(id); row.appendChild(name); row.appendChild(rm);
  return row;
}
$('stage-add').addEventListener('click', () => $('stage-rows').appendChild(stageRow()));

function paramRow(p = {}) {
  const row = el('div', 'param-row');
  const name = input('p-name', p.name || '', 'nome_do_argumento');
  name.setAttribute('aria-label', 'Nome do argumento');
  const type = document.createElement('select');
  type.className = 'p-type';
  for (const t of ['string', 'number', 'boolean']) type.appendChild(new Option(t, t));
  type.value = p.type || 'string';
  const reqLab = el('label', 'p-req');
  const req = document.createElement('input');
  req.type = 'checkbox';
  req.className = 'p-required';
  req.checked = Boolean(p.required);
  reqLab.appendChild(req);
  reqLab.appendChild(document.createTextNode('obrigatório'));
  const desc = input('p-desc', p.description || '', 'descrição (o modelo lê isto)');
  const rm = el('button', 'icon-btn', '×');
  rm.type = 'button';
  rm.title = 'Remover argumento';
  rm.setAttribute('aria-label', 'Remover argumento');
  rm.addEventListener('click', () => row.remove());
  row.appendChild(name); row.appendChild(type); row.appendChild(reqLab); row.appendChild(desc); row.appendChild(rm);
  return row;
}

function toolCard(tool = {}) {
  const card = el('div', 'tool-card');
  if (tool.enabled === false) card.classList.add('disabled');

  const head = el('div', 'tool-head');
  head.appendChild(fieldWrap('Nome interno (o modelo chama por este)', input('t-name code', tool.name || '', 'ex.: agendar_reuniao')));
  head.appendChild(fieldWrap('Nome de exibição', input('t-display', tool.displayName || '', 'como aparece na interface')));
  const toggleLab = el('label', 'tool-toggle');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 't-enabled';
  toggle.checked = tool.enabled !== false;
  toggle.addEventListener('change', () => card.classList.toggle('disabled', !toggle.checked));
  toggleLab.appendChild(toggle);
  toggleLab.appendChild(document.createTextNode('ativa'));
  const rm = el('button', 'icon-btn', '×');
  rm.type = 'button';
  rm.title = 'Remover ferramenta';
  rm.setAttribute('aria-label', 'Remover ferramenta');
  rm.addEventListener('click', () => {
    if (confirm('Remover esta ferramenta da configuração?')) card.remove();
  });
  toggleLab.appendChild(rm);
  head.appendChild(toggleLab);
  card.appendChild(head);

  card.appendChild(fieldWrap('Descrição (o modelo decide usar a ferramenta por isto)', textarea('t-desc', tool.description || '')));

  const effSel = document.createElement('select');
  effSel.className = 't-effect';
  for (const e of state.toolsCfg.effects || Object.keys(EFFECT_LABELS)) {
    effSel.appendChild(new Option(EFFECT_LABELS[e] || e, e));
  }
  effSel.value = tool.effect || 'log';
  card.appendChild(fieldWrap('Efeito no CRM simulado', effSel));
  const effHint = el('p', 'hint', EFFECT_PARAM_HINTS[effSel.value] || '');
  effSel.addEventListener('change', () => { effHint.textContent = EFFECT_PARAM_HINTS[effSel.value] || ''; });
  card.appendChild(effHint);

  const pHead = el('div', 'params-head');
  pHead.appendChild(el('span', null, 'argumentos'));
  const pAdd = el('button', 'btn btn-ghost btn-sm', '+ argumento');
  pAdd.type = 'button';
  const pRows = el('div', 'param-rows');
  pAdd.addEventListener('click', () => pRows.appendChild(paramRow()));
  pHead.appendChild(pAdd);
  card.appendChild(pHead);
  for (const p of tool.params || []) pRows.appendChild(paramRow(p));
  card.appendChild(pRows);

  return card;
}
$('tool-add').addEventListener('click', () => {
  const card = toolCard({ effect: 'log', enabled: true, params: [] });
  $('tool-cards').appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('.t-name').focus();
});

function renderToolsEditor() {
  const sr = $('stage-rows');
  sr.innerHTML = '';
  for (const s of state.toolsCfg.stages || []) sr.appendChild(stageRow(s));
  const tc = $('tool-cards');
  tc.innerHTML = '';
  for (const t of state.toolsCfg.tools || []) tc.appendChild(toolCard(t));
}

function collectToolsFromDom() {
  const stages = [...document.querySelectorAll('#stage-rows .kv-row')]
    .map((r) => ({ id: Number(r.querySelector('.stage-id').value), name: r.querySelector('.v').value.trim() }))
    .filter((s) => Number.isFinite(s.id) && s.name);
  const tools = [...document.querySelectorAll('#tool-cards .tool-card')].map((c) => ({
    name: c.querySelector('.t-name').value.trim(),
    displayName: c.querySelector('.t-display').value.trim(),
    description: c.querySelector('.t-desc').value.trim(),
    effect: c.querySelector('.t-effect').value,
    enabled: c.querySelector('.t-enabled').checked,
    params: [...c.querySelectorAll('.param-row')]
      .map((r) => ({
        name: r.querySelector('.p-name').value.trim(),
        type: r.querySelector('.p-type').value,
        required: r.querySelector('.p-required').checked,
        description: r.querySelector('.p-desc').value.trim(),
      }))
      .filter((p) => p.name),
  }));
  return { stages, tools };
}

$('tools-save').addEventListener('click', async () => {
  const cfg = collectToolsFromDom();
  if (!cfg.stages.length) return toast('O funil precisa de ao menos um estágio.', 'error');
  try {
    const saved = await api('/api/tools', { method: 'PUT', body: cfg });
    state.toolsCfg = { ...saved, effects: state.toolsCfg.effects };
    renderToolsEditor();
    renderStageSelect($('icp-stage'), $('icp-stage').value);
    toast('Ferramentas salvas — valem a partir da próxima simulação.');
  } catch (e) { toast('Erro ao salvar: ' + e.message, 'error'); }
});
$('tools-restore').addEventListener('click', async () => {
  if (!confirm('Carregar a configuração padrão de ferramentas e funil? Suas edições atuais na tela serão substituídas (nada é salvo até você clicar em Salvar).')) return;
  const def = await api('/api/tools/defaults');
  state.toolsCfg = def;
  renderToolsEditor();
  toast('Padrões carregados — revise e clique em Salvar pra aplicar.');
});

// ============================================================
// RODAR — simulação ao vivo (SSE)
// ============================================================
function renderRunIcps() {
  const box = $('run-icps');
  box.innerHTML = '';
  if (!state.icps.length) {
    box.appendChild(el('p', 'hint', 'Nenhum perfil ainda — crie um na aba Clientes simulados.'));
    return;
  }
  for (const icp of state.icps) {
    const lab = el('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = icp.id;
    cb.checked = true;
    lab.appendChild(cb);
    const txt = el('span');
    txt.appendChild(el('span', null, icp.name || icp.id));
    txt.appendChild(el('small', null, icp.id));
    lab.appendChild(txt);
    box.appendChild(lab);
  }
}

$('run-btn').addEventListener('click', runSimulation);
$('cancel-btn').addEventListener('click', async () => {
  if (!state.jobId) return;
  state.cancelled = true;
  $('run-status').innerHTML = '<span class="spinner"></span> cancelando…';
  $('cancel-btn').disabled = true;
  try { await api(`/api/cancel/${state.jobId}`, { method: 'POST' }); } catch { /* job pode já ter terminado */ }
});
$('clear-btn').addEventListener('click', () => location.reload());

async function runSimulation() {
  const promptId = $('run-prompt').value;
  const icpIds = [...$('run-icps').querySelectorAll('input:checked')].map((c) => c.value);
  if (!promptId) return toast('Selecione um prompt.', 'error');
  if (!icpIds.length) return toast('Selecione ao menos um cliente simulado.', 'error');

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

  $('run-output').innerHTML = '';
  $('run-btn').disabled = true;
  $('run-status').innerHTML = '<span class="spinner"></span> rodando…';
  $('run-status').classList.remove('error');
  state.cancelled = false;

  let jobId;
  try {
    ({ jobId } = await api('/api/simulate', { method: 'POST', body }));
  } catch (e) {
    $('run-status').textContent = 'erro: ' + e.message;
    $('run-status').classList.add('error');
    $('run-btn').disabled = false;
    return;
  }
  state.jobId = jobId;
  $('cancel-btn').disabled = false;

  if (state.es) state.es.close();
  const es = new EventSource(`/api/stream/${jobId}`);
  state.es = es;
  state.currentCard = null;
  es.onmessage = (ev) => handleEvent(JSON.parse(ev.data));
  es.onerror = () => es.close(); // stream encerrado pelo servidor ao concluir
}

function newConvoCard(evt) {
  const name = evt.icp?.name || evt.icpId || 'Conversa';
  const card = el('div', 'convo');
  const head = el('div', 'convo-head');
  const idBox = el('div', 'convo-id');
  idBox.appendChild(el('span', 'avatar', (name[0] || '?').toUpperCase()));
  const titleBox = el('span');
  titleBox.appendChild(el('b', null, name));
  const stage = el('span', 'stage', 'começando…');
  titleBox.appendChild(stage);
  idBox.appendChild(titleBox);
  head.appendChild(idBox);
  const cost = el('span', 'cost-pill', 'custo $0.0000');
  head.appendChild(cost);
  card.appendChild(head);
  const bodyEl = el('div', 'convo-body');
  card.appendChild(bodyEl);
  $('run-output').appendChild(card);
  const obj = { card, body: bodyEl, stage, cost };
  state.currentCard = obj;
  return obj;
}

function outcomeLabel(o) {
  if (o.budgetExceeded) return { text: 'estourou o teto', cls: 'budget' };
  if (o.decision === 'closed') return { text: '[FECHOU] a compra', cls: 'closed' };
  if (o.decision === 'declined') return { text: '[RECUSOU]', cls: 'declined' };
  if (o.endReason === 'handoff') return { text: 'passou pra humano', cls: 'handoff' };
  return { text: o.endReason, cls: '' };
}

function scrollRunToEnd() {
  const pane = $('tab-run');
  pane.scrollTop = pane.scrollHeight;
}

function handleEvent(evt) {
  switch (evt.type) {
    case 'start':
      newConvoCard(evt);
      break;
    case 'agent': {
      const c = state.currentCard;
      if (!c) break;
      const rt = evt.route;
      if (rt && rt.roleId && rt.roleId !== 'single') {
        const cls = rt.roleId === 'closer' ? 'closer' : '';
        const badge = el('div', `route-badge ${cls}`, `${rt.roleId} · ${rt.model}`);
        if (rt.reason) badge.title = rt.reason;
        c.body.appendChild(badge);
      }
      if (typeof evt.cost === 'number') c.cost.textContent = 'custo ' + usd(evt.cost);
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
        c.body.appendChild(el('div', 'who agent', 'agente de IA'));
        c.body.appendChild(el('div', 'msg agent', evt.message.text));
      } else if (!evt.message.error) {
        c.body.appendChild(el('div', 'sys-note', '(o agente não gerou mensagem de texto neste turno)'));
      }
      if (evt.crm) c.stage.textContent = `estágio ${evt.crm.stageId} · ${evt.crm.stageName}` + (evt.crm.escalated ? ' · escalado' : '');
      break;
    }
    case 'lead': {
      const c = state.currentCard;
      if (!c) break;
      if (typeof evt.cost === 'number') c.cost.textContent = 'custo ' + usd(evt.cost);
      if (!evt.message.text) break;
      c.body.appendChild(el('div', 'who', 'cliente simulado'));
      c.body.appendChild(el('div', 'msg lead', evt.message.text));
      break;
    }
    case 'error': {
      const c = state.currentCard;
      if (c) c.body.appendChild(el('div', 'sys-note error', `[erro ${evt.side}] ${evt.error}`));
      break;
    }
    case 'budget': {
      const c = state.currentCard;
      if (c) c.body.appendChild(el('div', 'sys-note', `teto de custo atingido: ${usd(evt.total)} ≥ ${usd(evt.maxCost)} — encerrando`));
      break;
    }
    case 'end': {
      const c = state.currentCard;
      if (c) {
        const o = evt.outcome;
        const { text, cls } = outcomeLabel(o);
        const bar = el('div', 'endbar');
        bar.appendChild(el('span', `outcome-pill ${cls}`, text));
        bar.appendChild(el('span', null, `estágio ${o.reachedStageId} ${o.reachedStageName} · ${o.turns} turnos`));
        const totalCost = (evt.cost && evt.cost.total) ?? o.totalCost ?? 0;
        bar.appendChild(el('span', 'cost-b', `custo ${usd(totalCost)}`));
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
        const a = el('a', 'dl', 'baixar JSON ↓');
        a.href = `/api/runs/${encodeURIComponent(evt.file)}`;
        a.setAttribute('download', evt.file);
        c.endbar.appendChild(a);
      }
      break;
    }
    case 'cancelled': {
      state.cancelled = true;
      const c = state.currentCard;
      if (c && !c.endbar) c.body.appendChild(el('div', 'sys-note', '[cancelado pelo usuário]'));
      break;
    }
    case 'complete':
      $('run-status').textContent = (evt.cancelled || state.cancelled)
        ? 'cancelado. nada foi salvo da conversa interrompida.'
        : 'concluído. transcrições salvas em output/runs/.';
      $('run-btn').disabled = false;
      $('cancel-btn').disabled = true;
      state.jobId = null;
      if (state.es) state.es.close();
      break;
    case 'fatal':
      $('run-status').textContent = 'erro: ' + evt.error;
      $('run-status').classList.add('error');
      $('run-btn').disabled = false;
      $('cancel-btn').disabled = true;
      state.jobId = null;
      if (state.es) state.es.close();
      break;
  }
  scrollRunToEnd();
}

// ============================================================
// HISTÓRICO
// ============================================================
async function loadRuns() {
  const runs = await api('/api/runs');
  const ul = $('history-ul');
  ul.innerHTML = '';
  if (!runs.length) {
    ul.appendChild(el('li', 'muted-item', 'nenhuma transcrição ainda'));
    return;
  }
  for (const r of runs) {
    const li = el('li');
    li.appendChild(el('div', null, r.icp || r.file));
    const o = r.outcome || {};
    li.appendChild(el('small', null, `${o.endReason || '?'} · est. ${o.reachedStageId ?? '?'} · ${(r.createdAt || '').slice(0, 16).replace('T', ' ')}`));
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
  const cost = run.cost || {};
  const agentDesc = ag.mode === 'router'
    ? `roteador ${ag.routerModel} → ${(ag.roles || []).map((r) => `${r.id}: ${r.model}`).join(' · ')}`
    : ag.model || '?';
  const span = (html) => { const s = el('span'); s.innerHTML = html; return s; };
  meta.appendChild(span(`cliente: <b></b>`));
  meta.lastChild.querySelector('b').textContent = run.icp?.name || run.icp?.id || '?';
  meta.appendChild(span(`prompt: <b></b>`));
  meta.lastChild.querySelector('b').textContent = ag.promptId || '?';
  meta.appendChild(span(`agente: <b></b>`));
  meta.lastChild.querySelector('b').textContent = agentDesc;
  meta.appendChild(el('span', 'badge', `fim: ${o.endReason}`));
  meta.appendChild(el('span', 'badge', `estágio ${o.reachedStageId} ${o.reachedStageName || ''}`));
  meta.appendChild(el('span', 'badge', `${o.turns} turnos`));
  if (o.escalated) meta.appendChild(el('span', 'badge', 'escalado'));
  meta.appendChild(el('span', 'badge accent', `custo ${usd(cost.total)}`));
  if (cost.byModel && Object.keys(cost.byModel).length > 1) {
    meta.appendChild(el('span', 'badge', Object.entries(cost.byModel).map(([m, c]) => `${m.split('/').pop()}: ${usd(c)}`).join(' · ')));
  }
  const dl = el('a', 'dl badge accent', 'baixar JSON ↓');
  dl.href = `/api/runs/${encodeURIComponent(file)}`;
  dl.setAttribute('download', file);
  meta.appendChild(dl);
  v.appendChild(meta);

  const body = el('div', 'convo-body');
  let lastRole = null;
  for (const m of run.messages) {
    if (m.role === 'agent') {
      if (m.roleId && m.roleId !== 'single') {
        const cls = m.roleId === 'closer' ? 'closer' : '';
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
        if (lastRole !== 'agent') body.appendChild(el('div', 'who agent', 'agente de IA'));
        body.appendChild(el('div', 'msg agent', m.text));
        lastRole = 'agent';
      } else {
        body.appendChild(el('div', 'sys-note', m.error ? `(turno vazio: ${m.error})` : '(sem mensagem de texto neste turno)'));
      }
    } else if (m.text) {
      if (lastRole !== 'lead') body.appendChild(el('div', 'who', 'cliente simulado'));
      body.appendChild(el('div', 'msg lead', m.text));
      lastRole = 'lead';
    }
  }
  v.appendChild(body);

  const notes = run.crmFinalState?.notes || [];
  if (notes.length) {
    const nb = el('div', 'notes-block');
    nb.appendChild(el('h4', null, 'notas no CRM simulado'));
    const ul = el('ul');
    for (const n of notes) ul.appendChild(el('li', null, n.content));
    nb.appendChild(ul);
    v.appendChild(nb);
  }
  const acts = run.crmFinalState?.activities || [];
  if (acts.length) {
    const ab = el('div', 'notes-block');
    ab.appendChild(el('h4', null, 'atividades criadas pra equipe'));
    const ul = el('ul');
    for (const a of acts) ul.appendChild(el('li', null, `[${a.type}] ${a.subject}: ${a.note}`));
    ab.appendChild(ul);
    v.appendChild(ab);
  }
}

// ---------- init ----------
(async function init() {
  await loadHealth();
  await loadTools();
  await loadPrompts();
  await loadAgents();
  await loadIcps();
  if (!state.agents.length) $('agent-new').click(); // formulário em estado válido mesmo sem setups
  const tab = location.hash.replace('#', '');
  if (tab && document.querySelector(`.nav-item[data-tab="${tab}"]`)) activateTab(tab);
})();
