// Testes do silencio deliberado: agente age por ferramenta e nao responde no chat
// (rejeicao seca, caixa postal, encerramento). Rode: node test/silence.test.mjs
import assert from 'node:assert';
import { runConversation } from '../src/sim/conversation.js';

let passed = 0;
const ok = (n) => { console.log('  ok -', n); passed++; };

const icp = { id: 'teste', name: 'Teste', persona: 'cliente', ficha: { nome: 'X', marca: 'Loja Y' }, startStageId: 6 };
const TEMPLATE = { id: 't', text: 'Oi! Montei um site pra {empresa}. Topa olhar?' };

// Fake: lead responde com rejeicao seca; agente registra nota e chama stay_silent.
function makeChat() {
  return async ({ messages }) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    if (sys.startsWith('Voce esta interpretando um CLIENTE')) {
      return { message: { content: 'Não tenho interesse nenhum.' }, cost: 0.001, promptTokens: 5, completionTokens: 3 };
    }
    // turno do agente: nota + ferramenta de silencio, sem texto
    return {
      message: {
        content: '',
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'create_note', arguments: '{"content":"Rejeicao seca na abordagem. Sem abertura."}' } },
          { id: 'tc2', type: 'function', function: { name: 'stay_silent', arguments: '{"motivo":"rejeicao seca"}' } },
        ],
      },
      cost: 0.005, promptTokens: 10, completionTokens: 5,
    };
  };
}

{
  const t = await runConversation({
    systemPrompt: 'PLAYBOOK',
    icp,
    agentModel: 'agent-model',
    icpModel: 'icp-model',
    maxTurns: 6,
    maxCost: 0,
    openingTemplate: TEMPLATE,
    chatOverride: makeChat(),
  });
  assert.equal(t.outcome.endReason, 'agent_silent');
  assert.equal(t.outcome.turns, 1, 'um turno do agente, sem mensagem');
  const agentMsgs = t.messages.filter((m) => m.role === 'agent' && m.roleId !== 'template');
  assert.equal(agentMsgs.length, 1);
  assert.equal(agentMsgs[0].text, '', 'nenhum texto enviado ao lead');
  assert.ok(t.toolCalls.some((tc) => tc.name === 'create_note'), 'nota registrada no silencio');
  assert.ok(t.toolCalls.some((tc) => tc.name === 'stay_silent'), 'ferramenta de silencio chamada');
  ok('rejeicao seca: stay_silent encerra com agent_silent, sem mensagem ao lead e sem recovery');
}

{
  // Sem ferramenta nenhuma e sem texto: continua sendo o caminho de erro/noise, nao silencio.
  const chat = async ({ messages }) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    if (sys.startsWith('Voce esta interpretando um CLIENTE')) return { message: { content: 'oi' }, cost: 0 };
    return { message: { content: '', tool_calls: [] }, cost: 0 };
  };
  const t = await runConversation({
    systemPrompt: 'P', icp, agentModel: 'm', icpModel: 'm', maxTurns: 4, maxCost: 0,
    openingTemplate: TEMPLATE, chatOverride: chat,
  });
  assert.notEqual(t.outcome.endReason, 'agent_silent');
  ok('vazio sem ferramenta NAO conta como silencio deliberado (cai no caminho de erro)');
}

console.log(`\n${passed} casos passaram.`);
