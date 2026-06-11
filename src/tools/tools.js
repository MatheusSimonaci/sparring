// Definicao das ferramentas do agente (espelham os nodes do n8n) e a
// implementacao SIMULADA delas. Nenhuma chamada real ao Pipedrive/Telegram/Chatwoot.

// Mapa do funil (Pipedrive) - secao 7 do prompt do agente.
export const STAGES = {
  6: 'Inbox',
  7: 'Identificacao de Responsavel',
  8: 'Qualificacao',
  9: 'Apresentacao',
  10: 'Acompanhamento',
  20: 'Fechamento',
};

export function stageName(id) {
  return STAGES[id] || `Estagio ${id}`;
}

// Schemas no formato OpenAI/OpenRouter (function calling).
// Os nomes sao snake_case (exigencia da API); displayName mapeia pro node do n8n.
export const TOOLS = [
  {
    name: 'think',
    displayName: 'Think',
    schema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description:
            'Seu raciocinio interno: o que o lead disse, em que etapa esta, o que voce vai fazer e por que. Nunca aparece pro lead.',
        },
      },
      required: ['input'],
    },
    description:
      'Ferramenta de raciocinio interno. Use para pensar antes de agir e antes de responder. O conteudo nunca e mostrado ao lead.',
  },
  {
    name: 'create_person',
    displayName: 'Create a person',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome da pessoa/contato a criar.' },
        phone: { type: 'string', description: 'Telefone, se conhecido. Pode ficar vazio.' },
      },
      required: ['name'],
    },
    description:
      'Cria uma pessoa/contato no Pipedrive. Use ao identificar um novo contato a ser abordado (ex.: o decisor indicado). Retorna o person_id.',
  },
  {
    name: 'update_person_id',
    displayName: 'Update Person_ID',
    schema: {
      type: 'object',
      properties: {
        person_id: { type: 'number', description: 'O person_id retornado por create_person.' },
      },
      required: ['person_id'],
    },
    description:
      'Atualiza o deal para usar o contato do tomador de decisao. Passe exatamente o person_id retornado por create_person.',
  },
  {
    name: 'create_activity',
    displayName: 'Create an activity',
    schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Assunto da atividade. Ex.: Abordagem, Follow-up.' },
        type: {
          type: 'string',
          description: 'Tipo da atividade (canal). Ex.: WhatsApp, call, email.',
        },
        note: {
          type: 'string',
          description:
            'Direcionamento/contexto pra equipe humana: quem abordar, gancho, elogio ja usado, proximo passo.',
        },
      },
      required: ['subject', 'note'],
    },
    description:
      'Cria uma atividade (tarefa) no deal para um humano executar (abordar novo contato, follow-up agendado, completar atendimento). Sempre com contexto.',
  },
  {
    name: 'create_note',
    displayName: 'Create a note',
    schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Nota curta e factual pra equipe: objecao, dor, preferencia, sinal de qualificacao, fato do negocio.',
        },
      },
      required: ['content'],
    },
    description:
      'Cria uma nota no deal do Pipedrive. Alimente continuamente: objecoes, dores, preferencias, sinais de qualificacao, fatos do negocio.',
  },
  {
    name: 'update_deal_stage',
    displayName: 'Update Deal_Stage',
    schema: {
      type: 'object',
      properties: {
        stage_id: {
          type: 'number',
          description:
            'ID do estagio: 6 Inbox, 7 Identificacao de Responsavel, 8 Qualificacao, 9 Apresentacao, 10 Acompanhamento, 20 Fechamento.',
        },
      },
      required: ['stage_id'],
    },
    description:
      'Move o deal de estagio no funil. Use sempre que o lead cruzar um limiar (secao 7). Nao pule etapas.',
  },
  {
    name: 'contact_human',
    displayName: 'contact_human',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'Resumo pra equipe (Telegram): nome do lead, estagio do funil, o que ele pediu e o contexto relevante.',
        },
      },
      required: ['message'],
    },
    description:
      'Avisa a equipe humana (via Telegram) quando precisar de intervencao. Use junto com delegar_para_human em escaladas (preco, juridico, reclamacao seria).',
  },
  {
    name: 'delegar_para_human',
    displayName: 'delegar_para_human',
    schema: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'Motivo curto da delegacao (registro interno).',
        },
      },
      required: [],
    },
    description:
      'Transfere o atendimento pra um humano (desativa a IA nesse contato no Chatwoot). Use em situacoes fora do seu preparo: negociacao de preco/condicoes, juridico, reclamacao seria.',
  },
];

// Retorna os schemas no formato exigido pela API de chat completions.
export function toolSchemasForApi() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));
}

export function displayName(toolName) {
  const t = TOOLS.find((x) => x.name === toolName);
  return t ? t.displayName : toolName;
}

// Estado inicial do "CRM" simulado para uma conversa.
export function createCrmState({ stageId = 6, person = null } = {}) {
  return {
    stageId,
    person, // { id, name, phone } ou null
    notes: [], // [{ content, at }]
    activities: [], // [{ subject, type, note, at }]
    contactHumanMessages: [], // [{ message, at }]
    iaDisabled: false,
    escalated: false,
    _personSeq: 1000,
  };
}

// Executa uma chamada de ferramenta contra o estado simulado.
// Retorna o objeto que sera devolvido ao modelo como resultado da tool.
export function executeTool(name, args, crm, nowIso) {
  const at = nowIso;
  switch (name) {
    case 'think':
      return { ok: true, note: 'Pensamento registrado.' };

    case 'create_person': {
      crm._personSeq += 1;
      const id = crm._personSeq;
      crm.person = { id, name: args.name || '', phone: args.phone || '' };
      return { ok: true, person_id: id, name: crm.person.name };
    }

    case 'update_person_id': {
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

    case 'update_deal_stage': {
      const stageId = Number(args.stage_id);
      const prev = crm.stageId;
      crm.stageId = stageId;
      return { ok: true, stage_id: stageId, previous_stage_id: prev };
    }

    case 'contact_human': {
      crm.contactHumanMessages.push({ message: args.message || '', at });
      crm.escalated = true;
      return { ok: true, delivered: true, channel: 'telegram' };
    }

    case 'delegar_para_human': {
      crm.iaDisabled = true;
      crm.escalated = true;
      return { ok: true, ia_disabled: true, message: 'Atendimento transferido pra humano.' };
    }

    default:
      return { ok: false, error: `Ferramenta desconhecida: ${name}` };
  }
}
