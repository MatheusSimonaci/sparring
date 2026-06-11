// Testes do roteamento multi-modelo, acumulo de custo e teto de orcamento.
// Tudo deterministico (LLM injetado). Rode: node test/routing.test.mjs
import assert from 'node:assert';
import { routeTurn } from '../src/agent/router.js';
import { runConversation } from '../src/sim/conversation.js';
import { createCrmState } from '../src/tools/tools.js';

let passed = 0;
const ok = (n) => { console.log('  ok -', n); passed++; };

const SETUP = {
  id: 'test-router',
  mode: 'router',
  promptId: 'v2',
  router: { model: 'router-model', temperature: 0 },
  roles: [
    { id: 'vendedor', label: 'Vendedor', model: 'seller-model', description: 'conversa geral' },
    { id: 'closer', label: 'Closer', model: 'closer-model', description: 'preco e fechamento', promptAddendum: 'voce e o closer' },
  ],
  defaultRole: 'vendedor',
};

// ---------- routeTurn: parsing ----------
{
  const chat = async () => ({ message: { content: '{"role":"closer","reason":"pediu preco"}' }, cost: 0.0001, promptTokens: 10, completionTokens: 5 });
  const d = await routeTurn({ setup: SETUP, history: [{ role: 'lead', text: 'quanto custa?' }], crm: createCrmState(), chat });
  assert.equal(d.roleId, 'closer');
  assert.equal(d.fallback, false);
  assert.equal(d.cost, 0.0001);
  ok('routeTurn: JSON valido escolhe o papel');
}
{
  const chat = async () => ({ message: { content: '```json\n{"role":"vendedor","reason":"abertura"}\n```' } });
  const d = await routeTurn({ setup: SETUP, history: [], crm: createCrmState(), isOpening: true, chat });
  assert.equal(d.roleId, 'vendedor');
  ok('routeTurn: JSON em code fence e parseado');
}
{
  const chat = async () => ({ message: { content: 'sei la, talvez o vendedor responda' } });
  const d = await routeTurn({ setup: SETUP, history: [], crm: createCrmState(), chat });
  assert.equal(d.roleId, 'vendedor'); // achou 'vendedor' no texto
  assert.equal(d.fallback, true);
  ok('routeTurn: texto sem JSON cai no fallback');
}
{
  const chat = async () => ({ message: { content: '{"role":"inexistente"}' } });
  const d = await routeTurn({ setup: SETUP, history: [], crm: createCrmState(), chat });
  assert.equal(d.roleId, 'vendedor'); // default
  assert.equal(d.fallback, true);
  ok('routeTurn: papel invalido cai no defaultRole');
}

// ---------- runConversation: roteamento + custo ----------
// Fake LLM que distingue router / agente / icp pelos parametros da chamada.
function makeFakeChat({ agentCost = 0.02, icpCost = 0.001, routerCost = 0.0002, closeAtTurn = 99 } = {}) {
  let agentTurns = 0;
  return async ({ tools, messages }) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    if (sys.startsWith('Voce e o ROTEADOR')) {
      // alterna: turno 1 vendedor, depois closer (simula escalada)
      const role = agentTurns === 0 ? 'vendedor' : 'closer';
      return { message: { content: `{"role":"${role}","reason":"teste"}` }, cost: routerCost, promptTokens: 5, completionTokens: 3 };
    }
    if (sys.startsWith('Voce esta interpretando um CLIENTE')) {
      // ICP: fecha no turno configurado
      const txt = agentTurns >= closeAtTurn ? 'fechado!\n[FECHOU]' : 'beleza, e o preco?';
      return { message: { content: txt }, cost: icpCost, promptTokens: 8, completionTokens: 4 };
    }
    // agente (tem tools): responde texto simples, sem tool calls
    agentTurns++;
    return { message: { content: 'oi, mensagem do agente', tool_calls: [] }, cost: agentCost, promptTokens: 20, completionTokens: 10 };
  };
}

const icp = { id: 'teste', name: 'Teste', persona: 'cliente', ficha: { nome: 'X' }, startStageId: 6 };

{
  const t = await runConversation({
    systemPrompt: 'PLAYBOOK',
    icp,
    agentSetup: SETUP,
    icpModel: 'icp-model',
    maxTurns: 4,
    maxCost: 0, // sem teto
    chatOverride: makeFakeChat({ closeAtTurn: 2 }),
  });
  // 1o turno -> vendedor, 2o -> closer (depois o ICP fecha)
  assert.equal(t.routing[0].roleId, 'vendedor');
  assert.equal(t.routing[1].roleId, 'closer');
  assert.equal(t.outcome.decision, 'closed');
  // custo: router + vendedor + closer + icp todos contabilizados
  assert.ok(t.cost.total > 0, 'custo total > 0');
  assert.ok(t.cost.byComponent.router > 0, 'router tem custo');
  assert.ok(t.cost.byComponent.vendedor > 0, 'vendedor tem custo');
  assert.ok(t.cost.byComponent.closer > 0, 'closer tem custo');
  assert.ok(t.cost.byComponent.icp > 0, 'icp tem custo');
  assert.ok(t.cost.byModel['seller-model'] > 0 && t.cost.byModel['closer-model'] > 0, 'custo por modelo');
  ok('runConversation: roteia por turno e contabiliza custo por componente/modelo');
}

{
  // Teto baixo: deve encerrar com budget_exceeded antes de fechar.
  const t = await runConversation({
    systemPrompt: 'PLAYBOOK',
    icp,
    agentSetup: SETUP,
    icpModel: 'icp-model',
    maxTurns: 10,
    maxCost: 0.03, // ~1 turno de agente (0.02) + router ja passa
    chatOverride: makeFakeChat({ closeAtTurn: 99 }),
  });
  assert.equal(t.outcome.endReason, 'budget_exceeded');
  assert.equal(t.outcome.budgetExceeded, true);
  assert.ok(t.cost.total >= 0.03, 'custo atingiu o teto');
  ok('runConversation: teto de orcamento encerra a conversa');
}

{
  // Guarda anti-arrasto: agente so narra ("*(...)*") -> encerra com 'stalled', nao arrasta.
  const chat = async ({ messages }) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    if (sys.startsWith('Voce e o ROTEADOR')) return { message: { content: '{"role":"vendedor","reason":"x"}' }, cost: 0 };
    if (sys.startsWith('Voce esta interpretando um CLIENTE')) return { message: { content: '👍' }, cost: 0 };
    return { message: { content: '*(sem resposta - conversa encerrada)*', tool_calls: [] }, cost: 0 };
  };
  const t = await runConversation({ systemPrompt: 'P', icp, agentSetup: SETUP, icpModel: 'm', maxTurns: 12, maxCost: 0, chatOverride: chat });
  assert.equal(t.outcome.endReason, 'stalled');
  assert.ok(t.outcome.turns <= 3, 'encerrou cedo, nao arrastou ate max_turns');
  ok('runConversation: guarda anti-arrasto encerra com stalled');
}

console.log(`\n${passed} casos passaram.`);
