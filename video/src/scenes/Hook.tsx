import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fontFamily, labelStyle, TOOL_NAME } from "../theme";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  // no vertical, escala a tipografia pra ocupar bem o quadro
  const bw = height > width ? width * 1.5 : width;
  const titleSize = bw * 0.052;

  const line1 = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const line2 = interpolate(frame, [0.9 * fps, 1.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 0.4 * fps, durationInFrames - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
        fontFamily,
      }}
    >
      <div style={{ textAlign: "center", padding: "0 8%" }}>
        <div style={{ ...labelStyle(bw * 0.012), opacity: line1 }}>
          {TOOL_NAME}
        </div>
        <h1
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: colors.ink,
            margin: `${bw * 0.015}px 0 0`,
            opacity: line1,
            transform: `translateY(${(1 - line1) * 24}px)`,
            lineHeight: 1.15,
          }}
        >
          Agentes de IA erram.
        </h1>
        <h1
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: colors.accent,
            margin: `${bw * 0.008}px 0 0`,
            opacity: line2,
            transform: `translateY(${(1 - line2) * 24}px)`,
            lineHeight: 1.15,
          }}
        >
          A questão é: na frente de quem?
        </h1>
      </div>
    </AbsoluteFill>
  );
};
