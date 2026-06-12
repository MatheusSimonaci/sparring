// Carrega configuracao a partir do .env (sem dependencias externas).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Parser minimo de .env (suporta KEY=VALUE, comentarios com #, aspas opcionais).
function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

export const config = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    appTitle: process.env.OPENROUTER_APP_TITLE || '4virtue-chatbot-training',
    siteUrl: process.env.OPENROUTER_SITE_URL || 'http://localhost',
  },
  agentModel: process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4.5',
  icpModel: process.env.ICP_MODEL || 'openai/gpt-4o-mini',
  maxTurns: Number(process.env.MAX_TURNS || 24),
  agentTemperature: Number(process.env.AGENT_TEMPERATURE ?? 0.6),
  icpTemperature: Number(process.env.ICP_TEMPERATURE ?? 0.8),
  // Teto de tokens de SAIDA por turno. Mensagens de WhatsApp sao curtas; um teto
  // baixo evita o erro 402 (modelos como opus reservam 65536 por padrao) e corta custo.
  agentMaxTokens: Number(process.env.AGENT_MAX_TOKENS || 4096),
  icpMaxTokens: Number(process.env.ICP_MAX_TOKENS || 2048),
  // Maximo de chamadas de ferramenta encadeadas num MESMO turno do agente.
  // Nao confundir com MAX_TURNS (turnos da conversa).
  agentMaxToolIters: Number(process.env.AGENT_MAX_TOOL_ITERS || 8),
  // Teto de custo (US$) por conversa. Ao ultrapassar, a conversa encerra
  // (endReason 'budget_exceeded'). 0 = sem teto.
  maxCostPerConversation: Number(process.env.MAX_COST_PER_CONVERSATION || 0.5),
  port: Number(process.env.PORT || 5173),
};

export const paths = {
  root: ROOT,
  agentPrompts: path.join(ROOT, 'config', 'agent'),
  icps: path.join(ROOT, 'config', 'icps'),
  agents: path.join(ROOT, 'config', 'agents'),
  toolsConfig: path.join(ROOT, 'config', 'tools.json'),
  templatesConfig: path.join(ROOT, 'config', 'templates.json'),
  runs: path.join(ROOT, 'output', 'runs'),
  public: path.join(ROOT, 'public'),
};

export function assertApiKey() {
  if (!config.openrouter.apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY nao configurada. Copie .env.example para .env e preencha a chave.'
    );
  }
}
