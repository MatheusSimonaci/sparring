import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { labelStyle, TOOL_NAME } from "../theme";
import { DarkBackdrop, DrawLine, easeOut, Grain, WordReveal } from "../fx";

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  // no vertical, escala a tipografia pra ocupar bem o quadro
  const bw = height > width ? width * 1.5 : width;
  const titleSize = bw * 0.055;

  const eyebrow = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  // tracking do eyebrow abre devagar (respiro premium)
  const tracking = 0.22 + eyebrow * 0.1;

  // zoom lento do bloco inteiro (cinematográfico, nunca brusco)
  const slowZoom = interpolate(frame, [0, durationInFrames], [1, 1.045]);

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 0.45 * fps, durationInFrames - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <DarkBackdrop intensity={1.25} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          transform: `scale(${slowZoom})`,
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "0 8%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              ...labelStyle(bw * 0.012),
              letterSpacing: `${tracking}em`,
              opacity: eyebrow,
            }}
          >
            {TOOL_NAME}
          </div>
          <div style={{ height: bw * 0.022 }} />
          <WordReveal
            text="Agentes de IA erram."
            startFrame={Math.round(0.25 * fps)}
            size={titleSize}
            perWord={4}
          />
          <div style={{ height: bw * 0.012 }} />
          <WordReveal
            text="A questão é: na frente de quem?"
            startFrame={Math.round(1.15 * fps)}
            size={titleSize * 0.82}
            perWord={3}
            italic
            color="#E7CFA8"
          />
          <div style={{ height: bw * 0.03 }} />
          <DrawLine startFrame={Math.round(2.1 * fps)} width={bw * 0.16} />
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};
