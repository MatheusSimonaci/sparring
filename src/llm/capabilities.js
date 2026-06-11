// Descobre, via /models do OpenRouter, quais parametros cada modelo aceita
// (temperature, reasoning) e o preco por token. Cache em memoria (1 fetch por processo).
import { config } from '../config.js';

let cache = null; // Map<modelId, caps>
let inflight = null;

const PERMISSIVE = { tools: true, reasoning: false, temperature: true, pricing: null, known: false };

async function fetchModels() {
  const url = `${config.openrouter.baseUrl}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}` },
  });
  if (!res.ok) throw new Error(`/models ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const m of data.data || []) {
    const sp = m.supported_parameters || [];
    map.set(m.id, {
      tools: sp.includes('tools'),
      reasoning: sp.includes('reasoning') || sp.includes('reasoning_effort'),
      temperature: sp.includes('temperature'),
      pricing: m.pricing
        ? { prompt: Number(m.pricing.prompt) || 0, completion: Number(m.pricing.completion) || 0 }
        : null,
      known: true,
    });
  }
  return map;
}

async function ensureCache() {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetchModels()
      .then((m) => {
        cache = m;
        return m;
      })
      .catch(() => {
        cache = new Map(); // falha: segue permissivo (com retry de 400 no client)
        return cache;
      });
  }
  return inflight;
}

/** Retorna as capacidades do modelo (permissivo se desconhecido). */
export async function getModelCaps(model) {
  const map = await ensureCache();
  return map.get(model) || { ...PERMISSIVE };
}

/** Preco {prompt, completion} por token, ou null se desconhecido. */
export async function getPricing(model) {
  const caps = await getModelCaps(model);
  return caps.pricing;
}

/** Forca recarregar o cache (ex.: apos trocar de chave). */
export function resetCapabilitiesCache() {
  cache = null;
  inflight = null;
}
