#!/usr/bin/env node
// Stress probes: roda UM turno do agente num momento critico congelado e aplica
// checks deterministicos. Muito mais barato que uma simulacao inteira — e o
// cenario vem de conversa real, nao de um ICP atuando.
//
// Cenarios em config/scenarios/*.json:
//   {
//     "id": "depende-da-proposta",
//     "name": "...", "grupo": "A-escuta",
//     "ficha": { ... },                     // o que o agente sabe do lead
//     "crm": { "stageId": 9, "notes": ["..."], "activities": [{...}] },
//     "historico": [ {"role": "template"|"agente"|"lead", "text": "..."} ],
//     "tick": null | "20 minutos" | "2 horas" | "12 horas",
//     "checks": {
//       "expectSilent": false,             // turno deve terminar em stay_silent, sem mensagem
//       "mustCallTools": ["context_human"],
//       "mustNotCallTools": [],
//       "mustContainAny": ["dominio"],     // na mensagem (sem acento/caixa)
//       "mustNotContain": ["na reuniao"],
//       "mustEndWithQuestion": true,
//       "maxQuestions": 1,
//       "maxChars": 500,
//       "stageMustBe": 20,
//       "stageMustNotChange": true
//     },
//     "criterios": "o que um lance BOM faz aqui (avaliacao humana, alem dos checks)"
//   }
//
// Sem tick, o historico PRECISA terminar com mensagem do lead (o gatilho).
// Com tick, injeta-se: "[SISTEMA] Gatilho de follow-up: passaram-se X ..." —
// mesma convencao que o fluxo de producao (n8n) vai usar.
//
// Uso:
//   node cli/probe.js list
//   node cli/probe.js --scenario all --prompt v10            # sweep completo
//   node cli/probe.js --scenario a,b,c --prompt v11 --json
//   Flags: --agent <setup> (default single-gpt54) --repeat N --cap X --json --quiet
//
// Orcamento: output/probes/ledger.json acumula TODO gasto de probes. Teto (cap)
// default US$ 2,00 — atingiu, nao roda mais nada (ajuste consciente via --cap).
import fs from 'node:fs';
import path from 'node:path';
import { config, paths, assertApiKey } from '../src/config.js';
import { runAgentTurn } from '../src/agent/salesAgent.js';
import { createCrmState, stageName } from '../src/tools/tools.js';
import { readAgentPrompt, readAgentSetup } from '../src/store/store.js';

const SCENARIOS_DIR = path.join(paths.root, 'config', 'scenarios');
const PROBES_DIR = path.join(paths.root, 'output', 'probes');
const LEDGER_FILE = path.join(PROBES_DIR, 'ledger.json');
const DEFAULT_CAP = 2.0;

const usd = (n) => '$' + (Number(n) || 0).toFixed(4);
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

// ---------- cenarios ----------
function listScenarios() {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  return fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf8'));
        if (!obj.id) obj.id = f.replace(/\.json$/, '');
        return obj;
      } catch (e) {
        return { id: f, _invalid: String(e.message || e) };
      }
    });
}

function validateScenario(sc) {
  const errs = [];
  if (!Array.isArray(sc.historico) || !sc.historico.length) errs.push('historico vazio');
  const roles = new Set(['template', 'agente', 'lead']);
  for (const m of sc.historico || []) {
    if (!roles.has(m.role)) errs.push(`role invalido no historico: ${m.role}`);
    if (!m.text || !String(m.text).trim()) errs.push('mensagem vazia no historico');
  }
  const last = (sc.historico || [])[sc.historico.length - 1];
  if (!sc.tick && last && last.role !== 'lead') {
    errs.push('sem tick, o historico precisa terminar com mensagem do lead (o gatilho)');
  }
  return errs;
}

// ---------- ledger ----------
function loadLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return { capUSD: DEFAULT_CAP, totalSpent: 0, entries: [] };
  try {
    const l = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
    return { capUSD: l.capUSD ?? DEFAULT_CAP, totalSpent: l.totalSpent || 0, entries: l.entries || [] };
  } catch {
    return { capUSD: DEFAULT_CAP, totalSpent: 0, entries: [] };
  }
}

function saveLedger(ledger) {
  fs.mkdirSync(PROBES_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2), 'utf8');
}

