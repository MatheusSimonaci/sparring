// Orquestra uma conversa completa: agente (bot sob teste) x ICP (cliente simulado).
// Suporta roteamento multi-modelo (router -> papel) e medicao de custo + teto de orcamento.
import crypto from 'node:crypto';
import { runAgentTurn } from '../agent/salesAgent.js';
import { runIcpTurn } from '../icp/icpClient.js';
import { routeTurn } from '../agent/router.js';
import { createCrmState, stageName, firstStageId } from '../tools/tools.js';
import { config } from '../config.js';

function hashPrompt(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex').slice(0, 12);
}

function summarize(text, n = 180) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '...' : t;
}

// Constroi um "setup" single a partir dos parametros legados (compat).
function singleSetup({ model, temperature, reasoningEffort }) {
  return { mode: 'single', model, temperature, reasoningEffort: reasoningEffort || null };
}

// Renderiza placeholders {campo} do template com os dados da ficha do lead.
// {empresa} e alias de {marca}. Placeholder sem valor fica visivel no texto
// (proposital: aparece na transcricao e denuncia ficha incompleta).
export function renderTemplate(text, ficha = {}) {
  return String(text).replace(/\{(\w+)\}/g, (raw, key) => {
    if (key === 'empresa') return ficha.marca || ficha.empresa || raw;
    const v = ficha[key];
    return v == null || v === '' ? raw : String(v);
  });
}

function resolveRole(setup, roleId) {
  if (setup.mode !== 'router') {
    return {
      roleId: 'single',
      model: setup.model,
      temperature: setup.temperature,
      reasoningEffort: setup.reasoningEffort || null,
      addendum: '',
    };
  }
  const roles = setup.roles || [];
  const role = roles.find((r) => r.id === roleId) || roles[0] || {};
  return {
    roleId: role.id,
    model: role.model,
    temperature: typeof role.temperature === 'number' ? role.temperature : undefined,
    reasoningEffort: role.reasoningEffort || null,
    addendum: role.promptAddendum || '',
  };
}

