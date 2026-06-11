// Teste deterministico do bug "agente manda ferramenta/nota e nao gera mensagem".
// Usa um chat() falso (injecao de dependencia) pra simular respostas vazias do modelo.
// Rode: node test/empty-recovery.test.mjs
import assert from 'node:assert';
import { runAgentTurn } from '../src/agent/salesAgent.js';
import { createCrmState } from '../src/tools/tools.js';

let passed = 0;
function ok(name) { console.log('  ok -', name); passed++; }

// Helper: cria um chat() que devolve respostas pre-programadas, uma por chamada.
function fakeChat(responses) {
  let i = 0;
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { message: r, usage: null, model: 'fake', raw: {} };
  };
  fn.calls = calls;
  return fn;
}

const base = () => ({
  systemPrompt: 'sys',
  ficha: { nome: 'Teste' },
  crm: createCrmState({ stageId: 6 }),
  history: [{ role: 'lead', text: 'oi' }],
  model: 'fake',
  temperature: 0.5,
  nowIso: '2026-06-02T00:00:00.000Z',
});

// --- Caso 1: turno totalmente vazio (sem texto, sem tool) -> recupera via 2a chamada ---
{
  const chat = fakeChat([
    { role: 'assistant', content: '', tool_calls: [] }, // vazio
    { role: 'assistant', content: 'mensagem recuperada', tool_calls: [] }, // forcado
  ]);
  const res = await runAgentTurn({ ...base(), chat });
  assert.equal(res.message, 'mensagem recuperada', 'deveria recuperar a mensagem');
  assert.ok(!res.error, 'nao deveria ter erro');
  assert.equal(chat.calls.length, 2, 'deveria ter feito 2 chamadas (vazia + forcada)');
  // a 2a chamada NAO deve mandar tools (forca texto puro)
  assert.ok(!chat.calls[1].tools, 'a chamada de recuperacao nao deve enviar tools');
  ok('caso 1: turno vazio recupera a mensagem');
}

// --- Caso 2: modelo manda texto JUNTO com a tool (nota) e depois volta vazio ---
//     -> usa o texto que veio junto da ferramenta (lastContent), sem perder a mensagem ---
{
  const chat = fakeChat([
    {
      role: 'assistant',
      content: 'boa, ja registrei aqui',
      tool_calls: [
        { id: 't1', function: { name: 'create_note', arguments: JSON.stringify({ content: 'lead interessado' }) } },
      ],
    },
    { role: 'assistant', content: '', tool_calls: [] }, // follow-up vazio
    { role: 'assistant', content: '', tool_calls: [] }, // recuperacao tambem vazia
  ]);
  const res = await runAgentTurn({ ...base(), chat });
  assert.equal(res.message, 'boa, ja registrei aqui', 'deveria cair no texto que veio junto da tool');
  assert.ok(!res.error, 'nao deveria ter erro (tem fallback)');
  assert.equal(res.toolCalls.length, 1, 'a nota deveria ter sido registrada');
  assert.equal(res.toolCalls[0].displayName, 'Create a note');
  ok('caso 2: texto junto da ferramenta nao se perde');
}

// --- Caso 3: nunca gera texto algum -> retorna vazio MAS com error (nao e silencioso) ---
{
  const chat = fakeChat([{ role: 'assistant', content: '', tool_calls: [] }]); // sempre vazio
  const res = await runAgentTurn({ ...base(), chat });
  assert.equal(res.message, '', 'sem texto em lugar nenhum');
  assert.ok(res.error && res.error.includes('vazia'), 'deveria sinalizar erro de resposta vazia');
  ok('caso 3: vazio total sinaliza erro (nao falha em silencio)');
}

// --- Caso 4: fluxo normal (tool + texto na resposta final) continua funcionando ---
{
  const chat = fakeChat([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 't1', function: { name: 'update_deal_stage', arguments: JSON.stringify({ stage_id: 8 }) } },
      ],
    },
    { role: 'assistant', content: 'show, vamos seguir entao', tool_calls: [] },
  ]);
  const res = await runAgentTurn({ ...base(), chat });
  assert.equal(res.message, 'show, vamos seguir entao');
  assert.equal(res.toolCalls.length, 1);
  assert.ok(!res.error);
  ok('caso 4: fluxo normal (tool depois texto) intacto');
}

console.log(`\n${passed} casos passaram.`);