// ---------- checks ----------
function evalChecks(sc, result, crmBefore, crmAfter) {
  const c = sc.checks || {};
  const out = [];
  const msg = result.message || '';
  const nmsg = norm(msg);
  const toolNames = (result.toolCalls || []).map((t) => t.name);
  const add = (name, pass, detail) => out.push({ check: name, pass: !!pass, detail });

  if ('expectSilent' in c) {
    const silent = !!result.silent && !msg;
    add(
      `expectSilent=${c.expectSilent}`,
      c.expectSilent ? silent : !result.silent && !!msg,
      silent ? 'turno em silencio' : `mensagem enviada (${msg.length} chars)`
    );
  }
  for (const t of c.mustCallTools || []) {
    add(`mustCall:${t}`, toolNames.includes(t), `tools: ${toolNames.join(', ') || '(nenhuma)'}`);
  }
  for (const t of c.mustNotCallTools || []) {
    add(`mustNotCall:${t}`, !toolNames.includes(t), `tools: ${toolNames.join(', ') || '(nenhuma)'}`);
  }
  if (Array.isArray(c.mustContainAny) && c.mustContainAny.length) {
    const hit = c.mustContainAny.find((s) => nmsg.includes(norm(s)));
    add(`mustContainAny[${c.mustContainAny.join('|')}]`, !!hit, hit ? `achou "${hit}"` : 'nenhum termo presente');
  }
  for (const s of c.mustNotContain || []) {
    add(`mustNotContain:"${s}"`, !nmsg.includes(norm(s)), nmsg.includes(norm(s)) ? 'termo presente na mensagem' : 'ok');
  }
  if (c.mustEndWithQuestion) {
    add('mustEndWithQuestion', /\?\s*$/.test(msg.trim()), `fim: "...${msg.trim().slice(-30)}"`);
  }
  if (typeof c.maxQuestions === 'number') {
    const q = (msg.match(/\?/g) || []).length;
    add(`maxQuestions<=${c.maxQuestions}`, q <= c.maxQuestions, `${q} interrogacoes`);
  }
  if (typeof c.minQuestions === 'number') {
    const q = (msg.match(/\?/g) || []).length;
    add(`minQuestions>=${c.minQuestions}`, q >= c.minQuestions, `${q} interrogacoes`);
  }
  if (typeof c.maxChars === 'number') {
    add(`maxChars<=${c.maxChars}`, msg.length <= c.maxChars, `${msg.length} chars`);
  }
  if (typeof c.stageMustBe === 'number') {
    add(`stageMustBe=${c.stageMustBe}`, crmAfter.stageId === c.stageMustBe, `estagio final: ${crmAfter.stageId} ${stageName(crmAfter.stageId)}`);
  }
  if (c.stageMustNotChange) {
    add('stageMustNotChange', crmAfter.stageId === crmBefore.stageId, `de ${crmBefore.stageId} para ${crmAfter.stageId}`);
  }
  return out;
}

// ---------- montagem do contexto ----------
function buildCrm(sc) {
  const seed = sc.crm || {};
  const crm = createCrmState({ stageId: seed.stageId ?? null });
  for (const n of seed.notes || []) crm.notes.push({ content: String(n), at: '(antes deste turno)' });
  for (const a of seed.activities || []) {
    crm.activities.push({ subject: a.subject || 'Atividade', type: a.type || 'WhatsApp', note: a.note || '', at: '(antes deste turno)' });
  }
  if (seed.person) crm.person = { id: seed.person.id || 1001, name: seed.person.name || '', phone: seed.person.phone || '' };
  if (seed.escalated) crm.escalated = true;
  return crm;
}

function buildHistory(sc) {
  const history = sc.historico.map((m) => ({
    role: m.role === 'lead' ? 'lead' : 'agent', // template conta como agente
    text: m.text,
  }));
  if (sc.tick) {
    history.push({
      role: 'lead',
      text: `[SISTEMA] Gatilho de follow-up: passaram-se ${sc.tick} desde a ultima mensagem da conversa e o lead nao respondeu. Nao ha mensagem nova do lead. Aja conforme seu julgamento.`,
    });
  }
  return history;
}