export async function runConversation(opts) {
  const {
    systemPrompt,
    icp,
    agentSetup,
    agentModel,
    icpModel,
    maxTurns,
    agentTemperature,
    icpTemperature,
    promptId = 'custom',
    onEvent = () => {},
    signal,
    agentMaxTokens = config.agentMaxTokens,
    icpMaxTokens = config.icpMaxTokens,
    maxCost = config.maxCostPerConversation,
    chatOverride, // injetavel pra teste (substitui o cliente LLM em router/agente/icp)
    openingTemplate = null, // { id, text }: primeiro toque FIXO, enviado sem LLM
  } = opts;

  const setup =
    agentSetup && agentSetup.mode
      ? agentSetup
      : singleSetup({ model: agentModel, temperature: agentTemperature });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const crm = createCrmState({ stageId: icp.startStageId || firstStageId() });

  const messages = [];
  const allToolCalls = [];
  const history = [];
  const routing = []; // decisoes do roteador por turno

  // ---- custo ----
  const cost = { total: 0, byComponent: {}, byModel: {}, currency: 'USD' };
  const tokens = { byModel: {} };
  function addCost(component, model, c, pt, ct) {
    c = c || 0;
    cost.total += c;
    cost.byComponent[component] = (cost.byComponent[component] || 0) + c;
    if (model) {
      cost.byModel[model] = (cost.byModel[model] || 0) + c;
      const t = (tokens.byModel[model] = tokens.byModel[model] || { prompt: 0, completion: 0 });
      t.prompt += pt || 0;
      t.completion += ct || 0;
    }
  }

  let endReason = 'max_turns';
  let agentTurns = 0;
  let decision = null;
  let budgetExceeded = false;
  let agentNoiseStreak = 0; // guarda contra conversa que "arrasta" sem fim (narracao/vazio)

  onEvent({ type: 'start', conversationId: id, icp: { id: icp.id, name: icp.name }, createdAt });

  // ---- Turno do ICP (cliente). Usado no loop e logo apos o template de abertura. ----
  // Retorna 'break' quando a conversa deve encerrar.
  async function leadTurn() {
    let icpResult;
    try {
      icpResult = await runIcpTurn({
        icp,
        history,
        model: icpModel,
        temperature: icpTemperature,
        signal,
        maxTokens: icpMaxTokens,
        ...(chatOverride ? { chat: chatOverride } : {}),
      });
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        endReason = 'cancelled';
        return 'break';
      }
      endReason = 'icp_error';
      onEvent({ type: 'error', side: 'icp', error: String(err.message || err) });
      return 'break';
    }
    addCost('icp', icpModel, icpResult.cost, icpResult.promptTokens, icpResult.completionTokens);

    const leadMsg = { role: 'lead', text: icpResult.message, createdAt: new Date().toISOString() };
    messages.push(leadMsg);
    if (icpResult.message) history.push({ role: 'lead', text: icpResult.message });
    onEvent({ type: 'lead', turn: agentTurns, message: leadMsg, decision: icpResult.decision || null, cost: cost.total });

    if (icpResult.end) {
      decision = icpResult.decision || 'ended';
      endReason = decision === 'closed' ? 'closed' : decision === 'declined' ? 'declined' : 'icp_ended';
      return 'break';
    }

    if (maxCost > 0 && cost.total >= maxCost) {
      budgetExceeded = true;
      endReason = 'budget_exceeded';
      onEvent({ type: 'budget', total: cost.total, maxCost });
      return 'break';
    }
    return 'continue';
  }

  // ---- Abertura por template (primeiro toque fixo, sem LLM, custo zero) ----
  // Espelha a operacao real: a automacao dispara o template e o agente so comeca
  // a pensar quando o lead responde. O ICP responde ao template antes do loop.
  let openingClosed = false;
  if (openingTemplate && openingTemplate.text) {
    const rendered = renderTemplate(openingTemplate.text, icp.ficha);
    const templateMsg = {
      role: 'agent',
      text: rendered,
      createdAt: new Date().toISOString(),
      toolCalls: [],
      thinking: '',
      model: null,
      roleId: 'template',
      routerReason: null,
      templateId: openingTemplate.id,
    };
    messages.push(templateMsg);
    history.push({ role: 'agent', text: rendered });
    onEvent({ type: 'agent', turn: 0, message: templateMsg, crm: snapshotCrm(crm), route: { roleId: 'template', model: null, reason: null }, cost: cost.total });
    if ((await leadTurn()) === 'break') openingClosed = true;
  }

  for (let t = 0; t < maxTurns && !openingClosed; t++) {
    const isOpening = t === 0 && !openingTemplate;
    if (signal?.aborted) {
      endReason = 'cancelled';
      break;
    }

    // ---- Roteamento (decide qual papel/modelo responde) ----
    let routeInfo = null;
    let roleId = 'single';
    if (setup.mode === 'router') {
      try {
        const decisionRoute = await routeTurn({ setup, history, crm, isOpening, signal, ...(chatOverride ? { chat: chatOverride } : {}) });
        addCost('router', decisionRoute.model, decisionRoute.cost, decisionRoute.promptTokens, decisionRoute.completionTokens);
        roleId = decisionRoute.roleId;
        routeInfo = {
          reason: decisionRoute.reason,
          fallback: decisionRoute.fallback,
          routerModel: decisionRoute.model,
          routerCost: decisionRoute.cost,
        };
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) {
          endReason = 'cancelled';
          break;
        }
        // roteador falhou: usa o papel padrao e segue
        roleId = setup.defaultRole || (setup.roles && setup.roles[0] && setup.roles[0].id);
        routeInfo = { reason: `roteador falhou: ${String(err.message || err)}`, fallback: true };
      }
    }

    const role = resolveRole(setup, roleId);
    const effectivePrompt = role.addendum
      ? `${systemPrompt}\n\n---\n\n${role.addendum}`
      : systemPrompt;

    // ---- Turno do agente ----
    let agentResult;
    try {
      agentResult = await runAgentTurn({
        systemPrompt: effectivePrompt,
        ficha: icp.ficha,
        crm,
        history,
        model: role.model,
        temperature: role.temperature,
        reasoningEffort: role.reasoningEffort,
        nowIso: new Date().toISOString(),
        isOpening,
        signal,
        maxTokens: agentMaxTokens,
        ...(chatOverride ? { chat: chatOverride } : {}),
      });
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        endReason = 'cancelled';
        break;
      }
      endReason = 'agent_error';
      onEvent({ type: 'error', side: 'agent', error: String(err.message || err) });
      break;
    }
    agentTurns++;
    addCost(role.roleId, role.model, agentResult.cost, agentResult.promptTokens, agentResult.completionTokens);

    routing.push({
      turn: agentTurns,
      roleId: role.roleId,
      model: role.model,
      reason: routeInfo ? routeInfo.reason : null,
      fallback: routeInfo ? !!routeInfo.fallback : false,
      routerModel: routeInfo ? routeInfo.routerModel || null : null,
      routerCost: routeInfo ? routeInfo.routerCost || 0 : 0,
      agentCost: agentResult.cost || 0,
    });

    const agentMsg = {
      role: 'agent',
      text: agentResult.message,
      createdAt: new Date().toISOString(),
      toolCalls: agentResult.toolCalls,
      thinking: agentResult.thinking || '',
      model: role.model,
      roleId: role.roleId,
      routerReason: routeInfo ? routeInfo.reason : null,
    };
    if (agentResult.error) agentMsg.error = agentResult.error;
    messages.push(agentMsg);
    for (const tc of agentResult.toolCalls) allToolCalls.push({ turn: agentTurns, ...tc });
    if (agentResult.message) history.push({ role: 'agent', text: agentResult.message });

    onEvent({
      type: 'agent',
      turn: agentTurns,
      message: agentMsg,
      crm: snapshotCrm(crm),
      route: { roleId: role.roleId, model: role.model, reason: routeInfo ? routeInfo.reason : null },
      cost: cost.total,
    });

    if (agentResult.error) {
      console.warn(`[conversa ${icp.id}] turno ${agentTurns}: ${agentResult.error}`);
      onEvent({ type: 'error', side: 'agent', error: agentResult.error });
    }

    if (crm.iaDisabled) {
      endReason = 'handoff';
      break;
    }
    if (agentResult.error && !agentResult.message) {
      endReason = 'agent_error';
      break;
    }

    // ---- Silencio deliberado ----
    // O agente usou a ferramenta de silencio (effect 'silent') ou terminou o turno
    // so com ferramentas: nao ha mensagem pro lead (caixa postal, rejeicao seca,
    // encerramento). Na simulacao nada mais acontece sem evento externo.
    if (agentResult.silent || (!agentResult.message && agentResult.toolCalls.length > 0)) {
      endReason = 'agent_silent';
      break;
    }

    // ---- Guarda anti-arrasto: o agente parou de mandar mensagem de verdade ----
    // (ex.: so narracao tipo "*(conversa encerrada)*" ou vazio). Encerra apos 2 seguidos.
    const agentNoise = !agentResult.message || /^\*?\(/.test(agentResult.message.trim());
    agentNoiseStreak = agentNoise ? agentNoiseStreak + 1 : 0;
    if (agentNoiseStreak >= 2) {
      endReason = 'stalled';
      break;
    }

    // ---- Teto de orcamento ----
    if (maxCost > 0 && cost.total >= maxCost) {
      budgetExceeded = true;
      endReason = 'budget_exceeded';
      onEvent({ type: 'budget', total: cost.total, maxCost });
      break;
    }

    if (signal?.aborted) {
      endReason = 'cancelled';
      break;
    }

    // ---- Turno do ICP (cliente) ----
    if ((await leadTurn()) === 'break') break;
  }

  const transcript = buildTranscript({
    id,
    createdAt,
    icp,
    openingTemplate,
    setup,
    icpModel,
    promptId,
    systemPrompt,
    messages,
    allToolCalls,
    routing,
    crm,
    endReason,
    decision,
    budgetExceeded,
    agentTurns,
    cost,
    tokens,
    params: { maxTurns, agentTemperature, icpTemperature, maxCost },
  });

  onEvent({ type: 'end', conversationId: id, outcome: transcript.outcome, cost: transcript.cost });
  return transcript;
}

