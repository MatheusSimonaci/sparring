#!/usr/bin/env node
// CLI headless: roda simulacoes agente x ICP e salva transcricoes JSON.
// Feito pra ser chamado por uma pessoa OU por um agente de IA que itera o prompt.
//
// Exemplos:
//   node cli/run.js list
//   node cli/run.js --icp all --prompt v1
//   node cli/run.js --icp arquiteto-cetico --prompt v1 --repeat 2
//   node cli/run.js --icp all --prompt v2 --json
import { config, assertApiKey } from '../src/config.js';
import { runConversation } from '../src/sim/conversation.js';
import {
  listIcps,
  readIcp,
  listAgentPrompts,
  readAgentPrompt,
  listAgentSetups,
  readAgentSetup,
  readTemplatesConfig,
  getOpeningTemplate,
  saveRun,
  saveBatch,
} from '../src/store/store.js';

const usd = (n) => '$' + (Number(n) || 0).toFixed(4);

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'list' || args['list-icps'] || args['list-prompts']) {
    const prompts = listAgentPrompts();
    const icps = listIcps();
    const setups = listAgentSetups();
    console.log('\nPROMPTS (config/agent/*.md):');
    if (!prompts.length) console.log('  (nenhum)');
    for (const p of prompts) console.log(`  - ${p.id}`);
    console.log('\nSETUPS DE AGENTE (config/agents/*.json) - use com --agent <id>:');
    if (!setups.length) console.log('  (nenhum)');
    for (const s of setups) console.log(`  - ${pad(s.id, 16)} [${s.mode}] ${s.name || ''}`);
    console.log('\nICPs (config/icps/*.json):');
    if (!icps.length) console.log('  (nenhum)');
    for (const c of icps) console.log(`  - ${pad(c.id, 24)} ${c.name || ''}`);
    const tcfg = readTemplatesConfig();
    console.log('\nTEMPLATES DE ABERTURA (config/templates.json) - use com --template <id|none>:');
    if (!tcfg.templates.length) console.log('  (nenhum)');
    for (const t of tcfg.templates) console.log(`  - ${pad(t.id, 24)} ${t.name || ''}${tcfg.default === t.id ? '  [default]' : ''}`);
    console.log('');
    return;
  }

  try {
    assertApiKey();
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exit(1);
  }

  // Resolve setup de agente (roteamento multi-modelo), se houver.
  let setup = null;
  if (args.agent) {
    setup = readAgentSetup(args.agent);
    if (!setup) {
      console.error(`ERRO: setup de agente "${args.agent}" nao encontrado. Veja "node cli/run.js list".`);
      process.exit(1);
    }
  }

  // Resolve prompt (playbook). Precedencia: --prompt > setup.promptId > primeiro disponivel.
  const promptId = args.prompt || (setup && setup.promptId) || (listAgentPrompts()[0] && listAgentPrompts()[0].id);
  if (!promptId) {
    console.error('ERRO: nenhum prompt encontrado em config/agent/. Use --prompt <id>.');
    process.exit(1);
  }
  const systemPrompt = readAgentPrompt(promptId);
  if (!systemPrompt) {
    console.error(`ERRO: prompt "${promptId}" nao encontrado.`);
    process.exit(1);
  }

  // Resolve ICPs.
  const icpArg = args.icp || 'all';
  let icps;
  if (icpArg === 'all') {
    icps = listIcps();
  } else {
    icps = String(icpArg)
      .split(',')
      .map((id) => {
        const icp = readIcp(id.trim());
        if (!icp) {
          console.error(`ERRO: ICP "${id}" nao encontrado.`);
          process.exit(1);
        }
        return icp;
      });
  }
  if (!icps.length) {
    console.error('ERRO: nenhum ICP pra rodar. Crie ICPs em config/icps/ ou use --icp <id>.');
    process.exit(1);
  }

  // Template de abertura: --template <id> forca um, --template none desliga,
  // sem flag usa o default de config/templates.json (se houver).
  let openingTemplate = null;
  try {
    openingTemplate = getOpeningTemplate(typeof args.template === 'string' ? args.template : undefined);
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exit(1);
  }

  const agentModel = args['agent-model'] || config.agentModel;
  const icpModel = args['icp-model'] || config.icpModel;
  const maxTurns = Number(args['max-turns']) || config.maxTurns;
  const maxCost = args.budget != null ? Number(args.budget) : config.maxCostPerConversation;
  const repeat = Math.max(1, Number(args.repeat) || 1);
  const quiet = Boolean(args.quiet);
  const asJson = Boolean(args.json);
  const agentLabel = setup ? `setup "${setup.id}" [${setup.mode}]` : agentModel;

  if (!quiet) {
    console.log(`\nPrompt: ${promptId}  |  Agente: ${agentLabel}  |  ICP: ${icpModel}`);
    console.log(`Abertura: ${openingTemplate ? `template "${openingTemplate.id}"` : 'gerada pelo agente'}`);
    console.log(`ICPs: ${icps.map((i) => i.id).join(', ')}  |  max-turns: ${maxTurns}  |  repeat: ${repeat}  |  teto: ${maxCost > 0 ? usd(maxCost) : 'sem teto'}\n`);
  }

  const saved = [];
  const batchCreatedAt = new Date().toISOString();

  for (const icp of icps) {
    for (let r = 0; r < repeat; r++) {
      if (!quiet) console.log(`\n===== ${icp.name || icp.id}${repeat > 1 ? ` (rep ${r + 1}/${repeat})` : ''} =====`);
      const transcript = await runConversation({
        systemPrompt,
        icp,
        agentSetup: setup,
        agentModel,
        icpModel,
        maxTurns,
        maxCost,
        agentTemperature: config.agentTemperature,
        icpTemperature: config.icpTemperature,
        promptId,
        openingTemplate,
        onEvent: (evt) => {
          if (quiet || asJson) return;
          if (evt.type === 'agent') {
            const who = evt.route && evt.route.roleId !== 'single'
              ? `AGENTE[${evt.route.roleId} · ${evt.route.model}]`
              : 'AGENTE';
            const tools = (evt.message.toolCalls || []).map((t) => t.displayName).join(', ');
            if (evt.route && evt.route.reason) console.log(`  [router -> ${evt.route.roleId}] ${evt.route.reason}`);
            if (tools) console.log(`  [tools] ${tools}`);
            console.log(`  ${who}> ${evt.message.text || '(sem texto)'}`);
          } else if (evt.type === 'lead') {
            console.log(`  LEAD>   ${evt.message.text || '(sem texto)'}`);
          } else if (evt.type === 'budget') {
            console.log(`  [TETO DE CUSTO atingido: ${usd(evt.total)} >= ${usd(evt.maxCost)} -> encerrando]`);
          } else if (evt.type === 'error') {
            console.log(`  [erro ${evt.side}] ${evt.error}`);
          }
        },
      });
      const out = saveRun(transcript);
      saved.push({
        file: out.file,
        icp: icp.id,
        endReason: transcript.outcome.endReason,
        reachedStage: `${transcript.outcome.reachedStageId} ${transcript.outcome.reachedStageName}`,
        turns: transcript.outcome.turns,
        escalated: transcript.outcome.escalated,
        cost: transcript.cost.total,
        costByModel: transcript.cost.byModel,
        turnsByRole: transcript.metrics.turnsByRole,
        tools: transcript.metrics.toolCounts,
      });
      if (!quiet && !asJson) {
        console.log(
          `  --> fim: ${transcript.outcome.endReason} | estagio ${transcript.outcome.reachedStageId} ${transcript.outcome.reachedStageName} | turnos ${transcript.outcome.turns} | custo ${usd(transcript.cost.total)}`
        );
        if (setup && setup.mode === 'router') {
          console.log(`  --> turnos por papel: ${JSON.stringify(transcript.metrics.turnsByRole)} | custo por modelo: ${Object.entries(transcript.cost.byModel).map(([m, c]) => `${m}=${usd(c)}`).join(', ')}`);
        }
        console.log(`  --> salvo: output/runs/${out.file}`);
      }
    }
  }

  const totalCost = saved.reduce((s, r) => s + (r.cost || 0), 0);

  let batchFile = null;
  if (saved.length > 1) {
    batchFile = saveBatch({
      createdAt: batchCreatedAt,
      promptId,
      openingTemplateId: openingTemplate ? openingTemplate.id : null,
      agentSetupId: setup ? setup.id : null,
      agentModel: setup ? undefined : agentModel,
      icpModel,
      totalCost,
      runs: saved,
    }).file;
  }

  if (asJson) {
    console.log(JSON.stringify({ promptId, agentSetupId: setup ? setup.id : null, agentModel, icpModel, batchFile, totalCost, runs: saved }, null, 2));
  } else {
    console.log('\n================ RESUMO ================');
    console.log(pad('ICP', 22), pad('fim', 16), pad('estagio', 22), pad('turnos', 7), 'custo');
    for (const s of saved) {
      console.log(pad(s.icp, 22), pad(s.endReason, 16), pad(s.reachedStage, 22), pad(s.turns, 7), usd(s.cost));
    }
    console.log(`\nCusto total da bateria: ${usd(totalCost)}  (${saved.length} conversas, media ${usd(totalCost / Math.max(1, saved.length))}/conversa)`);
    if (batchFile) console.log(`Resumo do lote: output/runs/${batchFile}`);
    console.log(`\nTranscricoes salvas em output/runs/. Total: ${saved.length}\n`);
  }
}

main().catch((err) => {
  console.error('FALHA:', err.stack || err.message || err);
  process.exit(1);
});
