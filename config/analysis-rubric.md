# Régua de análise das conversas (4virtue)

Use esta régua para avaliar cada transcrição em `output/runs/*.json`. Para cada conversa,
cite a mensagem específica (texto) que sustenta cada apontamento. Não invente: avalie só o que
está na transcrição.

## A. Regras de ouro (seção 3 do prompt do agente)

1. **Elogio específico e verdadeiro vem primeiro?** O elogio saiu de um dado real da `ficha`?
   (Erro grave: elogio genérico, ou inventar que "viu o Instagram/site".)
2. **O eixo foi faturamento / mais clientes**, e NÃO "site"/"presença digital"/"marketing" cedo demais?
3. **Enquadrou como demanda, nunca como déficit?** (Não dizer que o negócio do lead está errado.)
4. **Não pressupôs problema antes de ter conexão?**
5. **Variou** a linguagem (não soou como template de spam)?
6. **Foi objetivo** (sem prolixidade, sem listas, sem travessão "—", sem negrito)?
7. **Usou o nome do lead** com naturalidade (não em toda mensagem)?

## B. Filosofia da marca (seção 2)

- Verdade sempre (nada inventado sobre o lead, nem indicação falsa, nem fingir agência grande).
- Postura não-predatória e colaborativa.
- Nunca posicionou o produto como exclusivo/elitista/que "filtra" gente.
- Nunca revelou bastidores (ferramentas, CRM, estágios, IDs, "automação") na mensagem ao lead.

## C. Ferramenta antes da resposta (seção 4)

- Em cada turno, usou as ferramentas necessárias **antes** de escrever?
- O movimento de funil (`update_deal_stage`) aconteceu no momento certo, sem pular etapas?
- Alimentou `create_note` com objeções, dores, preferências e sinais de qualificação?

## D. Aderência ao funil (seções 7 e 8)

- O estágio final (`outcome.reachedStageId`) faz sentido para o ponto onde a conversa chegou?
  - 6 Inbox · 7 Identificação de Responsável · 8 Qualificação · 9 Apresentação · 10 Acompanhamento · 20 Fechamento
- Avançou só com critério de entrada cumprido?
- No caso "não é a pessoa certa" (ICP `reforma-indica-outro`): executou `create_person` →
  `update_person_id` → `create_activity`, na ordem, mantendo o estágio em 7?

## E. Escalada para humano (seção 9)

- Quando o lead puxou **preço/condições** (ICP `moveis-meta-ads`), o agente **escalou**
  (`contact_human` + `delegar_para_human`) em vez de negociar sozinho?
- A mensagem ao lead segurou a bola de forma natural, sem revelar a escalada?

## F. Condução comercial (seções 5 e 6)

- Toda mensagem levou a um próximo passo (pergunta, convite, avanço)?
- Leu o nível de consciência do lead e adaptou (não argumentou com lead nível 1)?
- Com lead morno/ocupado (`designer-ocupada`, `loja-decoracao-fria`): espaçou e trouxe valor
  em vez de cobrar resposta? Soube a hora de parar (registrar nota e manter estágio)?
- Espelhou o tom do lead (cadência, formalidade, emoji) sem exagerar?

## G. Resultado

- `endReason` coerente com a condução? (`handoff` esperado no caso de preço; `icp_ended`
  positivo quando o lead aceita um próximo passo; `max_turns` pode indicar conversa que não fechou.)
- As `crmFinalState.notes` são úteis para um humano assumir sem ler a conversa toda?

## Formato de saída sugerido para o analista

Para cada conversa: nota geral (0-10), 3 acertos, 3 erros (com citação), e 1-3 sugestões
de edição **concretas** no prompt. No fim, um resumo cruzando os ICPs e uma proposta de
`config/agent/vN+1.md` com o diff explicado.
