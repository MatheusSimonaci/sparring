---
name: sparring
description: Configura e opera o Sparring (harness de treino para agentes de IA de vendas/atendimento). Use quando o usuário pedir para configurar o agente/ICPs/ferramentas do Sparring, rodar simulações de treino, analisar transcrições ou iterar o prompt do agente. Tudo que dá pra preencher na interface, esta skill preenche por arquivos + CLI.
---

# Sparring — operar o harness de treino

Leia `AGENTS.md` na raiz do repositório — ele tem o mapa de arquivos, os schemas
(ICPs, setups, ferramentas) e as flags do CLI. Este arquivo define o **fluxo de
trabalho**; o AGENTS.md é a referência.

## Antes de tudo

1. Confirme que `.env` existe com `OPENROUTER_API_KEY` (senão, peça ao usuário —
   nunca leia/exiba a chave).
2. `node cli/run.js list` para ver o estado atual (prompts, setups, ICPs).
3. Simulação **gasta dinheiro real**. Anuncie o custo estimado antes de baterias
   grandes e use `--budget` sempre.

## Fluxos

### "Configure o Sparring pro meu negócio"

Entreviste o usuário (curto, objetivo): o que vende, ticket, canal, quem são os
clientes típicos (o que pechincha? o cético? o que some?), que ferramentas o agente
real tem (CRM, agendamento, handoff), e qual o system prompt atual do agente — se
existir, peça o texto e salve em `config/agent/<id>.md`.

Depois preencha, nesta ordem:
1. `config/tools.json` — espelhe as ferramentas e o funil REAIS (schema no AGENTS.md);
2. `config/icps/*.json` — 3 a 5 perfis diversos, cada um com `=== PERFIL DE DECISAO
   E NEGOCIACAO ===` na persona (sem isso a conversa não fecha nem recusa);
3. `config/agents/*.json` — modelos que o usuário quer pagar (único ou roteador);
4. `config/templates.json` — se a operação real abre com mensagem fixa disparada por
   automação, cadastre o template aqui (`default` aplica em toda conversa; o prompt do
   agente deve citar o template pra ele não repetir a abertura; `--template none` desliga);
5. `config/analysis-rubric.md` — adapte a régua às regras do negócio dele.

Mostre um resumo do que criou e onde, antes de rodar.

### "Rode o treino"

```bash
node cli/run.js --icp all --prompt <id> --json
```

Reporte: desfecho por ICP, estágio final, turnos e custo (o `--json` já traz tudo).
O usuário pode acompanhar ao vivo em http://localhost:5173 (`npm start`).

### "Analise / melhore o agente"

1. Leia os runs mais recentes em `output/runs/` (campo `outcome` primeiro; depois
   `messages` das conversas que falharam).
2. Avalie com `config/analysis-rubric.md`, citando mensagens concretas — se existir
   `config/analysis-rubric.interna.md` (versão local, fora do git), use ELA.
3. Escreva a próxima versão em `config/agent/v<N+1>.md` (nunca edite versão já
   testada), explique o diff, rode de novo e compare.

### "Itere barato" (stress probes — prefira isto a baterias de simulação)

1. `node cli/probe.js list` — banco de cenários (`config/scenarios/*.json`) + ledger.
2. `node cli/probe.js --scenario all --prompt <id>` — sweep; só os FAIL guiam a mudança.
3. Mexa na camada certa do prompt (`config/agent/<id>/` → `node cli/build-prompt.js <id>`),
   re-rode SÓ os cenários que falharam, e feche com um sweep de confirmação.
4. Simulação completa (`cli/run.js`) apenas pro que é multi-turno de verdade, com
   `--max-turns 8 --budget 0.2`. Lição nova de conversa real → vire um cenário novo
   no banco (regressão eterna, centavos).

## Limites

- Não invente dados de leads reais nos ICPs — invente personas, não pessoas.
- Mudanças em `config/tools.json` valem na próxima simulação (sem restart).
