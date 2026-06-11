// Roda UM turno do agente sob teste (o "Matheus"/bot do n8n).
// Faz o loop de tool calling: ferramenta primeiro, resposta depois.
import { chatCompletion } from '../llm/openrouter.js';
import {
  toolSchemasForApi,
  executeTool,
  displayName,
  stageName,
} from '../tools/tools.js';

const MAX_TOOL_ITERS = 8;

function renderFicha(ficha) {
  if (!ficha) return '(sem ficha de pesquisa fornecida)';
  if (typeof ficha === 'string') return ficha;
  const lines = [];
  for (const [k, v] of Object.entries(ficha)) {
    if (v === null || v === undefined || v === '') continue;
    lines.push(`- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  return lines.join('\n') || '(ficha vazia)';
}

function renderCrm(crm) {
  const notes =
    crm.notes.length === 0
      ? '(nenhuma nota ainda)'
      : crm.notes.map((n, i) => `  ${i + 1}. ${n.content}`).join('\n');
  const acts =
    crm.activities.length === 0
      ? '(nenhuma atividade ainda)'
      : crm.activities
          .map((a, i) => `  ${i + 1}. [${a.type}] ${a.subject}: ${a.note}`)
          .join('\n');
  const person = crm.person
    ? `${crm.person.name}${crm.person.phone ? ' / ' + crm.person.phone : ''} (person_id=${crm.person.id})`
    : '(ainda nao criada / contato original do deal)';
  return [
    `- Estagio atual do deal: ${crm.stageId} - ${stageName(crm.stageId)}`,
    `- Pessoa vinculada: ${person}`,
    `- Escalado para humano: ${crm.escalated ? 'SIM' : 'nao'}`,
    `- Notas ja registradas no Pipedrive:\n${notes}`,
    `- Atividades:\n${acts}`,
  ].join('\n');
}

function buildRuntimeContext(ficha, crm, isOpening) {
  return [
    'CONTEXTO OPERACIONAL (interno - nunca repasse isto ao lead).',
    '',
    'Ficha de pesquisa deste lead (use so o que esta aqui; nao invente fatos nem diga que acessou Instagram/site):',
    renderFicha(ficha),
    '',
    'Estado atual no CRM (Pipedrive):',
    renderCrm(crm),
    '',
    'Como agir neste turno:',
    '- Voce e o Matheus, respondendo no WhatsApp. Use as ferramentas necessarias ANTES de escrever (ferramenta primeiro, resposta depois).',
    '- Use a ferramenta think para raciocinar antes de agir.',
    '- O CRM anda a frente da conversa: registre notas, mova estagio, crie pessoa/atividade quando for o caso.',
    '- Sua RESPOSTA FINAL em texto e exatamente a mensagem que vai pro WhatsApp do lead. Sem bastidores, sem mencionar ferramentas/CRM/estagios/IDs.',
    '- Uma ideia por mensagem. Frases curtas. Nunca use o caractere de travessao.',
    isOpening
      ? '- Esta e a PRIMEIRA mensagem (Etapa A). Faca a abertura: elogio especifico e verdadeiro (so se tiver dado real) + desejo de faturamento.'
      : '- Responda a ultima mensagem do lead, conduzindo a venda pro proximo passo.',
  ].join('\n');
}

function mapHistory(history) {
  // lead -> user ; agent -> assistant. Sem replay de tool calls antigas
  // (o estado do CRM ja resume o que foi feito).
  return history
    .filter((m) => m.text && m.text.trim())
    .map((m) => ({
      role: m.role === 'agent' ? 'assistant' : 'user',
      content: m.text,
    }));
}

/**
 * Executa um turno do agente.
 * @returns {Promise<{message: string, toolCalls: Array, thinking: string, usage: object, error?: string}>}
 */
export async function runAgentTurn({
  systemPrompt,
  ficha,
  crm,
  history,
  model,
  temperature,
  reasoningEffort,
  nowIso,
  isOpening = false,
  signal,
  maxTokens,
  chat = chatCompletion, // injetavel pra teste
}) {
  const baseMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: buildRuntimeContext(ficha, crm, isOpening) },
    ...mapHistory(history),
  ];
  if (isOpening) {
    baseMessages.push({
      role: 'user',
      content:
        '[SISTEMA] Inicie a abordagem com este lead agora, seguindo a Etapa A do fluxo comercial.',
    });
  }

  const tools = toolSchemasForApi();
  const messages = [...baseMessages];
  const toolCallsLog = [];
  const thinkingParts = [];
  let usage = null;
  let cost = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const accrue = (resp) => {
    cost += resp.cost || 0;
    promptTokens += resp.promptTokens || 0;
    completionTokens += resp.completionTokens || 0;
  };
  // Guarda qualquer texto que o modelo emita junto com tool calls (alguns modelos
  // mandam a mensagem na mesma resposta da ferramenta). Vira rede de seguranca
  // pra nunca devolver um turno vazio.
  let lastContent = '';

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const resp = await chat({
      model,
      messages,
      tools,
      toolChoice: 'auto',
      temperature,
      reasoningEffort,
      maxTokens,
      signal,
    });
    usage = resp.usage || usage;
    accrue(resp);
    const msg = resp.message || {};
    const toolCalls = msg.tool_calls || [];
    if (msg.content && msg.content.trim()) lastContent = msg.content.trim();

    if (toolCalls.length > 0) {
      // Adiciona a mensagem do assistant com as tool calls e executa cada uma.
      messages.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: toolCalls,
      });
      for (const tc of toolCalls) {
        let args = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = { _raw: tc.function.arguments };
        }
        const name = tc.function.name;
        const result = executeTool(name, args, crm, nowIso);
        const entry = {
          name,
          displayName: displayName(name),
          args,
          result,
          at: nowIso,
        };
        toolCallsLog.push(entry);
        if (name === 'think' && args.input) thinkingParts.push(args.input);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      continue; // volta pro modelo com os resultados
    }

    // Sem tool calls: o content e a mensagem final pro lead.
    const finalText = (msg.content || '').trim() || lastContent;
    if (finalText) {
      return {
        message: finalText,
        toolCalls: toolCallsLog,
        thinking: thinkingParts.join('\n---\n'),
        usage,
        cost,
        promptTokens,
        completionTokens,
      };
    }
    // Resposta vazia (sem texto e sem ferramenta): sai do loop pra forcar uma geracao.
    break;
  }

  // Recuperacao: o modelo terminou sem texto (resposta vazia) ou estourou o limite
  // de ferramentas. Pede a mensagem explicitamente, SEM ferramentas, pra nao deixar
  // o turno vazio (era a causa do "mandou a nota e parou").
  let recovered = '';
  try {
    const resp = await chat({
      model,
      messages: [
        ...messages,
        {
          role: 'user',
          content:
            '[SISTEMA] Agora escreva, em texto puro, a proxima mensagem do Matheus para o lead no WhatsApp. Nao use ferramentas. Responda somente com a mensagem.',
        },
      ],
      temperature,
      reasoningEffort,
      maxTokens,
      signal,
    });
    usage = resp.usage || usage;
    accrue(resp);
    recovered = (resp.message?.content || '').trim();
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    // qualquer outro erro: cai no fallback (lastContent) abaixo
  }

  const finalText = recovered || lastContent;
  return {
    message: finalText,
    toolCalls: toolCallsLog,
    thinking: thinkingParts.join('\n---\n'),
    usage,
    cost,
    promptTokens,
    completionTokens,
    error: finalText
      ? undefined
      : 'O modelo retornou resposta vazia (sem texto e sem ferramenta) neste turno.',
  };
}
