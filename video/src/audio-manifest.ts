// Manifesto de áudio — GERADO por generate-audio.mjs. Não editar à mão.
export const AUDIO_MANIFEST: {
  narration: Partial<Record<"hook" | "problem" | "replay" | "outro", string>>;
  music: string | null;
} = {
  "narration": {
    "hook": "audio/narration-hook.mp3",
    "problem": "audio/narration-problem.mp3",
    "replay": "audio/narration-replay.mp3",
    "outro": "audio/narration-outro.mp3"
  },
  "music": "audio/music.wav"
};
