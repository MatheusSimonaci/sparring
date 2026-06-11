// Roteador: a cada turno, escolhe qual "papel" (modelo) responde o lead,
// com base nas descricoes dos papeis. Modelo barato (ex.: gpt-oss-120b).
import { chatCompletion } from '../llm/openrouter.js';
import { stageName } from '../tools/tools.js';

function recentLines(history, n = 8) {
  return history
    .slice(-n)
    .map((m) => `${m.role === 'agent' ? 'ATENDENTE' : 'LEAD'}: ${m.text}`)
    .join('\n');
}

function lastLead(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'lead') return history[i].text;
  }
  return '';
}

function buildMessages(setup, history, crm, isOpening) {
  const roles = setup.roles || [];
  const rolesDesc = roles
    .map((r) => `- id: ${r.id} (${r.label || r.id}) -> ${r.description || '(sem descricao)'}`)
    .join('\n');
  const ids = roles.map((r) => r.id).join(' | ');

  const system = [
    'Voce e o ROTEADOR de um time de vendas por WhatsApp da 4virtue.',
    'A cada mensagem do lead, voce decide qual ATENDENTE deve responder agora, com base nas descricoes abaixo.',
    'Escolha o atendente mais adequado para ESTE momento da conversa.',
    '',
    'ATENDENTES DISPONIVEIS:',
    rolesDesc,
    '',
    `Responda SOMENTE com um JSON, sem texto antes ou depois, no formato: {"role":"<um de: ${ids}>","reason":"<motivo curto>"}`,
  ].join('\n');

  const user = isOpening
    ? [
        `Estagio do funil: ${crm.stageId} - ${stageName(crm.stageId)}.`,
        'E a ABERTURA da conversa (o lead ainda nao respondeu).',
        'Qual atendente deve enviar a primeira mensagem?',
      ].join('\n')
    : [
        `Estagio do funil: ${crm.stageId} - ${stageName(crm.stageId)}.`,
        'Conversa recente:',
        recentLines(history),
        '',
        `Ultima mensagem do lead: "${lastLead(history)}"`,
        'Qual atendente deve responder agora?',
      ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function parseDecision(text, roles, defaultRole) {
  const ids = roles.map((r) => r.id);
  let parsed = null;
  if (text) {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }
  let roleId = parsed && parsed.role;
  const reason = (parsed && parsed.reason) || '';
  if (!ids.includes(roleId)) {
    // fallback: tenta achar um id citado no texto cru, senao usa o default
    roleId = ids.find((id) => text && text.toLowerCase().includes(id.toLowerCase())) || defaultRole;
    return { roleId, reason: reason || '(fallback: decisao do roteador nao reconhecida)', fallback: true };
  }
  return { roleId, reason, fallback: false };
}

/**
 * Decide o papel do turno.
 * @returns {Promise<{roleId, reason, fallback, cost, promptTokens, completionTokens, model}>}
 */
export async function routeTurn({ setup, history, crm, isOpening, signal, chat = chatCompletion }) {
  const roles = setup.roles || [];
  const defaultRole = setup.defaultRole || (roles[0] && roles[0].id);
  const r = setup.router || {};

  const resp = await chat({
    model: r.model,
    messages: buildMessages(setup, history, crm, isOpening),
    temperature: typeof r.temperature === 'number' ? r.temperature : undefined,
    reasoningEffort: r.reasoningEffort || undefined,
    maxTokens: r.maxTokens || 512,
    signal,
  });

  const text = resp.message?.content || '';
  const decision = parseDecision(text, roles, defaultRole);
  return {
    ...decision,
    cost: resp.cost || 0,
    promptTokens: resp.promptTokens || 0,
    completionTokens: resp.completionTokens || 0,
    model: r.model,
  };
}
