import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  AUTHOR_LINE,
  colors,
  fontFamily,
  GITHUB_LABEL,
  labelStyle,
  TOOL_NAME,
} from "../theme";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // no vertical, escala a tipografia pra ocupar bem o quadro
  const bw = height > width ? width * 1.5 : width;

  const appear = (delaySec: number) =>
    interpolate(frame, [delaySec * fps, (delaySec + 0.5) * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });

  const a1 = appear(0);
  const a2 = appear(1.0);
  const a3 = appear(1.9);
  const a4 = appear(2.6);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
      }}
    >
      <div style={{ textAlign: "center", padding: "0 8%" }}>
        <h1
          style={{
            fontSize: bw * 0.046,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: colors.ink,
            lineHeight: 1.2,
            margin: 0,
            opacity: a1,
            transform: `translateY(${(1 - a1) * 24}px)`,
          }}
        >
          Teste o seu agente{" "}
          <span style={{ color: colors.accent }}>
            antes do primeiro cliente real.
          </span>
        </h1>

        <div
          style={{
            marginTop: bw * 0.03,
            fontSize: bw * 0.034,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: colors.accent,
            opacity: a2,
            transform: `translateY(${(1 - a2) * 20}px)`,
          }}
        >
          {TOOL_NAME}
        </div>

        <div
          style={{
            ...labelStyle(bw * 0.013),
            marginTop: bw * 0.012,
            opacity: a3,
          }}
        >
          {GITHUB_LABEL}
        </div>

        <div
          style={{
            marginTop: bw * 0.025,
            fontSize: bw * 0.013,
            color: colors.muted,
            opacity: a4,
          }}
        >
          {AUTHOR_LINE}
        </div>
      </div>
    </AbsoluteFill>
  );
};
