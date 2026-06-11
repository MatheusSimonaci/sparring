import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  AUTHOR_LINE,
  colors,
  fontFamily,
  GITHUB_LABEL,
  GITHUB_URL,
  labelStyle,
  monoFamily,
  serifFamily,
  TOOL_NAME,
} from "../theme";
import { DarkBackdrop, DrawLine, easeOut, Grain, WordReveal } from "../fx";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const bw = height > width ? width * 1.5 : width;

  const appear = (delaySec: number) =>
    interpolate(frame, [delaySec * fps, (delaySec + 0.5) * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easeOut,
    });

  const wordmark = appear(1.5);
  const a3 = appear(2.4);
  const a4 = appear(3.0);

  // o glow "respira" atrás do wordmark
  const breathe = 1 + Math.sin(frame / (1.6 * fps)) * 0.06;
  const slowZoom = interpolate(frame, [0, durationInFrames], [1, 1.035]);

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <DarkBackdrop intensity={1.3} />
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
          <WordReveal
            text="Teste o seu agente antes"
            startFrame={0}
            size={bw * 0.042}
            perWord={3}
          />
          <WordReveal
            text="do primeiro cliente real."
            startFrame={Math.round(0.5 * fps)}
            size={bw * 0.042}
            perWord={3}
            italic
            color={colors.accentBright}
          />

          <div style={{ position: "relative", marginTop: bw * 0.035 }}>
            {/* glow atrás do wordmark */}
            <div
              style={{
                position: "absolute",
                inset: `-${bw * 0.05}px -${bw * 0.12}px`,
                background:
                  "radial-gradient(50% 50% at 50% 50%, rgba(201,168,126,0.22) 0%, rgba(201,168,126,0) 70%)",
                opacity: wordmark,
                transform: `scale(${breathe})`,
              }}
            />
            <div
              style={{
                position: "relative",
                fontFamily: serifFamily,
                fontWeight: 500,
                fontSize: bw * 0.052,
                letterSpacing: "-0.02em",
                color: colors.fg,
                opacity: wordmark,
                transform: `translateY(${(1 - wordmark) * 22}px)`,
              }}
            >
              {TOOL_NAME}
            </div>
          </div>

          <div style={{ marginTop: bw * 0.02, opacity: a3 }}>
            <DrawLine startFrame={Math.round(2.4 * fps)} width={bw * 0.12} />
          </div>

          <div
            style={{
              ...labelStyle(bw * 0.012),
              marginTop: bw * 0.02,
              opacity: a3,
            }}
          >
            {GITHUB_LABEL}
          </div>
          <div
            style={{
              fontFamily: monoFamily,
              fontSize: bw * 0.014,
              color: colors.fg,
              marginTop: bw * 0.008,
              opacity: a3,
            }}
          >
            {GITHUB_URL}
          </div>

          <div
            style={{
              marginTop: bw * 0.022,
              fontSize: bw * 0.012,
              color: colors.faint,
              opacity: a4,
            }}
          >
            {AUTHOR_LINE}
          </div>
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};
