// Cliente minimo do OpenRouter (compativel com a API de chat completions da OpenAI).
// Envia so os parametros que o modelo aceita (temperature/reasoning) e mede custo real.
import { config } from '../config.js';
import { getModelCaps } from './capabilities.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama o endpoint de chat completions.
 * @returns {Promise<{message, finishReason, usage, cost, promptTokens, completionTokens, model, raw}>}
 */
export async function chatCompletion({
  model,
  messages,
  tools,
  toolChoice,
  temperature,
  reasoningEffort,
  maxTokens,
  maxRetries = 3,
  signal,
}) {
  const url = `${config.openrouter.baseUrl}/chat/completions`;
  const caps = await getModelCaps(model);

  function buildBody({ stripTuning = false } = {}) {
    const body = {
      model,
      messages,
      max_tokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : undefined,
      usage: { include: true }, // pede o custo real de volta
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = toolChoice || 'auto';
    }
    if (!stripTuning) {
      // So envia temperature se o modelo aceita (gpt-5/opus rejeitam).
      if (typeof temperature === 'number' && caps.temperature) body.temperature = temperature;
      // So envia reasoning se o modelo aceita e foi configurado.
      if (reasoningEffort && caps.reasoning) body.reasoning = { effort: reasoningEffort };
    }
    return body;
  }

  let lastErr;
  let stripTuning = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.openrouter.siteUrl,
          'X-Title': config.openrouter.appTitle,
        },
        body: JSON.stringify(buildBody({ stripTuning })),
        signal,
      });

      if (!res.ok) {
        const text = await res.text();
        // 400 por parametro nao suportado: remove temperature/reasoning e tenta de novo.
        if (res.status === 400 && !stripTuning && /temperature|reasoning|unsupported|not supported/i.test(text)) {
          stripTuning = true;
          continue;
        }
        // 429 / 5xx: backoff e retry.
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(`OpenRouter erro: ${JSON.stringify(data.error).slice(0, 500)}`);
      }
      const choice = data.choices && data.choices[0];
      if (!choice) {
        throw new Error(`Resposta sem choices: ${JSON.stringify(data).slice(0, 300)}`);
      }
      const usage = data.usage || null;
      return {
        message: choice.message,
        finishReason: choice.finish_reason,
        usage,
        cost: usage && typeof usage.cost === 'number' ? usage.cost : 0,
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        model: data.model || model,
        raw: data,
      };
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr;
}
