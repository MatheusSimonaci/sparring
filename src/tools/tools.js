// Ferramentas do agente e mapa do funil — CONFIGURÁVEIS pelo usuário.
//
// A fonte da verdade é config/tools.json (editável na aba "Ferramentas" da
// interface, por um agente de IA, ou na mão). Se o arquivo não existir ou
// estiver inválido, os padrões abaixo (espelhados de um fluxo n8n real com
// Pipedrive/Telegram/Chatwoot) entram no lugar. Nenhuma ferramenta faz chamada
// externa: cada uma tem um EFEITO simulado num "CRM" em memória.
//
// Cada ferramenta declara um `effect` — é ele que define o que acontece no CRM
// simulado quando o agente chama a ferramenta:
//
//   think           registra raciocínio interno (aparece como "think" na UI)
//   create_person   cria um contato e devolve person_id
//   link_person     vincula o deal ao person_id informado
//   create_activity cria uma tarefa para um humano executar
//   create_note     registra uma nota no deal
//   update_stage    move o deal de estágio no funil (usa os estágios configurados)
//   notify_human    avisa a equipe humana (ex.: Telegram) e marca como escalado
//   handoff         transfere para humano e ENCERRA a conversa (desativa a IA)
//   log             efeito genérico: só registra a chamada e devolve ok
//                   (use para ferramentas próprias que não têm efeito no CRM)
//
// Efeitos com parâmetros canônicos (a simulação lê estes nomes de argumento):
//   create_person → name, phone · link_person → person_id ·
//   create_activity → subject, type, note · create_note → content ·
//   update_stage → stage_id · notify_human → message · handoff → motivo
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';

export const EFFECTS = [
  'think',
  'create_person',
  'link_person',
  'create_activity',
  'create_note',
  'update_stage',
  'notify_human',
  'handoff',
  'log',
];

// ---------- Padrões (usados se config/tools.json faltar e no "restaurar padrão") ----------
export const DEFAULT_STAGES = [
  { id: 6, name: 'Inbox' },
  { id: 7, name: 'Identificacao de Responsavel' },
  { id: 8, name: 'Qualificacao' },
  { id: 9, name: 'Apresentacao' },
  { id: 10, name: 'Acompanhamento' },
  { id: 20, name: 'Fechamento' },
];

export const DEFAULT_TOOLS = [
  {
    name: 'think',
    displayName: 'Think',
    effect: 'think',
    enabled: true,
    description:
      'Ferramenta de raciocinio interno. Use para pensar antes de agir e antes de responder. O conteudo nunca e mostrado ao lead.',
    params: [
      {
        name: 'input',
        type: 'string',
        required: true,
        description:
          'Seu raciocinio interno: o que o lead disse, em que etapa esta, o que voce vai fazer e por que. Nunca aparece pro lead.',
      },
    ],
  },
  {
    name: 'create_person',
    displayName: 'Create a person',
    effect: 'create_person',
    enabled: true,
    description:
      'Cria uma pessoa/contato no Pipedrive. Use ao identificar um novo contato a ser abordado (ex.: o decisor indicado). Retorna o person_id.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Nome da pessoa/contato a criar.' },
      { name: 'phone', type: 'string', required: false, description: 'Telefone, se conhecido. Pode ficar vazio.' },
    ],
  },
  {
    name: 'update_person_id',
    displayName: 'Update Person_ID',
    effect: 'link_person',
    enabled: true,
    description:
      'Atualiza o deal para usar o contato do tomador de decisao. Passe exatamente o person_id retornado por create_person.',
    params: [
      { name: 'person_id', type: 'number', required: true, description: 'O person_id retornado por create_person.' },
    ],
  },
  {
    name: 'create_activity',
    displayName: 'Create an activity',
    effect: 'create_activity',
    enabled: true,
    description:
      'Cria uma atividade (tarefa) no deal para um humano executar (abordar novo contato, follow-up agendado, completar atendimento). Sempre com contexto.',
    params: [
      { name: 'subject', type: 'string', required: true, description: 'Assunto da atividade. Ex.: Abordagem, Follow-up.' },
      { name: 'type', type: 'string', required: false, description: 'Tipo da atividade (canal). Ex.: WhatsApp, call, email.' },
      {
        name: 'note',
        type: 'string',
        required: true,
        description:
          'Direcionamento/contexto pra equipe humana: quem abordar, gancho, elogio ja usado, proximo passo.',
      },
    ],
  },
  {
    name: 'create_note',
    displayName: 'Create a note',
    effect: 'create_note',
    enabled: true,
    description:
      'Cria uma nota no deal do Pipedrive. Alimente continuamente: objecoes, dores, preferencias, sinais de qualificacao, fatos do negocio.',
    params: [
      {
        name: 'content',
        type: 'string',
        required: true,
        description:
          'Nota curta e factual pra equipe: objecao, dor, preferencia, sinal de qualificacao, fato do negocio.',
      },
    ],
  },
  {
    name: 'update_deal_stage',
    displayName: 'Update Deal_Stage',
    effect: 'update_stage',
    enabled: true,
    description:
      'Move o deal de estagio no funil. Use sempre que o lead cruzar um limiar. Nao pule etapas.',
    params: [
      {
        name: 'stage_id',
        type: 'number',
        required: true,
        description: 'ID do estagio do funil.',
      },
    ],
  },
  {
    name: 'contact_human',
    displayName: 'contact_human',
    effect: 'notify_human',
    enabled: true,
    description:
      'Avisa a equipe humana (via Telegram) quando precisar de intervencao. Use junto com delegar_para_human em escaladas (preco, juridico, reclamacao seria).',
    params: [
      {
        name: 'message',
        type: 'string',
        required: true,
        description:
          'Resumo pra equipe (Telegram): nome do lead, estagio do funil, o que ele pediu e o contexto relevante.',
      },
    ],
  },
  {
    name: 'delegar_para_human',
    displayName: 'delegar_para_human',
    effect: 'handoff',
    enabled: true,
    description:
      'Transfere o atendimento pra um humano (desativa a IA nesse contato no Chatwoot). Use em situacoes fora do seu preparo: negociacao de preco/condicoes, juridico, reclamacao seria.',
    params: [
      { name: 'motivo', type: 'string', required: false, description: 'Motivo curto da delegacao (registro interno).' },
    ],
  },
];

