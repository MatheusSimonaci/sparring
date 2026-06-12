// Leitura/escrita de prompts do agente, ICPs e transcricoes (runs).
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ---------- Prompts do agente ----------
export function listAgentPrompts() {
  ensureDir(paths.agentPrompts);
  return fs
    .readdirSync(paths.agentPrompts)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ id: f.replace(/\.md$/, ''), file: f }));
}

export function readAgentPrompt(id) {
  const file = path.join(paths.agentPrompts, `${safeId(id)}.md`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

export function writeAgentPrompt(id, content) {
  ensureDir(paths.agentPrompts);
  const file = path.join(paths.agentPrompts, `${safeId(id)}.md`);
  fs.writeFileSync(file, content, 'utf8');
  return { id: safeId(id), file: path.basename(file) };
}

// ---------- ICPs ----------
export function listIcps() {
  ensureDir(paths.icps);
  return fs
    .readdirSync(paths.icps)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(paths.icps, f), 'utf8'));
        if (!obj.id) obj.id = f.replace(/\.json$/, '');
        return obj;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function readIcp(id) {
  const file = path.join(paths.icps, `${safeId(id)}.json`);
  if (!fs.existsSync(file)) return null;
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!obj.id) obj.id = safeId(id);
  return obj;
}

export function writeIcp(icp) {
  ensureDir(paths.icps);
  if (!icp.id) throw new Error('ICP precisa de um id.');
  const id = safeId(icp.id);
  icp.id = id;
  const file = path.join(paths.icps, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(icp, null, 2), 'utf8');
  return icp;
}

export function deleteIcp(id) {
  const file = path.join(paths.icps, `${safeId(id)}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

// ---------- Agent setups (roteamento multi-modelo) ----------
export function listAgentSetups() {
  ensureDir(paths.agents);
  return fs
    .readdirSync(paths.agents)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(paths.agents, f), 'utf8'));
        if (!obj.id) obj.id = f.replace(/\.json$/, '');
        return obj;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function readAgentSetup(id) {
  const file = path.join(paths.agents, `${safeId(id)}.json`);
  if (!fs.existsSync(file)) return null;
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!obj.id) obj.id = safeId(id);
  return obj;
}

export function writeAgentSetup(setup) {
  ensureDir(paths.agents);
  if (!setup.id) throw new Error('Setup de agente precisa de um id.');
  const id = safeId(setup.id);
  setup.id = id;
  const file = path.join(paths.agents, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(setup, null, 2), 'utf8');
  return setup;
}

export function deleteAgentSetup(id) {
  const file = path.join(paths.agents, `${safeId(id)}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

// ---------- Templates de primeira mensagem (config/templates.json) ----------
// A abertura pode ser uma mensagem FIXA (template), enviada antes de o agente
// "acordar" — como na operacao real, em que a automacao dispara o primeiro toque.
// Schema: { "default": "<id|null>", "templates": [{ "id", "name", "text" }] }
export function readTemplatesConfig() {
  if (!fs.existsSync(paths.templatesConfig)) return { default: null, templates: [] };
  try {
    const obj = JSON.parse(fs.readFileSync(paths.templatesConfig, 'utf8'));
    return {
      default: obj.default || null,
      templates: Array.isArray(obj.templates) ? obj.templates.filter((t) => t && t.id && t.text) : [],
    };
  } catch {
    return { default: null, templates: [] };
  }
}

export function writeTemplatesConfig(cfg) {
  const clean = {
    default: cfg.default || null,
    templates: (Array.isArray(cfg.templates) ? cfg.templates : []).map((t) => {
      if (!t || !t.id || !t.text) throw new Error('Template precisa de id e text.');
      return { id: safeId(t.id), name: t.name || t.id, text: String(t.text) };
    }),
  };
  if (clean.default && !clean.templates.some((t) => t.id === clean.default)) {
    throw new Error(`Template default "${clean.default}" nao existe na lista.`);
  }
  fs.writeFileSync(paths.templatesConfig, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

// Resolve o template de abertura: id explicito > default do config > null.
// id 'none' desliga o template mesmo havendo default.
export function getOpeningTemplate(id) {
  if (id === 'none') return null;
  const cfg = readTemplatesConfig();
  const wanted = id || cfg.default;
  if (!wanted) return null;
  const t = cfg.templates.find((x) => x.id === wanted);
  if (!t) {
    if (id) throw new Error(`Template "${id}" nao encontrado em config/templates.json.`);
    return null; // default apontando pra algo removido: segue sem template
  }
  return { id: t.id, text: t.text };
}

// ---------- Runs (transcricoes) ----------
function tsForFile(iso) {
  // 2026-06-02T15:39:50.660Z -> 20260602-153950
  return iso.replace(/[-:T]/g, '').replace(/\..*/, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1-$2');
}

export function saveRun(transcript) {
  ensureDir(paths.runs);
  const stamp = tsForFile(transcript.createdAt || new Date().toISOString());
  const fname = `${stamp}_${safeId(transcript.icp.id)}_${transcript.id.slice(0, 8)}.json`;
  const file = path.join(paths.runs, fname);
  fs.writeFileSync(file, JSON.stringify(transcript, null, 2), 'utf8');
  return { file: fname, path: file };
}

export function saveBatch(batch) {
  ensureDir(paths.runs);
  const stamp = tsForFile(batch.createdAt || new Date().toISOString());
  const fname = `batch_${stamp}.json`;
  const file = path.join(paths.runs, fname);
  fs.writeFileSync(file, JSON.stringify(batch, null, 2), 'utf8');
  return { file: fname, path: file };
}

export function listRuns() {
  ensureDir(paths.runs);
  return fs
    .readdirSync(paths.runs)
    .filter((f) => f.endsWith('.json') && !f.startsWith('batch_'))
    .map((f) => {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(paths.runs, f), 'utf8'));
        return {
          file: f,
          id: obj.id,
          createdAt: obj.createdAt,
          icp: obj.icp?.name || obj.icp?.id,
          promptId: obj.agent?.promptId,
          model: obj.agent?.model,
          outcome: obj.outcome,
          metrics: obj.metrics,
        };
      } catch {
        return { file: f, error: 'falha ao ler' };
      }
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function readRun(file) {
  const safe = path.basename(file); // evita path traversal
  const full = path.join(paths.runs, safe);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}
