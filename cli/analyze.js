#!/usr/bin/env node
// Analise leve (sem LLM) das transcricoes salvas. Util pra um overview rapido;
// a analise qualitativa profunda fica pro agente de IA (ver README).
//
// Exemplos:
//   node cli/analyze.js                  # agrega todas as runs
//   node cli/analyze.js --file <run.json># mostra uma transcricao legivel
//   node cli/analyze.js --json           # saida machine-readable
import { listRuns, readRun } from '../src/store/store.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
      else { args[a.slice(2)] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function renderTranscript(run) {
  const usd = (n) => '$' + (Number(n) || 0).toFixed(4);
  const agentDesc = run.agent?.mode === 'router'
    ? `router(${run.agent.routerModel}) -> ${(run.agent.roles || []).map((r) => `${r.id}:${r.model}`).join(', ')}`
    : run.agent?.model;
  console.log(`\n# Conversa ${run.id}`);
  console.log(`ICP: ${run.icp?.name} (${run.icp?.id})  |  prompt: ${run.agent?.promptId}  |  agente: ${agentDesc}`);
  console.log(`Fim: ${run.outcome?.endReason} | estagio final ${run.outcome?.reachedStageId} ${run.outcome?.reachedStageName} | turnos ${run.outcome?.turns} | custo ${usd(run.cost?.total)}\n`);
  for (const m of run.messages) {
    if (m.role === 'agent') {
      if (m.routerReason) console.log(`  [router -> ${m.roleId}] ${m.routerReason}`);
      if (m.thinking) console.log(`  (think) ${m.thinking.replace(/\n+/g, ' ').slice(0, 220)}`);
      for (const tc of m.toolCalls || []) {
        console.log(`  [tool] ${tc.displayName} ${JSON.stringify(tc.args)}`);
      }
      const tag = m.roleId && m.roleId !== 'single' ? `AGENTE[${m.roleId}·${m.model}]` : 'AGENTE';
      console.log(`${tag}> ${m.text || '(sem texto)'}\n`);
    } else {
      console.log(`LEAD>   ${m.text || '(sem texto)'}\n`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.file) {
    const run = readRun(args.file);
    if (!run) {
      console.error(`run "${args.file}" nao encontrado em output/runs/`);
      process.exit(1);
    }
    if (args.json) console.log(JSON.stringify(run, null, 2));
    else renderTranscript(run);
    return;
  }

  const runs = listRuns();
  if (!runs.length) {
    console.log('Nenhuma transcricao em output/runs/. Rode primeiro: node cli/run.js --icp all');
    return;
  }

  const agg = {
    total: runs.length,
    byEndReason: {},
    byDecision: {},
    byReachedStage: {},
    byIcp: {},
    byPrompt: {},
    toolTotals: {},
    avgTurns: 0,
    escalations: 0,
    closed: 0,
    declined: 0,
    budgetExceeded: 0,
    costTotal: 0,
    costByModel: {},
    turnsByRole: {},
  };
  let turnsSum = 0;
  for (const r of runs) {
    const o = r.outcome || {};
    const mx = r.metrics || {};
    agg.costTotal += mx.costTotal || o.totalCost || 0;
    if (o.budgetExceeded) agg.budgetExceeded++;
    for (const [m, c] of Object.entries(mx.costByModel || {})) agg.costByModel[m] = (agg.costByModel[m] || 0) + c;
    for (const [role, n] of Object.entries(mx.turnsByRole || {})) agg.turnsByRole[role] = (agg.turnsByRole[role] || 0) + n;
    agg.byEndReason[o.endReason] = (agg.byEndReason[o.endReason] || 0) + 1;
    const dec = o.decision || (o.endReason === 'handoff' ? 'handoff' : 'sem decisao');
    agg.byDecision[dec] = (agg.byDecision[dec] || 0) + 1;
    if (o.decision === 'closed') agg.closed++;
    if (o.decision === 'declined') agg.declined++;
    const stageKey = `${o.reachedStageId} ${o.reachedStageName}`;
    agg.byReachedStage[stageKey] = (agg.byReachedStage[stageKey] || 0) + 1;
    agg.byIcp[r.icp] = (agg.byIcp[r.icp] || 0) + 1;
    agg.byPrompt[r.promptId] = (agg.byPrompt[r.promptId] || 0) + 1;
    if (o.escalated) agg.escalations++;
    turnsSum += o.turns || 0;
    for (const [k, v] of Object.entries((r.metrics && r.metrics.toolCounts) || {})) {
      agg.toolTotals[k] = (agg.toolTotals[k] || 0) + v;
    }
  }
  agg.avgTurns = Math.round((turnsSum / runs.length) * 10) / 10;
  agg.closeRate = Math.round((agg.closed / runs.length) * 100);
  agg.avgCost = agg.costTotal / runs.length;
  agg.costPerClose = agg.closed ? agg.costTotal / agg.closed : null;

  if (args.json) {
    console.log(JSON.stringify(agg, null, 2));
    return;
  }

  const usd = (n) => '$' + (Number(n) || 0).toFixed(4);
  console.log(`\n=== Analise agregada (${agg.total} conversas) ===\n`);
  console.log(`Fechamentos: ${agg.closed}   |   Recusas: ${agg.declined}   |   Taxa de fechamento: ${agg.closeRate}%`);
  console.log(`Turnos medios: ${agg.avgTurns}   |   Escalacoes p/ humano: ${agg.escalations}   |   Estouros de orcamento: ${agg.budgetExceeded}`);
  console.log(`Custo total: ${usd(agg.costTotal)}   |   Media/conversa: ${usd(agg.avgCost)}   |   Custo por fechamento: ${agg.costPerClose != null ? usd(agg.costPerClose) : '-'}\n`);
  const table = (title, obj, fmt = (v) => v) => {
    console.log(title);
    for (const [k, v] of Object.entries(obj).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${pad(k, 34)} ${fmt(v)}`);
    }
    console.log('');
  };
  if (Object.keys(agg.costByModel).length) table('Custo por modelo:', agg.costByModel, usd);
  if (Object.keys(agg.turnsByRole).length) table('Turnos por papel (roteamento):', agg.turnsByRole);
  table('Desfecho (decisao do lead):', agg.byDecision);
  table('Motivo de encerramento:', agg.byEndReason);
  table('Estagio final alcancado:', agg.byReachedStage);
  table('Uso de ferramentas (total):', agg.toolTotals);
  table('Por ICP:', agg.byIcp);
  table('Por prompt:', agg.byPrompt);
  console.log('Dica: para analise qualitativa, peca pra um agente ler os JSON em output/runs/ (ver README).\n');
}

main();
