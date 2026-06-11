// Gera narração (PT-BR) e música de fundo via ElevenLabs e ajusta os timings.
//
//   node generate-audio.mjs            # gera tudo (narração + música)
//   node generate-audio.mjs --no-music # só narração
//
// Chave: variável de ambiente ELEVENLABS_API_KEY ou linha ELEVENLABS_API_KEY=...
// num arquivo .env nesta pasta (video/.env — fora do git).
// Saídas: public/audio/*.mp3, src/audio-manifest.ts e src/timings.ts.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ---- chave ----------------------------------------------------------------
let apiKey = process.env.ELEVENLABS_API_KEY;
const envPath = join(here, ".env");
if (!apiKey && existsSync(envPath)) {
  const m = readFileSync(envPath, "utf8").match(/ELEVENLABS_API_KEY\s*=\s*(\S+)/);
  if (m) apiKey = m[1];
}
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY ausente (env ou video/.env). Abortando.");
  process.exit(1);
}

// ---- roteiro --------------------------------------------------------------
// Voz: George (narrativa, multilingual). Troque por outra voice_id se quiser.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const MODEL_ID = "eleven_multilingual_v2";

const NARRATION = {
  hook: "Agentes de IA erram. A questão é: na frente de quem?",
  problem:
    "A maioria coloca o agente pra falar com cliente de verdade sem nunca ter testado. E descobre o erro na conversa errada, com o cliente errado.",
  replay:
    "O Sparring cria clientes simulados que negociam de verdade com o seu agente. Essa conversa é real: o cliente pediu desconto, o agente conduziu... e fechou. Cada ação no CRM fica registrada. E cada conversa custa centavos — medidos de verdade, centavo por centavo.",
  outro:
    "Teste o seu agente antes do primeiro cliente real. Sparring. Open source, no GitHub.",
};

// duração mínima de cada cena (s) — a narração pode esticar, nunca encolher
const MIN_SCENE = { hook: 4, problem: 8, replay: 26, outro: 8 };
const PAD = { hook: 1.2, problem: 1.4, replay: 2.2, outro: 2.4 };

const MUSIC_PROMPT =
  "Warm minimal ambient cinematic background pad, soft analog texture, slow evolving, sophisticated and calm, subtle low piano notes, no drums, no melody hooks, seamless loop";

// ---- helpers ----------------------------------------------------------------
const outDir = join(here, "public", "audio");
mkdirSync(outDir, { recursive: true });

async function tts(text, file) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`TTS ${file}: HTTP ${res.status} — ${await res.text()}`);
  }
  writeFileSync(join(outDir, file), Buffer.from(await res.arrayBuffer()));
}

async function music(file) {
  const body = { text: MUSIC_PROMPT, duration_seconds: 20, prompt_influence: 0.4 };
  let res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ ...body, loop: true }),
  });
  if (res.status === 422 || res.status === 400) {
    // alguns planos não aceitam "loop" — tenta sem
    res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
    });
  }
  if (!res.ok) {
    throw new Error(`Música: HTTP ${res.status} — ${await res.text()}`);
  }
  writeFileSync(join(outDir, file), Buffer.from(await res.arrayBuffer()));
}

async function durationOf(file) {
  const { Input, ALL_FORMATS, FilePathSource } = await import("mediabunny");
  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(join(outDir, file)),
  });
  return input.computeDuration();
}

// ---- main -------------------------------------------------------------------
const wantMusic = !process.argv.includes("--no-music");

const manifest = { narration: {}, music: null };
const timings = { ...MIN_SCENE };

const force = process.argv.includes("--force");

for (const [scene, text] of Object.entries(NARRATION)) {
  const file = `narration-${scene}.mp3`;
  process.stdout.write(`narração ${scene}... `);
  if (force || !existsSync(join(outDir, file))) {
    await tts(text, file);
  } else {
    process.stdout.write("(reusando) ");
  }
  const dur = await durationOf(file);
  manifest.narration[scene] = `audio/${file}`;
  timings[scene] = Math.max(MIN_SCENE[scene], Math.ceil((dur + PAD[scene]) * 10) / 10);
  console.log(`${dur.toFixed(1)}s → cena ${timings[scene]}s`);
}

if (wantMusic) {
  process.stdout.write("música de fundo... ");
  try {
    await music("music.mp3");
    manifest.music = "audio/music.mp3";
    console.log("ok");
  } catch (err) {
    // sem permissão/crédito na API: usa trilha local se existir
    // (ex.: pad ambiente gerado via `npx remotion ffmpeg`, ver README)
    const local = ["music.mp3", "music.m4a", "music.wav"].find((f) =>
      existsSync(join(outDir, f)),
    );
    if (local) {
      manifest.music = `audio/${local}`;
      console.log(`API falhou — usando trilha local ${local}`);
    } else {
      manifest.music = null;
      console.warn(`falhou, seguindo sem música: ${err.message}`);
    }
  }
}

writeFileSync(
  join(here, "src", "audio-manifest.ts"),
  `// Manifesto de áudio — GERADO por generate-audio.mjs. Não editar à mão.
export const AUDIO_MANIFEST: {
  narration: Partial<Record<"hook" | "problem" | "replay" | "outro", string>>;
  music: string | null;
} = ${JSON.stringify(manifest, null, 2)};
`,
);

writeFileSync(
  join(here, "src", "timings.ts"),
  `// Duração de cada cena, em segundos — GERADO por generate-audio.mjs
// (cena dura pelo menos a narração + respiro). Não editar à mão.
export const SCENES = ${JSON.stringify(timings, null, 2)};
`,
);

console.log("\nManifesto e timings atualizados. Agora renderize:");
console.log("  npx remotion render DemoHorizontal out/demo.mp4");
console.log("  npx remotion render DemoVertical out/demo-vertical.mp4");