function snapshotCrm(crm) {
  return {
    stageId: crm.stageId,
    stageName: stageName(crm.stageId),
    person: crm.person,
    notes: crm.notes.length,
    activities: crm.activities.length,
    escalated: crm.escalated,
    iaDisabled: crm.iaDisabled,
  };
}

function buildTranscript(o) {
  const toolCounts = {};
  for (const tc of o.allToolCalls) toolCounts[tc.displayName] = (toolCounts[tc.displayName] || 0) + 1;
  const agentMessages = o.messages.filter((m) => m.role === 'agent' && m.text).length;
  const leadMessages = o.messages.filter((m) => m.role === 'lead' && m.text).length;

  const turnsByRole = {};
  for (const r of o.routing) turnsByRole[r.roleId] = (turnsByRole[r.roleId] || 0) + 1;

  const setup = o.setup;
  const agentInfo = {
    promptId: o.promptId,
    promptHash: hashPrompt(o.systemPrompt),
    mode: setup.mode || 'single',
    setupId: setup.id || null,
    setupName: setup.name || null,
    openingTemplateId: o.openingTemplate ? o.openingTemplate.id : null,
  };
  if (setup.mode === 'router') {
    agentInfo.routerModel = setup.router && setup.router.model;
    agentInfo.roles = (setup.roles || []).map((r) => ({
      id: r.id,
      model: r.model,
      reasoningEffort: r.reasoningEffort || null,
    }));
    agentInfo.defaultRole = setup.defaultRole || null;
  } else {
    agentInfo.model = setup.model;
    agentInfo.reasoningEffort = setup.reasoningEffort || null;
  }

  return {
    id: o.id,
    createdAt: o.createdAt,
    schemaVersion: 2,
    icp: {
      id: o.icp.id,
      name: o.icp.name,
      personaSummary: summarize(o.icp.persona),
      startStageId: o.icp.startStageId || firstStageId(),
    },
    agent: agentInfo,
    icpModel: o.icpModel,
    params: o.params,
    ficha: o.icp.ficha,
    messages: o.messages,
    toolCalls: o.allToolCalls,
    routing: o.routing,
    cost: {
      total: round6(o.cost.total),
      byComponent: roundMap(o.cost.byComponent),
      byModel: roundMap(o.cost.byModel),
      tokensByModel: o.tokens.byModel,
      currency: 'USD',
    },
    crmFinalState: {
      stageId: o.crm.stageId,
      stageName: stageName(o.crm.stageId),
      person: o.crm.person,
      notes: o.crm.notes,
      activities: o.crm.activities,
      contactHumanMessages: o.crm.contactHumanMessages,
      iaDisabled: o.crm.iaDisabled,
      escalated: o.crm.escalated,
    },
    outcome: {
      endReason: o.endReason,
      decision: o.decision || null,
      closed: o.decision === 'closed',
      budgetExceeded: !!o.budgetExceeded,
      turns: o.agentTurns,
      reachedStageId: o.crm.stageId,
      reachedStageName: stageName(o.crm.stageId),
      escalated: o.crm.escalated,
      iaDisabled: o.crm.iaDisabled,
      totalCost: round6(o.cost.total),
    },
    metrics: {
      toolCounts,
      noteCount: o.crm.notes.length,
      activityCount: o.crm.activities.length,
      agentMessages,
      leadMessages,
      turnsByRole,
      costTotal: round6(o.cost.total),
      costByModel: roundMap(o.cost.byModel),
    },
  };
}

function round6(n) {
  return Math.round((n || 0) * 1e6) / 1e6;
}
function roundMap(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) out[k] = round6(v);
  return out;
}
