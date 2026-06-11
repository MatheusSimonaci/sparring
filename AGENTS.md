# Sparring — guia para agentes de IA

Você é um agente de IA operando o **Sparring**: um harness local que testa um agente
de vendas/atendimento (definido por um system prompt + ferramentas simuladas) contra
**clientes simulados (ICPs)**. Tudo é arquivo local + CLI — você consegue configurar,
rodar e analisar o treino inteiro sem interface gráfica.

O humano acompanha as conversas pela interface web (`npm start` → http://localhost:5173);
você trabalha pelos arquivos e pelo CLI descritos aqui. Os dois veem o mesmo estado.

## Pré-requisitos

- Node.js 18+. Sem `npm install` (zero dependências).
- `.env` com `OPENROUTER_API_KEY` (copie de `.env.example`). **Nunca** leia a chave em
  voz alta, nem a escreva em logs ou commits.
- **Rodar simulação gasta dinheiro real** (OpenRouter). Respeite o teto por conversa
  (`--budget` / `MAX_COST_PER_CONVERSATION`) e confirme com o usuário antes de baterias
  grandes (ex.: `--icp all --repeat 5`).

## Mapa de arquivos (tudo que você pode editar)

| Caminho | O que é | Formato |
|---|---|---|
| `config/agent/*.md` | System prompts do agente sob teste (versões: `exemplo.md`, `v2.md`…) | Markdown livre |
| `config/icps/*.json` | Clientes simulados (personas + ficha) | JSON (schema abaixo) |
| `config/agents/*.json` | Setups de modelo (único ou roteador multi-modelo) | JSON (schema abaixo) |
| `config/tools.json` | Ferramentas simuladas + estágios do funil — **configuráveis** | JSON (schema abaixo) |
| `config/analysis-rubric.md` | Régua de avaliação das conversas (adapte ao negócio do usuário) | Markdown |
| `output/runs/*.json` | Transcrições geradas (uma por conversa) + `batch_*.json` | JSON (leitura) |

## Schemas

### ICP (`config/icps/<id>.json`)

```jsonc
{
  "id": "arquiteto-cetico",            // = nome do arquivo
  "name": "Rafael - Arquiteto premium (cetico)",
  "startStageId": 6,                    // estágio inicial (ver config/tools.json)
  "persona": "Texto livre em 2ª pessoa: quem a pessoa é, como fala no chat, nível de consciência, personalidade. OBRIGATÓRIO incluir um '=== PERFIL DE DECISAO E NEGOCIACAO ===': o que a faz FECHAR (emite [FECHOU]), RECUSAR ([RECUSOU]) ou encerrar ([ENCERRAR]). Sem isso a conversa não chega a um desfecho.",
  "ficha": {                            // o que o agente sob teste recebe sobre o lead
    "nome": "Rafael",                   // chaves livres — espelhe o que o CRM real teria
    "nicho": "...", "regiao": "...", "decisor": "...", "observacoes": "..."
  }
}
```

Bons ICPs são **diversos**: um que negocia preço, um cético, um morno/ocupado, um que
não é o decisor. Extraia-os de conversas reais do usuário quando existirem.

### Setup de agente (`config/agents/<id>.json`)

```jsonc
// modo único
{ "id": "single-sonnet", "name": "...", "mode": "single", "promptId": "exemplo",
  "model": "anthropic/claude-sonnet-4.5", "temperature": 0.6, "reasoningEffort": null }

// modo roteador: um modelo barato escolhe, a cada turno, qual papel responde
{ "id": "router-trio", "name": "...", "mode": "router", "promptId": "exemplo",
  "router": { "model": "openai/gpt-oss-120b", "temperature": 0, "maxTokens": 400 },
  "roles": [
    { "id": "vendedor", "label": "...", "model": "openai/gpt-5.4-mini",
      "description": "QUANDO usar este papel (o roteador decide por isto)",
      "promptAddendum": "instrução extra só pra este papel (opcional)" },
    { "id": "closer", "model": "anthropic/claude-opus-4.8", "reasoningEffort": "high",
      "description": "preço, objeção, negociação, fechamento" }
  ],
  "defaultRole": "vendedor" }
```

`temperature`/`reasoningEffort` só são enviados a modelos que suportam (detecção automática).

### Ferramentas + funil (`config/tools.json`)

Nada é fixo: renomeie, desligue (`"enabled": false`), crie ferramentas, mude o funil.
Cada ferramenta tem um `effect` — o que ela faz no CRM simulado:

`think` · `create_person` · `link_person` · `create_activity` · `create_note` ·
`update_stage` · `notify_human` · `handoff` (transfere pra humano e **encerra**) ·
`log` (só registra a chamada — use para ferramentas próprias sem efeito no CRM).

```jsonc
{
  "stages": [ { "id": 6, "name": "Inbox" }, { "id": 20, "name": "Fechamento" } ],
  "tools": [
    { "name": "create_note", "displayName": "Create a note", "effect": "create_note",
      "enabled": true, "description": "o modelo decide usar a ferramenta por isto",
      "params": [ { "name": "content", "type": "string", "required": true, "description": "..." } ] }
  ]
}
```

Efeitos leem argumentos canônicos: `create_person→name,phone` · `link_person→person_id` ·
`create_activity→subject,type,note` · `create_note→content` · `update_stage→stage_id` ·
`notify_human→message` · `handoff→motivo`. (`update_stage` ganha a lista de estágios na
descrição automaticamente.) Espelhe aqui as ferramentas que o agente REAL do usuário tem.

## Rodar (CLI)

```bash
node cli/run.js list                                   # prompts, setups e ICPs disponíveis
node cli/run.js --icp all --prompt exemplo             # bateria completa
node cli/run.js --icp arquiteto-cetico --prompt v2 --repeat 3
node cli/run.js --icp all --agent router-trio --budget 0.5
node cli/run.js --icp a,b --prompt v2 --json --quiet   # resumo machine-readable no stdout
```

Flags: `--icp <id|id,id|all>` · `--prompt <id>` · `--agent <setup>` · `--agent-model` ·
`--icp-model` · `--max-turns N` · `--repeat N` · `--budget X` · `--json` · `--quiet`.

Análise agregada rápida (sem IA): `node cli/analyze.js [--json] [--file <run.json>]`.

## Ler os resultados

Um JSON por conversa em `output/runs/`. Campos-chave para análise:

- `messages[]` — a conversa (com `toolCalls`, `thinking` por turno do agente);
- `outcome` — `endReason` (`closed`/`declined`/`handoff`/`icp_ended`/`max_turns`/
  `stalled`/`budget_exceeded`…), `decision`, `closed`, `turns`, `reachedStageId`;
- `crmFinalState` — notas, atividades, escalada (o agente alimentou o CRM direito?);
- `cost` — US$ medido de verdade, por modelo e componente;
- `routing[]` — qual papel/modelo respondeu cada turno (modo roteador).

## Loop de iteração (o seu trabalho)

1. **Configurar** — entreviste o usuário (ou leia o material dele) e preencha:
   prompt do agente real em `config/agent/`, ICPs do negócio dele, ferramentas
   reais em `config/tools.json`, modelos em `config/agents/`.
2. **Rodar** — `node cli/run.js --icp all --prompt <id> --json`.
3. **Analisar** — leia os runs mais recentes com a régua de `config/analysis-rubric.md`
   (adapte a régua ao negócio antes). Cite mensagens concretas, não impressões.
4. **Iterar** — escreva `config/agent/v<N+1>.md` com as correções, explique o diff,
   rode de novo e compare `outcome`/`cost` entre versões.
5. **Reportar** — resuma para o humano: o que mudou, o que melhorou, custo gasto.

Nunca edite uma versão de prompt que já foi testada — crie a próxima (`v2`, `v3`…),
para a comparação fazer sentido.