function tsForFile(iso) {
  return iso.replace(/[-:T]/g, '').replace(/\..*/, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1-$2');
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'list') {
    const all = listScenarios();
    console.log('\nCENARIOS (config/scenarios/*.json):');
    if (!all.length) console.log('  (nenhum)');
    for (const sc of all) {
      if (sc._invalid) {
        console.log(`  - ${pad(sc.id, 32)} [JSON INVALIDO: ${sc._invalid}]`);
        continue;
      }
      const errs = validateScenario(sc);
      console.log(
        `  - ${pad(sc.id, 32)} ${pad(sc.grupo || '', 12)} ${sc.tick ? `tick:${sc.tick}` : '        '}${errs.length ? '  !! ' + errs.join('; ') : ''}`
      );
    }
    const ledger = loadLedger();
    console.log(`\nLedger: gasto ${usd(ledger.totalSpent)} de ${usd(ledger.capUSD)} (${ledger.entries.length} execucoes)\n`);
    return;
  }

  try {
    assertApiKey();
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exit(1);
  }

  const promptId = args.prompt;
  if (!promptId || promptId === true) {
    console.error('ERRO: informe --prompt <id> explicitamente (probes nao adivinham prompt).');
    process.exit(1);
  }
  const systemPrompt = readAgentPrompt(promptId);
  if (!systemPrompt) {
    console.error(`ERRO: prompt "${promptId}" nao encontrado em config/agent/.`);
    process.exit(1);
  }

  // Setup do agente: fidelidade ao de producao por default.
  const setupId = typeof args.agent === 'string' ? args.agent : 'single-gpt54';
  const setup = readAgentSetup(setupId);
  if (!setup) {
    console.error(`ERRO: setup de agente "${setupId}" nao encontrado em config/agents/.`);
    process.exit(1);
  }
  if (setup.mode !== 'single') {
    console.error('ERRO: probes suportam apenas setup "single" (um turno, um modelo).');
    process.exit(1);
  }

  // Cenarios.
  const all = listScenarios().filter((s) => !s._invalid);
  const wanted = !args.scenario || args.scenario === 'all' || args.scenario === true
    ? all
    : String(args.scenario)
        .split(',')
        .map((id) => {
          const sc = all.find((s) => s.id === id.trim());
          if (!sc) {
            console.error(`ERRO: cenario "${id.trim()}" nao encontrado. Veja "node cli/probe.js list".`);
            process.exit(1);
          }
          return sc;
        });
  if (!wanted.length) {
    console.error('ERRO: nenhum cenario. Crie config/scenarios/*.json.');
    process.exit(1);
  }
  for (const sc of wanted) {
    const errs = validateScenario(sc);
    if (errs.length) {
      console.error(`ERRO no cenario "${sc.id}": ${errs.join('; ')}`);
      process.exit(1);
    }
  }

  const repeat = Math.max(1, Number(args.repeat) || 1);
  const quiet = Boolean(args.quiet);
  const asJson = Boolean(args.json);
  const maxCostPerProbe = Number(process.env.MAX_COST_PER_PROBE || 0.1);

  // Orcamento.
  const ledger = loadLedger();
  if (args.cap != null) ledger.capUSD = Number(args.cap);
  const remaining = ledger.capUSD - ledger.totalSpent;
  if (remaining <= 0) {
    console.error(
      `TETO ATINGIDO: gasto acumulado ${usd(ledger.totalSpent)} >= cap ${usd(ledger.capUSD)}. Nada foi executado. (--cap para ajustar conscientemente)`
    );
    process.exit(2);
  }

  if (!quiet && !asJson) {
    console.log(`\nPrompt: ${promptId}  |  Setup: ${setup.id} (${setup.model}${setup.reasoningEffort ? ', reasoning ' + setup.reasoningEffort : ''})`);
    console.log(`Cenarios: ${wanted.length} x ${repeat}  |  Ledger: ${usd(ledger.totalSpent)} gasto, ${usd(remaining)} disponivel (cap ${usd(ledger.capUSD)})\n`);
  }

  fs.mkdirSync(PROBES_DIR, { recursive: true });
  const sweepCreatedAt = new Date().toISOString();
  const results = [];
  let aborted = false;

  outer: for (const sc of wanted) {
    for (let r = 0; r < repeat; r++) {
      if (ledger.totalSpent >= ledger.capUSD) {
        aborted = true;
        if (!quiet) console.log(`\n[TETO DO LEDGER atingido (${usd(ledger.totalSpent)}); probes restantes cancelados]`);
        break outer;
      }
      const crm = buildCrm(sc);
      const crmBefore = { stageId: crm.stageId };
      const history = buildHistory(sc);
      const startedAt = new Date().toISOString();

      let result = null;
      let error = null;
      try {
        result = await runAgentTurn({
          systemPrompt,
          ficha: sc.ficha,
          crm,
          history,
          model: setup.model,
          temperature: setup.temperature,
          reasoningEffort: setup.reasoningEffort || null,
          nowIso: startedAt,
          isOpening: false,
          maxTokens: config.agentMaxTokens,
        });
      } catch (err) {
        error = String(err.message || err);
      }

      const cost = result ? result.cost || 0 : 0;
      ledger.totalSpent = Math.round((ledger.totalSpent + cost) * 1e6) / 1e6;
      ledger.entries.push({ at: startedAt, scenario: sc.id, promptId, setupId: setup.id, cost: Math.round(cost * 1e6) / 1e6 });
      saveLedger(ledger);

      const checks = result ? evalChecks(sc, result, crmBefore, crm) : [];
      const pass = !error && checks.every((c) => c.pass);
      const probe = {
        scenario: { id: sc.id, name: sc.name || sc.id, grupo: sc.grupo || null, tick: sc.tick || null },
        promptId,
        setup: { id: setup.id, model: setup.model, reasoningEffort: setup.reasoningEffort || null, temperature: setup.temperature },
        createdAt: startedAt,
        rep: r + 1,
        error,
        result: result
          ? {
              message: result.message,
              silent: !!result.silent,
              toolCalls: result.toolCalls,
              thinking: result.thinking,
            }
          : null,
        crmFinal: {
          stageId: crm.stageId,
          stageName: stageName(crm.stageId),
          notes: crm.notes,
          activities: crm.activities,
          contactHumanMessages: crm.contactHumanMessages,
          escalated: crm.escalated,
        },
        checks,
        pass,
        criterios: sc.criterios || null,
        cost: Math.round(cost * 1e6) / 1e6,
      };
      if (cost > maxCostPerProbe) {
        probe.warning = `custo do probe (${usd(cost)}) acima de MAX_COST_PER_PROBE (${usd(maxCostPerProbe)})`;
      }

      const fname = `${tsForFile(startedAt)}_${sc.id}_${promptId}${repeat > 1 ? `_r${r + 1}` : ''}.json`;
      fs.writeFileSync(path.join(PROBES_DIR, fname), JSON.stringify(probe, null, 2), 'utf8');
      results.push({ scenario: sc.id, grupo: sc.grupo || '', rep: r + 1, pass, error, failed: checks.filter((c) => !c.pass).map((c) => c.check), silent: result ? !!result.silent : null, tools: result ? result.toolCalls.map((t) => t.name) : [], cost, file: fname });

      if (!quiet && !asJson) {
        const status = error ? 'ERRO ' : pass ? 'PASS ' : 'FAIL ';
        const det = error || (pass ? '' : results[results.length - 1].failed.join(' | '));
        console.log(`${status} ${pad(sc.id, 32)} ${usd(cost)}  ${det}`);
        if (result && result.message && !quiet) console.log(`      msg> ${result.message.replace(/\n/g, ' / ').slice(0, 160)}`);
        if (result && result.silent) console.log(`      msg> (silencio deliberado)`);
      }
    }
  }

  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  const passed = results.filter((r) => r.pass).length;
  const sweep = {
    createdAt: sweepCreatedAt,
    promptId,
    setupId: setup.id,
    scenarios: results.length,
    passed,
    failed: results.length - passed,
    aborted,
    totalCost: Math.round(totalCost * 1e6) / 1e6,
    ledgerTotal: ledger.totalSpent,
    results,
  };
  const sweepFile = `sweep_${tsForFile(sweepCreatedAt)}_${promptId}.json`;
  fs.writeFileSync(path.join(PROBES_DIR, sweepFile), JSON.stringify(sweep, null, 2), 'utf8');

  if (asJson) {
    console.log(JSON.stringify(sweep, null, 2));
  } else {
    console.log('\n================ SWEEP ================');
    console.log(`${passed}/${results.length} PASS  |  custo ${usd(totalCost)}  |  ledger ${usd(ledger.totalSpent)} de ${usd(ledger.capUSD)}${aborted ? '  |  ABORTADO no teto' : ''}`);
    console.log(`Salvo: output/probes/${sweepFile}\n`);
  }
}

main().catch((err) => {
  console.error('FALHA:', err.stack || err.message || err);
  process.exit(1);
});
