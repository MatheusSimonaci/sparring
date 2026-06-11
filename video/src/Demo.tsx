import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { Replay } from "./scenes/Replay";
import { Outro } from "./scenes/Outro";
import { colors } from "./theme";

// duração de cada cena, em segundos
export const SCENES = {
  hook: 3.5,
  problem: 7,
  replay: 26,
  outro: 8,
};

export const totalDurationInFrames = (fps: number) =>
  Math.round((SCENES.hook + SCENES.problem + SCENES.replay + SCENES.outro) * fps);

export const Demo: React.FC = () => {
  const { fps } = useVideoConfig();
  const hookF = Math.round(SCENES.hook * fps);
  const problemF = Math.round(SCENES.problem * fps);
  const replayF = Math.round(SCENES.replay * fps);
  const outroF = Math.round(SCENES.outro * fps);

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
    </AbsoluteFill>
  );
};
