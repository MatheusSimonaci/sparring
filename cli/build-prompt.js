#!/usr/bin/env node
// Compila um prompt em camadas: config/agent/<id>/NN-*.md (ordem alfabetica)
// -> config/agent/<id>.md (o arquivo que o harness consome).
//
// Camadas convencionadas:
//   00-nucleo.md        identidade + missao + principios (quase nunca muda)
//   10-conhecimento.md  fatos do negocio (oferta, preco, prazo, funil)
//   20-playbook.md      situacoes -> movimentos
//   30-casos.md         conversas exemplares anotadas
//
// Uso: node cli/build-prompt.js v11
// Lint minimo: termos banidos no texto final (vazamento de bastidor por engano).
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../src/config.js';

const id = process.argv[2];
if (!id) {
  console.error('Uso: node cli/build-prompt.js <id>   (ex.: v11 — exige config/agent/v11/)');
  process.exit(1);
}

const dir = path.join(paths.agentPrompts, id);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`ERRO: pasta de camadas nao encontrada: config/agent/${id}/`);
  process.exit(1);
}

const layers = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort();
if (!layers.length) {
  console.error(`ERRO: nenhuma camada .md em config/agent/${id}/`);
  process.exit(1);
}

const parts = layers.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim());
const out = parts.join('\n\n---\n\n') + '\n';

// Lint: frases que nunca podem estar num prompt compilado (sinais de erro de edicao).
const banned = ['TODO', 'FIXME', 'XXX:', '{{'];
const hits = banned.filter((b) => out.includes(b));
if (hits.length) {
  console.error(`ERRO de lint: o prompt compilado contem marcadores pendentes: ${hits.join(', ')}`);
  process.exit(1);
}

const outFile = path.join(paths.agentPrompts, `${id}.md`);
fs.writeFileSync(outFile, out, 'utf8');
const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log(`OK: config/agent/${id}.md compilado de ${layers.length} camadas (${layers.join(', ')}) — ${kb} KB`);
