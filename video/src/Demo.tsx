import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { Replay } from "./scenes/Replay";
import { Outro } from "./scenes/Outro";
import { colors } from "./theme";
import { SCENES } from "./timings";
import { AUDIO_MANIFEST } from "./audio-manifest";

export { SCENES };

export const totalDurationInFrames = (fps: number) =>
  Math.round(
    (SCENES.hook + SCENES.problem + SCENES.replay + SCENES.outro) * fps,
  );

export const Demo: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();
  const hookF = Math.round(SCENES.hook * fps);
  const problemF = Math.round(SCENES.problem * fps);
  const replayF = Math.round(SCENES.replay * fps);
  const outroF = Math.round(SCENES.outro * fps);

  const sceneStarts: Record<keyof typeof AUDIO_MANIFEST.narration, number> = {
    hook: 0,
    problem: hookF,
    replay: hookF + problemF,
    outro: hookF + problemF + replayF,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Sequence durationInFrames={hookF}>
        <Hook />
      </Sequence>
      <Sequence from={hookF} durationInFrames={problemF}>
        <Problem />
      </Sequence>
      <Sequence from={hookF + problemF} durationInFrames={replayF}>
        <Replay durationInFrames={replayF} />
      </Sequence>
      <Sequence from={hookF + problemF + replayF} durationInFrames={outroF}>
        <Outro />
      </Sequence>

      {/* narração (gerada por generate-audio.mjs; ver audio-manifest.ts) */}
      {(
        Object.entries(AUDIO_MANIFEST.narration) as Array<
          [keyof typeof sceneStarts, string]
        >
      ).map(([scene, file]) => (
        <Sequence key={scene} from={sceneStarts[scene] + Math.round(0.25 * fps)}>
          <Audio src={staticFile(file)} />
        </Sequence>
      ))}

      {/* música de fundo: discreta, em loop, com fade de entrada e saída */}
      {AUDIO_MANIFEST.music ? (
        <Audio
          src={staticFile(AUDIO_MANIFEST.music)}
          loop
          loopVolumeCurveBehavior="extend"
          volume={(f) =>
            interpolate(
              f,
              [0, 1.2 * fps, durationInFrames - 1.8 * fps, durationInFrames],
              [0, 0.11, 0.11, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
