// Servidor HTTP sem dependencias: serve a UI estatica + API JSON + streaming SSE.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, paths, assertApiKey } from './config.js';
import { runConversation } from './sim/conversation.js';
import { loadToolsConfig, saveToolsConfig, defaultToolsConfig, EFFECTS } from './tools/tools.js';
import {
  listAgentPrompts,
  readAgentPrompt,
  writeAgentPrompt,
  listIcps,
  readIcp,
  writeIcp,
  deleteIcp,
  listAgentSetups,
  readAgentSetup,
  writeAgentSetup,
  deleteAgentSetup,
  saveRun,
  saveBatch,
  listRuns,
  readRun,
} from './store/store.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- Registro de jobs (para SSE) ----------
const jobs = new Map(); // jobId -> { events, done, subscribers:Set, result, error }

function emit(job, evt) {
  job.events.push(evt);
  for (const res of job.subscribers) writeSse(res, evt);
}

function writeSse(res, evt) {
  try {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  } catch {
    /* socket fechado */
  }
}

// ---------- Helpers HTTP ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) reject(new Error('corpo muito grande'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const full = path.join(paths.public, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(paths.public)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nao encontrado');
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Execucao da simulacao (background, com SSE) ----------
async function runJob(job, body, signal) {
  const {
    promptId,
    systemPrompt: systemPromptBody,
    icpIds,
    icpId,
    agentModel,
    icpModel,
    agentSetupId,
    maxCost,
    maxTurns,
    agentTemperature,
    icpTemperature,
    repeat,
  } = body;

  // Resolve setup de agente (roteamento). Se nao informado, fica null (modo single via agentModel).
  let setup = null;
  if (agentSetupId) {
    setup = readAgentSetup(agentSetupId);
    if (!setup) throw new Error(`Setup de agente "${agentSetupId}" nao encontrado.`);
  }

  // Resolve prompt do agente (playbook). Precedencia: systemPrompt > promptId > setup.promptId.
  let systemPrompt = systemPromptBody;
  let resolvedPromptId = promptId || (setup && setup.promptId) || 'custom';
  if (!systemPrompt) {
    const pid = promptId || (setup && setup.promptId);
    if (pid) {
      systemPrompt = readAgentPrompt(pid);
      if (!systemPrompt) throw new Error(`Prompt "${pid}" nao encontrado.`);
    }
  }
  if (!systemPrompt) throw new Error('Nenhum systemPrompt nem promptId valido informado.');

  // Resolve ICPs.
  const ids = icpIds && icpIds.length ? icpIds : icpId ? [icpId] : [];
  if (!ids.length) throw new Error('Nenhum ICP selecionado.');
  const icps = ids.map((id) => {
    const icp = readIcp(id);
    if (!icp) throw new Error(`ICP "${id}" nao encontrado.`);
    return icp;
  });

  const times = Math.max(1, Number(repeat) || 1);
  const saved = [];
  const batchId = crypto.randomUUID();
  const batchCreatedAt = new Date().toISOString();

  outer: for (const icp of icps) {
    for (let r = 0; r < times; r++) {
      if (signal.aborted) break outer;
      const transcript = await runConversation({
        systemPrompt,
        icp,
        agentSetup: setup,
        agentModel: agentModel || config.agentModel,
        icpModel: icpModel || config.icpModel,
        maxTurns: Number(maxTurns) || config.maxTurns,
        agentTemperature:
          agentTemperature != null ? Number(agentTemperature) : config.agentTemperature,
        icpTemperature: icpTemperature != null ? Number(icpTemperature) : config.icpTemperature,
        maxCost: maxCost != null ? Number(maxCost) : config.maxCostPerConversation,
        promptId: resolvedPromptId,
        signal,
        onEvent: (evt) => emit(job, { ...evt, icpId: icp.id, repeatIndex: r }),
      });
      // Conversa cancelada nao e salva (descartada).
      if (transcript.outcome.endReason === 'cancelled') break outer;
      const savedRun = saveRun(transcript);
      saved.push({ ...savedRun, icp: icp.id, outcome: transcript.outcome });
      emit(job, {
        type: 'saved',
        icpId: icp.id,
        conversationId: transcript.id,
        file: savedRun.file,
        outcome: transcript.outcome,
      });
    }
  }

  let batchFile = null;
  if (saved.length > 1) {
    const batch = {
      id: batchId,
      createdAt: batchCreatedAt,
      promptId: resolvedPromptId,
      agentModel: agentModel || config.agentModel,
      icpModel: icpModel || config.icpModel,
      runs: saved,
    };
    batchFile = saveBatch(batch).file;
  }

  return { saved, batchFile };
}

function startJob(body) {
  const jobId = crypto.randomUUID();
  const abortController = new AbortController();
  const job = {
    id: jobId,
    events: [],
    done: false,
    subscribers: new Set(),
    result: null,
    error: null,
    cancelled: false,
    abortController,
  };
  jobs.set(jobId, job);

  runJob(job, body, abortController.signal)
    .then((result) => {
      job.result = result;
      job.done = true;
      emit(job, { type: 'complete', result, cancelled: job.cancelled });
      closeSubscribers(job);
    })
    .catch((err) => {
      job.done = true;
      if (job.cancelled || err?.name === 'AbortError') {
        emit(job, { type: 'complete', result: { saved: [] }, cancelled: true });
      } else {
        job.error = String(err.message || err);
        emit(job, { type: 'fatal', error: job.error });
      }
      closeSubscribers(job);
    });

  // Limpa o job depois de 10 min.
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
  return jobId;
}

function closeSubscribers(job) {
  for (const res of job.subscribers) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  job.subscribers.clear();
}

