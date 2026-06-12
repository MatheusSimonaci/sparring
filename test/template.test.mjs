// Testes do template de primeira mensagem (abertura fixa, sem LLM).
// Tudo deterministico (LLM injetado). Rode: node test/template.test.mjs
import assert from 'node:assert';
import { runConversation, renderTemplate } from '../src/sim/conversation.js';

let passed = 0;
const ok = (n) => { console.log('  ok -', n); passed++; };

// ---------- renderTemplate ----------
{
  const ficha = { nome: 'Carla', marca: 'M&R Planejados' };
  assert.equal(
    renderTemplate('Oi {nome}, encontrei a {empresa} no Maps.', ficha),
    'Oi Carla, encontrei a M&R Planejados no Maps.'
  );
  ok('renderTemplate: resolve {nome} e o alias {empresa} -> ficha.marca');
}
{
  assert.equal(renderTemplate('Vi a {empresa} ali.', {}), 'Vi a {empresa} ali.');
  ok('renderTemplate: placeholder sem valor fica visivel (denuncia ficha incompleta)');
}

// ---------- runConversation com template ----------
const icp = { id: 'teste', name: 'Teste', persona: 'cliente', ficha: { nome: 'X', marca: 'Loja Y' }, startStageId: 6 };
const TEMPLATE = { id: 'abertura-teste', text: 'Oi! Montei um site pra {empresa}. Topa olhar?' };

function makeFakeChat({ closeAtLeadTurn = 99 } = {}) {
  let leadTurns = 0;
  let sawTemplateInIcpHistory = false;
  let agentSawOpeningFlagOff = true;
  const fake = async ({ messages }) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    if (sys.startsWith('Voce esta interpretando um CLIENTE')) {
      leadTurns++;
      const joined = messages.map((m) => m.content).join('\n');
      if (joined.includes('Loja Y')) sawTemplateInIcpHistory = true;
      const txt = leadTurns >= closeAtLeadTurn ? 'bora!\n[FECHOU]' : 'pode mandar o link';
      return { message: { content: txt }, cost: 0.001, promptTokens: 8, completionTokens: 4 };
    }
    // agente
    return { message: { content: 'aqui esta o link', tool_calls: [] }, cost: 0.01, promptTokens: 20, completionTokens: 10 };
  };
  fake.stats = () => ({ leadTurns, sawTemplateInIcpHistory, agentSawOpeningFlagOff });
  return fake;
}

{
  const chat = makeFakeChat({ closeAtLeadTurn: 2 });
  const t = await runConversation({
    systemPrompt: 'PLAYBOOK',
    icp,
    agentModel: 'agent-model',
    icpModel: 'icp-model',
    maxTurns: 6,
    maxCost: 0,
    agentTemperature: 0.5,
    icpTemperature: 0.5,
    openingTemplate: TEMPLATE,
    chatOverride: chat,
  });
  const first = t.messages[0];
  assert.equal(first.role, 'agent');
  assert.equal(first.roleId, 'template');
  assert.equal(first.templateId, 'abertura-teste');
  assert.equal(first.text, 'Oi! Montei um site pra Loja Y. Topa olhar?');
  assert.equal(first.model, null, 'template nao passa por LLM');
  assert.equal(t.messages[1].role, 'lead', 'ICP responde ao template antes do agente pensar');
  assert.equal(t.messages[2].role, 'agent', 'agente assume apos a resposta do lead');
  assert.equal(t.agent.openingTemplateId, 'abertura-teste');
  assert.equal(t.outcome.turns, 1, 'template nao conta como turno de LLM do agente');
  assert.equal(t.outcome.decision, 'closed');
  assert.ok(chat.stats().sawTemplateInIcpHistory, 'ICP recebeu o texto do template no historico');
  ok('runConversation: template injetado, ICP responde primeiro, agente assume com historico');
}

{
  // ICP encerra ja na resposta ao template: agente nunca roda, custo de agente zero.
  const chat = makeFakeChat({ closeAtLeadTurn: 1 });
  const t = await runConversation({
    systemPrompt: 'PLAYBOOK',
    icp,
    agentModel: 'agent-model',
    icpModel: 'icp-model',
    maxTurns: 6,
    maxCost: 0,
    openingTemplate: TEMPLATE,
    chatOverride: chat,
  });
  assert.equal(t.outcome.turns, 0);
  assert.equal(t.outcome.decision, 'closed');
  assert.equal(t.cost.byComponent.single || 0, 0, 'nenhum custo de agente');
  ok('runConversation: lead encerrando na resposta ao template nao roda o agente');
}

{
  // Sem template: comportamento original (agente abre a conversa).
  const chat = makeFakeChat({ closeAtLeadTurn: 1 });
  const t = await runConversation({
    systemPrompt: 'PLAYBOOK',
    icp,
    agentModel: 'agent-model',
    icpModel: 'icp-model',
    maxTurns: 6,
    maxCost: 0,
    chatOverride: chat,
  });
  assert.equal(t.messages[0].role, 'agent');
  assert.notEqual(t.messages[0].roleId, 'template');
  assert.equal(t.agent.openingTemplateId, null);
  ok('runConversation: sem template, o agente segue abrindo a conversa');
}

console.log(`\n${passed} casos passaram.`);
