# Sparring

**Teste seu agente de IA de vendas contra clientes simulados — antes do primeiro cliente real.**

O Sparring é um harness comportamental, local e open source, para agentes de IA que vendem
ou atendem por chat (WhatsApp etc.). Ele simula:

- **O agente sob teste** — recebe o seu *system prompt* e um conjunto de **ferramentas de CRM
  simuladas** (espelhadas de um fluxo real com Pipedrive, Telegram e Chatwoot via n8n).
  Nenhuma chamada real é feita a esses serviços.
- **Clientes simulados (ICPs)** — personas configuráveis que conversam com o agente como leads
  reais: pechincham, enrolam, indicam outra pessoa, fecham ou recusam.

A cada rodada, agente e cliente conversam mensagem a mensagem. No fim, é gerado **um arquivo
JSON por conversa** em `output/runs/`, com transcrição, tool calls, estado final do CRM,
desfecho e **custo real em US$** — pronto para você (ou um agente de IA analista) avaliar e
iterar o prompt.

Tudo roda via **OpenRouter** (um endpoint, vários modelos).

> Por que "Sparring"? Porque agente de IA erra — a questão é na frente de quem.
> Aqui ele treina com sparring antes da luta real.
>
> **Página do projeto (com demo em vídeo):** https://sparring-three.vercel.app
> (fonte em `docs/`, hospedada na Vercel).

---

## 1. Instalação

Pré-requisito: Node.js 18+.

```powershell
git clone https://github.com/MatheusSimonaci/sparring
cd sparring
copy .env.example .env       # Mac/Linux: cp .env.example .env
```

Não há `npm install`: a aplicação é **zero-dependências** (usa só o Node).
(Exceção: o projeto do vídeo demo em `video/` tem npm próprio — opcional.)

Edite o `.env`:

