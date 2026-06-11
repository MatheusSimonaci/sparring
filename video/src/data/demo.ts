// Adaptador: lê o JSON REAL da run (output/runs) e seleciona o trecho exibido.
// Nada aqui é inventado — os textos vêm verbatim de run.json.
import run from "./run.json";

export type ChatEvent = {
  role: "agent" | "lead";
  text: string;
  tools?: string[]; // nomes internos das ferramentas (create_note, ...)
};

type RunMessage = {
  role: "agent" | "lead";
  text: string;
  toolCalls?: { name: string; displayName?: string }[];
};

const messages = run.messages as RunMessage[];

// Índices das mensagens exibidas no replay (subconjunto da conversa real,
// mantendo a alternância e o arco: abertura -> qualificação -> proposta ->
// objeção de preço -> fechamento). Texto sempre verbatim.
const SELECTED = [0, 1, 2, 3, 4, 5, 6, 7, 10, 15];

export const events: ChatEvent[] = SELECTED.map((i) => {
  const m = messages[i];
  return {
    role: m.role,
    text: m.text,
    tools: m.toolCalls?.map((t) => t.name),
  };
});

export const leadName = "Matheus, marcenaria";
export const leadRole = "cliente simulado · móveis planejados";
export const totalCostUsd = (run as { cost: { total: number } }).cost.total;

const decision = (run as { outcome: { decision: string | null } }).outcome
  .decision;
export const outcomeLabel =
  decision === "closed"
    ? "[FECHOU] o cliente simulado aceitou"
    : decision === "declined"
      ? "[RECUSOU] após negociar"
      : "conversa encerrada";