export function defaultToolsConfig() {
  // Cópia profunda pra ninguém mutar os padrões.
  return JSON.parse(JSON.stringify({ stages: DEFAULT_STAGES, tools: DEFAULT_TOOLS }));
}

// ---------- Carga do config/tools.json (com cache por mtime) ----------
let cache = { mtimeMs: -1, config: null };

function configFile() {
  return paths.toolsConfig || path.join(paths.root, 'config', 'tools.json');
}

export function loadToolsConfig() {
  const file = configFile();
  try {
    const stat = fs.statSync(file);
    if (cache.config && cache.mtimeMs === stat.mtimeMs) return cache.config;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cfg = normalizeToolsConfig(raw);
    cache = { mtimeMs: stat.mtimeMs, config: cfg };
    return cfg;
  } catch {
    // Sem arquivo (ou inválido): padrões.
    return defaultToolsConfig();
  }
}

export function saveToolsConfig(raw) {
  const cfg = normalizeToolsConfig(raw); // valida antes de gravar
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8');
  cache = { mtimeMs: -1, config: null }; // invalida o cache
  return cfg;
}

// Valida e normaliza. Lança erro com mensagem clara quando inválido.
export function normalizeToolsConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('config de ferramentas precisa ser um objeto');
  const stagesIn = Array.isArray(raw.stages) && raw.stages.length ? raw.stages : DEFAULT_STAGES;
  const stages = stagesIn.map((s) => {
    const id = Number(s.id);
    if (!Number.isFinite(id)) throw new Error(`estagio com id invalido: ${JSON.stringify(s)}`);
    return { id, name: String(s.name || `Estagio ${id}`) };
  });
  const seenStage = new Set();
  for (const s of stages) {
    if (seenStage.has(s.id)) throw new Error(`estagio duplicado: ${s.id}`);
    seenStage.add(s.id);
  }

  const toolsIn = Array.isArray(raw.tools) ? raw.tools : [];
  const seenTool = new Set();
  const tools = toolsIn.map((t) => {
    const name = String(t.name || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`nome de ferramenta invalido: "${name}" (use letras, numeros, _ ou -)`);
    }
    if (seenTool.has(name)) throw new Error(`ferramenta duplicada: ${name}`);
    seenTool.add(name);
    const effect = EFFECTS.includes(t.effect) ? t.effect : 'log';
    const params = (Array.isArray(t.params) ? t.params : []).map((p) => {
      const pname = String(p.name || '').trim();
      if (!pname) throw new Error(`parametro sem nome na ferramenta ${name}`);
      return {
        name: pname,
        type: ['string', 'number', 'boolean'].includes(p.type) ? p.type : 'string',
        required: Boolean(p.required),
        description: String(p.description || ''),
      };
    });
    return {
      name,
      displayName: String(t.displayName || name),
      effect,
      enabled: t.enabled !== false,
      description: String(t.description || ''),
      params,
    };
  });

  return { stages, tools };
}

