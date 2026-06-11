// Sintetiza a trilha ambiente de fallback (public/audio/music.wav) em Node puro.
// Pad de acorde A maior (senos puros, sem harmônicos), com ondulação lenta.
// Todas as frequências completam ciclos INTEIROS em 20s e a ondulação (período
// 10s) também — o arquivo faz loop perfeito, sem clique nem emenda audível.
//
//   node generate-pad.mjs
//
// Use isto quando a chave da ElevenLabs não tiver a permissão sound_generation;
// generate-audio.mjs detecta o arquivo e o usa como música de fundo.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SR = 44100;
const DUR = 20; // segundos
const N = SR * DUR;

// [freq Hz, ganho] — A2/A3 detunado (chorus lento), C#4, E4, A4
const PARTIALS = [
  [110, 0.16],
  [220, 0.2],
  [220.45, 0.1],
  [277.2, 0.13],
  [329.6, 0.11],
  [440, 0.06],
];

const samples = new Int16Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const swell = 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / 10);
  let v = 0;
  for (const [f, g] of PARTIALS) v += g * Math.sin(2 * Math.PI * f * t);
  samples[i] = Math.round(Math.max(-1, Math.min(1, v * swell * 0.55)) * 32767);
}

// WAV PCM 16-bit mono
const data = Buffer.from(samples.buffer);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16); // tamanho do bloco fmt
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

mkdirSync(join(here, "public", "audio"), { recursive: true });
const out = join(here, "public", "audio", "music.wav");
writeFileSync(out, Buffer.concat([header, data]));
console.log(`ok: ${out} (${((44 + data.length) / 1024 / 1024).toFixed(1)} MB, ${DUR}s, loop perfeito)`);