- `OPENROUTER_API_KEY` — obrigatório (https://openrouter.ai/keys).
- `AGENT_MODEL` — modelo do agente sob teste. **Precisa suportar tool calling.**
- `ICP_MODEL` — modelo do cliente simulado (pode ser mais barato).

---

## 2. Interface web

```powershell
npm start
# abre em http://localhost:5173
```

A interface é dark, no design system da [4virtue](https://4virtue.com), e organiza tudo em
formulários — nada de editar JSON na mão (mas todo formulário mostra/escreve os mesmos
arquivos que um agente de IA editaria; ver `AGENTS.md`).

Seções:

- **Rodar** — escolhe o prompt, marca os ICPs, ajusta modelos/turnos/repetições e roda. As conversas aparecem **em tempo real**, com os *tool calls* (chips) e o raciocínio (`think`) visíveis. Cada conversa termina com um resumo e um link **baixar JSON**.
  - **Cancelar** — interrompe a execução em andamento na hora (aborta os requests em voo). A conversa interrompida **não é salva**.
  - **Limpar** — recarrega a página (limpa a tela). Não cancela um job rodando; use Cancelar antes se quiser parar.
- **Prompt do agente** — edita o system prompt do agente e salva versões em `config/agent/`. "Salvar como" cria uma versão nova para comparar. O repositório vem com um **prompt de exemplo** (`config/agent/exemplo.md`) que vende um serviço fictício compatível com os ICPs de exemplo — troque pelo prompt do SEU agente.
- **Agentes & roteamento** — setups de modelo em formulário estruturado: modelo único, ou roteador + papéis (cada papel com modelo, descrição e adendo de prompt).
- **Clientes simulados** — cria/edita/exclui personas. Cada ICP tem a **persona** (como o cliente se comporta, incluindo o perfil de decisão/negociação) e a **ficha** (o que o agente recebe sobre o lead), editada campo a campo.
- **Ferramentas & funil** — edita as ferramentas simuladas e os estágios do funil (ver seção 4). Renomeie, desligue, crie as suas.
- **Histórico** — lista as transcrições salvas, mostra a conversa renderizada, as notas do CRM simulado e o download do JSON.

---

## 3. Linha de comando (para você ou para um agente de IA)

```powershell
# listar prompts e ICPs disponíveis
node cli/run.js list

# rodar TODOS os ICPs com o prompt de exemplo
node cli/run.js --icp all --prompt exemplo

# rodar um ICP específico, 3 vezes
node cli/run.js --icp arquiteto-cetico --prompt exemplo --repeat 3

# rodar alguns ICPs e imprimir resumo machine-readable (JSON no stdout)
node cli/run.js --icp arquiteto-cetico,moveis-meta-ads --prompt exemplo --json
```

Flags: `--icp <id|id,id|all>`, `--prompt <id>`, `--agent-model`, `--icp-model`,
`--max-turns N`, `--repeat N`, `--json`, `--quiet`.

Análise rápida (agregada, sem IA):

```powershell
node cli/analyze.js                      # estatísticas de todas as runs
node cli/analyze.js --file <arquivo.json># imprime uma conversa legível
node cli/analyze.js --json               # agregado em JSON
```

---

## 4. As ferramentas simuladas (configuráveis)

As ferramentas que o agente recebe e o mapa do funil são **100% configuráveis**: edite na
aba **Ferramentas & funil** da interface, ou direto em **`config/tools.json`** (um agente de
IA também pode editar — ver `AGENTS.md`). Nenhuma faz chamada externa — só atualizam um
"CRM" em memória e são registradas na transcrição. As mudanças valem na próxima simulação.

Cada ferramenta tem um **efeito** no CRM simulado. Os efeitos disponíveis:

| Efeito | O que faz | Argumentos canônicos |
|---|---|---|
| `think` | raciocínio interno (aparece como `think:` na UI) | `input` |
| `create_person` | cria contato, devolve `person_id` | `name`, `phone` |
| `link_person` | vincula o contato ao deal | `person_id` |
| `create_activity` | cria tarefa para humano | `subject`, `type`, `note` |
| `create_note` | registra nota no deal | `content` |
| `update_stage` | move o deal de estágio (a lista de estágios entra sozinha na descrição) | `stage_id` |
| `notify_human` | "avisa a equipe" (Telegram) | `message` |
| `handoff` | desativa a IA no contato → **encerra a conversa** | `motivo` |
| `log` | só registra a chamada (ferramentas próprias sem efeito no CRM) | qualquer |

O conjunto padrão (`think`, `create_person`, `update_person_id`, `create_activity`,
`create_note`, `update_deal_stage`, `contact_human`, `delegar_para_human`) espelha nodes de
um fluxo n8n real com Pipedrive/Telegram/Chatwoot — **troque pelos do SEU agente**: renomeie,
desligue, mude descrições e argumentos, crie novas. O funil padrão (6 Inbox … 20 Fechamento)
também é só um exemplo; defina os estágios do seu processo.

O agente recebe, a cada turno, a **ficha do lead** e o **estado atual do CRM** (estágio, notas, atividades) — equivalente às notas do CRM no fluxo real.

---

## 4b. Roteamento multi-modelo (setups de agente) + custo

O agente sob teste pode usar **um modelo só** ou um **roteador** que escolhe, a cada turno, qual modelo responde. Setups ficam em `config/agents/*.json` e são editáveis na aba **Agentes / Roteamento**.

- **mode `single`**: um `model` + `temperature`/`reasoningEffort` opcionais.
- **mode `router`**: um `router` (modelo barato, ex.: `openai/gpt-oss-120b`) decide entre os `roles`. Cada role tem `model`, `reasoningEffort`, uma `description` (o roteador usa pra decidir) e um `promptAddendum` opcional. O roteamento é **reavaliado a cada turno**.

Setup de exemplo: **`router-trio`** = `gpt-oss-120b` (roteador) + `gpt-5.4-mini` (vendedor) + `claude-opus-4.8` (closer).

```powershell
node cli/run.js --icp moveis-meta-ads --agent router-trio
node cli/run.js --icp all --agent router-trio --budget 1.0   # teto US$1/conversa
```

**Parâmetros por modelo:** `temperature` e `reasoningEffort` só são enviados a modelos que aceitam — a app detecta isso pelo `/models` do OpenRouter e filtra sozinha.

**Custo:** medido de verdade (campo `usage` do OpenRouter) e somado por **modelo**, **componente** (router/vendedor/closer/icp) e **conversa**. Aparece na interface (rodapé de cada conversa), no JSON (`cost`) e no `analyze`.

**Teto de orçamento:** `MAX_COST_PER_CONVERSATION` (.env) ou o campo "Teto US$/conversa" / `--budget`. Ao ultrapassar, a conversa encerra com `endReason: budget_exceeded`.

---

## 5. O JSON gerado (para análise)

Um arquivo por conversa em `output/runs/`. Campos principais:

```jsonc
{
  "id": "uuid",
  "createdAt": "ISO",
  "icp": { "id", "name", "personaSummary", "startStageId" },
  "agent": { "promptId": "exemplo", "promptHash": "...", "model": "..." },
  "icpModel": "...",
  "ficha": { ... },                 // o que o agente sabia do lead
  "messages": [                     // a conversa, em ordem
    { "role": "agent"|"lead", "text", "createdAt",
      "toolCalls": [ { "name", "displayName", "args", "result" } ],  // só agent
      "thinking": "..." }                                            // só agent
  ],
  "toolCalls": [ ... ],             // todos os tool calls achatados, com nº do turno
  "crmFinalState": { "stageId", "stageName", "person", "notes", "activities", "escalated" },
  "outcome": { "endReason", "decision", "closed", "turns", "reachedStageId", "reachedStageName", "escalated" },
  "metrics": { "toolCounts", "noteCount", "activityCount", "agentMessages", "leadMessages" },
  "cost": { "total", ... }          // US$, medido pelo OpenRouter
}
```

`endReason` pode ser: `closed` (lead fechou a compra), `declined` (recusou após negociar),
`handoff` (agente escalou pra humano), `icp_ended` (encerrou sem decisão de compra),
`max_turns`, `agent_error`, `icp_error`, `budget_exceeded`, `cancelled`.

`decision` (`closed` | `declined` | `ended` | `null`) vem das marcas que o cliente simulado
emite: `[FECHOU]` (comprou), `[RECUSOU]` (recusou após negociar) ou `[ENCERRAR]` (encerrou,
ex.: não era o decisor). `closed: true` é o atalho pra "fechou a venda". Cada ICP tem na sua
**persona** um perfil de decisão/negociação (como reage ao preço, o que o faz fechar ou
recusar), por isso a conversa vai até a negociação e o fechamento, não só a qualificação.

Quando você roda vários ICPs de uma vez, também é salvo um `batch_*.json` com o resumo do lote.

---

## 6. Para agentes de IA (interface pra humanos, skill pra agentes)

O Sparring foi desenhado pra ser operado **tanto por você quanto pelo seu agente de CLI**
(Claude Code, Cursor, Codex…). Tudo que a interface faz é ler/escrever arquivos em `config/`
e chamar o CLI — então um agente faz o mesmo, sem interface:

- **`AGENTS.md`** (raiz) — o guia AI-friendly: mapa de arquivos, schemas de ICP/setup/
  ferramentas, flags do CLI e o loop de iteração. Funciona com qualquer agente.
- **Skill para Claude Code** — o repositório traz `.claude/skills/sparring/`; trabalhando
  dentro do repo, o Claude Code a encontra sozinho. Peça, por exemplo:

> Use a skill **sparring**: me entreviste sobre o meu negócio, preencha o prompt do agente,
> os clientes simulados e as ferramentas em `config/`, rode o treino com teto de US$ 0,50
> por conversa e me diga onde o agente errou.

Os mesmos dados que você preencheria na mão, o agente preenche por você — e você acompanha
as simulações ao vivo na interface web.

O loop de iteração que a aplicação habilita:

1. **Configurar**: o agente entrevista você e preenche `config/` (prompt, ICPs, ferramentas).
2. **Rodar**: `node cli/run.js --icp all --prompt <id> --json`
3. **Analisar**: o agente lê os JSON em `output/runs/` com a régua de `config/analysis-rubric.md`
   e aponta erros concretos, com citação.
4. **Ajustar**: o agente escreve uma nova versão em `config/agent/` (nunca edita versão já testada).
5. **Repetir** com o novo prompt e comparar desfecho e custo entre versões.

---

## 7. Estrutura

```
sparring/
├── AGENTS.md                   # guia AI-friendly (schemas + CLI) p/ qualquer agente
├── .claude/skills/sparring/    # skill do Claude Code (opera o harness por você)
├── config/
│   ├── agent/exemplo.md        # system prompt de exemplo (troque pelo seu)
│   ├── agents/*.json           # setups de agente (modelo único ou roteador)
│   ├── icps/*.json             # personas dos clientes simulados (exemplos inclusos)
│   ├── tools.json              # ferramentas simuladas + funil (configuráveis)
│   └── analysis-rubric.md      # régua para a análise das conversas
├── src/
│   ├── config.js               # lê .env
│   ├── llm/openrouter.js       # cliente OpenRouter (chat + tool calling)
│   ├── llm/capabilities.js     # detecta parâmetros suportados por modelo
│   ├── tools/tools.js          # carrega config/tools.json + efeitos simulados
│   ├── agent/salesAgent.js     # turno do agente (loop de ferramentas)
│   ├── agent/router.js         # roteamento multi-modelo por turno
│   ├── icp/icpClient.js        # turno do cliente simulado
│   ├── sim/conversation.js     # orquestra a conversa inteira
│   ├── store/store.js          # lê/escreve prompts, ICPs e runs
│   └── server.js               # servidor web + API + SSE
├── public/                     # interface web (HTML/CSS/JS, design system 4virtue)
├── cli/run.js                  # roda simulações (headless)
├── cli/analyze.js              # análise agregada rápida
├── docs/                       # página do projeto (hospedada na Vercel) + vídeo demo
├── video/                      # fonte do vídeo demo (Remotion; npm próprio, opcional)
├── test/                       # testes (npm test)
└── output/runs/                # transcrições JSON geradas (fora do git)
```

---

## Licença

[MIT](LICENSE). Feito por [Matheus Simonaci](https://github.com/MatheusSimonaci) — usado de
verdade na prospecção da 4virtue. Publicado porque me foi útil; se te poupar uma conversa
ruim com um cliente real, já valeu.

Contato: matheussimonaci@gmail.com ·
[LinkedIn](https://www.linkedin.com/in/matheus-simonaci-vieira-910b59280/)
