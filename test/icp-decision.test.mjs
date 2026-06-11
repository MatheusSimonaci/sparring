// Teste das marcas de desfecho do ICP ([FECHOU]/[RECUSOU]/[ENCERRAR]).
// Rode: node test/icp-decision.test.mjs
import assert from 'node:assert';
import { runIcpTurn } from '../src/icp/icpClient.js';

let passed = 0;
function ok(name) { console.log('  ok -', name); passed++; }

function fakeChat(content) {
  return async () => ({ message: { content }, usage: null, model: 'fake', raw: {} });
}

const icp = { id: 't', name: 'Teste', persona: 'cliente teste' };
const hist = [{ role: 'agent', text: 'quer fechar?' }];

// [FECHOU] -> closed
{
  const res = await runIcpTurn({ icp, history: hist, model: 'fake', chat: fakeChat('fechado, bora!\n[FECHOU]') });
  assert.equal(res.end, true);
  assert.equal(res.decision, 'closed');
  assert.equal(res.message, 'fechado, bora!');
  assert.ok(!res.message.includes('['), 'marca deve sair do texto');
  ok('[FECHOU] vira decision=closed e some do texto');
}

// [RECUSOU] -> declined
{
  const res = await runIcpTurn({ icp, history: hist, model: 'fake', chat: fakeChat('acho que nao, valeu\n[RECUSOU]') });
  assert.equal(res.end, true);
  assert.equal(res.decision, 'declined');
  ok('[RECUSOU] vira decision=declined');
}

// [ENCERRAR] -> ended
{
  const res = await runIcpTurn({ icp, history: hist, model: 'fake', chat: fakeChat('falo com a Ju\n[ENCERRAR]') });
  assert.equal(res.end, true);
  assert.equal(res.decision, 'ended');
  ok('[ENCERRAR] vira decision=ended');
}

// sem marca -> continua
{
  const res = await runIcpTurn({ icp, history: hist, model: 'fake', chat: fakeChat('me conta mais') });
  assert.equal(res.end, false);
  assert.equal(res.decision, null);
  ok('sem marca: conversa continua');
}

console.log(`\n${passed} casos passaram.`);