// ---------- Consultas ----------
export function getStages() {
  return loadToolsConfig().stages;
}

export function stageName(id) {
  const s = getStages().find((x) => x.id === Number(id));
  return s ? s.name : `Estagio ${id}`;
}

export function firstStageId() {
  const stages = getStages();
  return stages.length ? stages[0].id : 1;
}

export function enabledTools() {
  return loadToolsConfig().tools.filter((t) => t.enabled !== false);
}

export function toolEffect(name) {
  const t = loadToolsConfig().tools.find((x) => x.name === name);
  return t ? t.effect : null;
}

export function displayName(toolName) {
  const t = loadToolsConfig().tools.find((x) => x.name === toolName);
  return t ? t.displayName : toolName;
}

// Schemas no formato OpenAI/OpenRouter (function calling).
export function toolSchemasForApi() {
  const { stages } = loadToolsConfig();
  const stageMap = stages.map((s) => `${s.id} ${s.name}`).join(', ');
  return enabledTools().map((t) => {
    const properties = {};
    const required = [];
    for (const p of t.params) {
      let description = p.description;
      // Mantém o mapa do funil sempre em dia na descrição do parâmetro de estágio.
      if (t.effect === 'update_stage' && p.name === 'stage_id') {
        description = `${description ? description + ' ' : ''}Estagios: ${stageMap}.`.trim();
      }
      properties[p.name] = { type: p.type, description };
      if (p.required) required.push(p.name);
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: 'object', properties, required },
      },
    };
  });
}

// ---------- CRM simulado ----------
export function createCrmState({ stageId = null, person = null } = {}) {
  return {
    stageId: stageId == null ? firstStageId() : stageId,
    person, // { id, name, phone } ou null
    notes: [], // [{ content, at }]
    activities: [], // [{ subject, type, note, at }]
    contactHumanMessages: [], // [{ message, at }]
    customCalls: [], // [{ tool, args, at }] — efeito "log"
    iaDisabled: false,
    escalated: false,
    _personSeq: 1000,
  };
}

// Executa uma chamada de ferramenta contra o estado simulado, pelo EFEITO dela.
// Retorna o objeto que sera devolvido ao modelo como resultado da tool.
export function executeTool(name, args, crm, nowIso) {
  const at = nowIso;
  const effect = toolEffect(name);
  switch (effect) {
    case 'think':
      return { ok: true, note: 'Pensamento registrado.' };

    case 'create_person': {
      crm._personSeq += 1;
      const id = crm._personSeq;
      crm.person = { id, name: args.name || '', phone: args.phone || '' };
      return { ok: true, person_id: id, name: crm.person.name };
    }

    case 'link_person': {
      const id = Number(args.person_id);
      if (crm.person && crm.person.id === id) {
        return { ok: true, deal_person_id: id, message: 'Deal vinculado ao contato.' };
      }
      // Mesmo sem match exato, simulamos sucesso (o agente pode ter inventado/errado o id).
      return {
        ok: true,
        deal_person_id: id,
        warning: crm.person ? 'person_id diferente do ultimo create_person' : 'nenhuma pessoa criada nesta sessao',
      };
    }

    case 'create_activity': {
      const activity = {
        subject: args.subject || 'Atividade',
        type: args.type || 'WhatsApp',
        note: args.note || '',
        at,
      };
      crm.activities.push(activity);
      return { ok: true, activity_id: crm.activities.length, ...activity };
    }

    case 'create_note': {
      const note = { content: args.content || '', at };
      crm.notes.push(note);
      return { ok: true, note_id: crm.notes.length, content: note.content };
    }

    case 'update_stage': {
      const stageId = Number(args.stage_id);
      const prev = crm.stageId;
      crm.stageId = stageId;
      const known = getStages().some((s) => s.id === stageId);
      return {
        ok: true,
        stage_id: stageId,
        previous_stage_id: prev,
        ...(known ? {} : { warning: 'stage_id fora do funil configurado' }),
      };
    }

    case 'notify_human': {
      crm.contactHumanMessages.push({ message: args.message || '', at });
      crm.escalated = true;
      return { ok: true, delivered: true, channel: 'telegram' };
    }

    case 'handoff': {
      crm.iaDisabled = true;
      crm.escalated = true;
      return { ok: true, ia_disabled: true, message: 'Atendimento transferido pra humano.' };
    }

    case 'log': {
      crm.customCalls.push({ tool: name, args, at });
      return { ok: true, logged: true };
    }

    default:
      return { ok: false, error: `Ferramenta desconhecida: ${name}` };
  }
}