// ---------- Roteamento ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method;

  try {
    // ---- API ----
    if (p === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        apiKeyConfigured: Boolean(config.openrouter.apiKey),
        defaults: {
          agentModel: config.agentModel,
          icpModel: config.icpModel,
          maxTurns: config.maxTurns,
          agentTemperature: config.agentTemperature,
          icpTemperature: config.icpTemperature,
          maxCostPerConversation: config.maxCostPerConversation,
        },
      });
    }

    // Ferramentas simuladas + funil (config/tools.json)
    if (p === '/api/tools' && method === 'GET') {
      return sendJson(res, 200, { ...loadToolsConfig(), effects: EFFECTS });
    }
    if (p === '/api/tools' && method === 'PUT') {
      const body = await readBody(req);
      try {
        return sendJson(res, 200, saveToolsConfig(body));
      } catch (e) {
        return sendJson(res, 400, { error: String(e.message || e) });
      }
    }
    if (p === '/api/tools/defaults' && method === 'GET') {
      return sendJson(res, 200, { ...defaultToolsConfig(), effects: EFFECTS });
    }

    if (p === '/api/agents' && method === 'GET') {
      return sendJson(res, 200, listAgentSetups());
    }
    if (p.startsWith('/api/agents/') && method === 'GET') {
      const id = p.slice('/api/agents/'.length);
      const setup = readAgentSetup(id);
      if (!setup) return sendJson(res, 404, { error: 'setup nao encontrado' });
      return sendJson(res, 200, setup);
    }
    if (p.startsWith('/api/agents/') && method === 'PUT') {
      const id = p.slice('/api/agents/'.length);
      const reqBody = await readBody(req);
      reqBody.id = reqBody.id || id;
      return sendJson(res, 200, writeAgentSetup(reqBody));
    }
    if (p.startsWith('/api/agents/') && method === 'DELETE') {
      const id = p.slice('/api/agents/'.length);
      return sendJson(res, 200, { deleted: deleteAgentSetup(id) });
    }

    if (p === '/api/prompts' && method === 'GET') {
      return sendJson(res, 200, listAgentPrompts());
    }
    if (p.startsWith('/api/prompts/') && method === 'GET') {
      const id = p.slice('/api/prompts/'.length);
      const content = readAgentPrompt(id);
      if (content == null) return sendJson(res, 404, { error: 'prompt nao encontrado' });
      return sendJson(res, 200, { id, content });
    }
    if (p.startsWith('/api/prompts/') && method === 'PUT') {
      const id = p.slice('/api/prompts/'.length);
      const body = await readBody(req);
      const out = writeAgentPrompt(id, body.content || '');
      return sendJson(res, 200, out);
    }

    if (p === '/api/icps' && method === 'GET') {
      return sendJson(res, 200, listIcps());
    }
    if (p.startsWith('/api/icps/') && method === 'GET') {
      const id = p.slice('/api/icps/'.length);
      const icp = readIcp(id);
      if (!icp) return sendJson(res, 404, { error: 'icp nao encontrado' });
      return sendJson(res, 200, icp);
    }
    if (p.startsWith('/api/icps/') && method === 'PUT') {
      const id = p.slice('/api/icps/'.length);
      const body = await readBody(req);
      body.id = body.id || id;
      const out = writeIcp(body);
      return sendJson(res, 200, out);
    }
    if (p.startsWith('/api/icps/') && method === 'DELETE') {
      const id = p.slice('/api/icps/'.length);
      return sendJson(res, 200, { deleted: deleteIcp(id) });
    }

    if (p === '/api/runs' && method === 'GET') {
      return sendJson(res, 200, listRuns());
    }
    if (p.startsWith('/api/runs/') && method === 'GET') {
      const file = p.slice('/api/runs/'.length);
      const run = readRun(file);
      if (!run) return sendJson(res, 404, { error: 'run nao encontrado' });
      return sendJson(res, 200, run);
    }

    if (p === '/api/simulate' && method === 'POST') {
      try {
        assertApiKey();
      } catch (e) {
        return sendJson(res, 400, { error: String(e.message || e) });
      }
      const body = await readBody(req);
      const jobId = startJob(body);
      return sendJson(res, 200, { jobId });
    }

    if (p.startsWith('/api/cancel/') && method === 'POST') {
      const jobId = p.slice('/api/cancel/'.length);
      const job = jobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: 'job nao encontrado' });
      job.cancelled = true;
      try {
        job.abortController.abort();
      } catch {
        /* ignore */
      }
      emit(job, { type: 'cancelled' });
      return sendJson(res, 200, { ok: true, cancelled: true });
    }

    if (p.startsWith('/api/stream/') && method === 'GET') {
      const jobId = p.slice('/api/stream/'.length);
      const job = jobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: 'job nao encontrado' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Reenvia eventos ja bufferizados.
      for (const evt of job.events) writeSse(res, evt);
      if (job.done) {
        return res.end();
      }
      job.subscribers.add(res);
      req.on('close', () => job.subscribers.delete(res));
      return;
    }

    if (p.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'rota nao encontrada' });
    }

    // ---- Estaticos ----
    return serveStatic(req, res, p);
  } catch (err) {
    return sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(config.port, () => {
  const keyOk = config.openrouter.apiKey ? 'OK' : 'FALTANDO (configure .env)';
  console.log('');
  console.log('  4virtue chatbot_training');
  console.log(`  Interface:    http://localhost:${config.port}`);
  console.log(`  OpenRouter:   ${keyOk}`);
  console.log(`  Agente:       ${config.agentModel}`);
  console.log(`  ICP:          ${config.icpModel}`);
  console.log('');
});
