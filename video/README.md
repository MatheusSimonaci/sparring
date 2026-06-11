# Vídeo demo (Remotion)

Fonte do vídeo demo do Sparring — duas composições: `DemoHorizontal` (1920×1080,
para a página) e `DemoVertical` (1080×1920, para social). Visual segue o design
system 4virtue (dark, champagne, Newsreader/Outfit/JetBrains Mono) em `src/theme.ts`.

## Comandos

```console
npm i                  # instalar dependências
npm run dev            # preview no Remotion Studio
npx remotion render DemoHorizontal out/demo.mp4
npx remotion render DemoVertical out/demo-vertical.mp4
```

## Narração e música

A narração (PT-BR) e a música de fundo são geradas por script — os arquivos
ficam em `public/audio/` e os timings das cenas se ajustam à narração:

```console
# requer ELEVENLABS_API_KEY (env ou video/.env, fora do git)
node generate-audio.mjs            # narração + música (ElevenLabs)
node generate-audio.mjs --force    # regrava a narração mesmo se já existir
```

Se a sua chave não tiver a permissão `sound_generation` (plano free), gere a
trilha ambiente local (pad em loop perfeito, Node puro) antes — o script a usa
como fallback:

```console
node generate-pad.mjs
node generate-audio.mjs
```

O roteiro da narração e a voz (`ELEVENLABS_VOICE_ID`) estão no topo de
`generate-audio.mjs`. Os arquivos `src/timings.ts` e `src/audio-manifest.ts`
são gerados — não edite à mão.

## Dados

O replay lê `src/data/run.json` — cópia byte a byte de uma conversa real gerada
pela ferramenta (nada é inventado). A curadoria de quais mensagens aparecem está
em `src/data/demo.ts`.
