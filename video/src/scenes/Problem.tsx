import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fontFamily, labelStyle, monoFamily } from "../theme";
import { DarkBackdrop, easeOut, Grain } from "../fx";

// Bolha abstrata (linhas de texto simuladas — nenhuma conversa inventada).
const GhostBubble: React.FC<{
  agent?: boolean;
  broken?: boolean;
  startFrame: number;
  u: number;
  lines: number[];
}> = ({ agent = false, broken = false, startFrame, u, lines }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 15, mass: 0.6 },
    durationInFrames: Math.round(0.45 * fps),
  });
  if (frame < startFrame) return null;

  // a bolha quebrada "treme" levemente ao virar erro
  const breakAt = startFrame + Math.round(0.55 * fps);
  const isBroken = broken && frame >= breakAt;
  const shake = isBroken
    ? Math.sin((frame - breakAt) * 1.6) *
      Math.max(0, 1 - (frame - breakAt) / (0.6 * fps)) *
      4 *
      u
    : 0;

  const bg = isBroken
    ? colors.criticalTint
    : agent
      ? colors.bubbleAgent
      : colors.bubbleLead;
  const border = isBroken
    ? colors.criticalLine
    : agent
      ? colors.accentLine
      : colors.line;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: agent ? "flex-end" : "flex-start",
        marginTop: 14 * u,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 16}px) translateX(${shake}px)`,
      }}
    >
      <div
        style={{
          width: `${52 + lines.length * 6}%`,
          backgroundColor: bg,
          border: `1px solid ${border}`,
          borderRadius: 16 * u,
          borderBottomRightRadius: agent ? 5 * u : 16 * u,
          borderBottomLeftRadius: agent ? 16 * u : 5 * u,
          padding: `${14 * u}px ${16 * u}px`,
          position: "relative",
        }}
      >
        {lines.map((w, i) => (
          <div
            key={i}
            style={{
              height: 8 * u,
              width: `${w}%`,
              borderRadius: 99,
              backgroundColor: isBroken
                ? "rgba(201,138,126,0.45)"
                : agent
                  ? "rgba(201,168,126,0.4)"
                  : "rgba(244,239,230,0.16)",
              marginTop: i === 0 ? 0 : 7 * u,
            }}
          />
        ))}
        {isBroken ? (
          <div
            style={{
              position: "absolute",
              top: -12 * u,
              right: -12 * u,
              width: 30 * u,
              height: 30 * u,
              borderRadius: "50%",
              backgroundColor: colors.critical,
              color: colors.onLight,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: monoFamily,
              fontWeight: 600,
              fontSize: 17 * u,
              boxShadow: "0 0 24px rgba(201,138,126,0.7)",
            }}
          >
            !
          </div>
        ) : null}
      </div>
    </div>
  );
};

// Legenda em dois tempos, embaixo do painel.
const Caption: React.FC<{
  from: number;
  to: number;
  size: number;
  children: React.ReactNode;
}> = ({ from, to, size, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = interpolate(frame, [from, from + 0.45 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const exit = interpolate(frame, [to - 0.35 * fps, to], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(enter, exit);
  if (frame < from - 2 || frame > to + 2) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        opacity,
        transform: `translateY(${(1 - enter) * 22}px)`,
      }}
    >
      <div
        style={{
          fontSize: size,
          fontWeight: 400,
          lineHeight: 1.35,
          color: colors.fg,
          textAlign: "center",
          padding: "0 8%",
          fontFamily,
          letterSpacing: "-0.01em",
          textWrap: "balance" as never,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const isVertical = height > width;
  const bw = isVertical ? width * 1.5 : width;
  const capSize = bw * 0.032;

  // painel de chat fantasma, inclinado (motivo do painel flutuante da marca)
  const panelW = isVertical ? width * 0.78 : width * 0.34;
  const u = panelW / 560;
  const panelEnter = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const driftY = Math.sin(frame / (2.4 * fps)) * 10;
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 0.45 * fps, durationInFrames - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const half = Math.round(durationInFrames / 2);

  return (
    <AbsoluteFill style={{ opacity: fadeOut, fontFamily }}>
      <DarkBackdrop />

      {/* painel flutuante com a conversa "fantasma" que dá errado */}
      <div
        style={{
          position: "absolute",
          top: isVertical ? height * 0.1 : "50%",
          left: isVertical ? "50%" : undefined,
          right: isVertical ? undefined : width * 0.08,
          transform: isVertical
            ? `translateX(-50%) translateY(${driftY}px)`
            : `translateY(-50%) translateY(${driftY}px) perspective(1600px) rotateY(-8deg)`,
          width: panelW,
          opacity: panelEnter,
        }}
      >
        <div
          style={{
            backgroundColor: colors.surface1,
            border: `1px solid ${colors.lineStrong}`,
            borderRadius: 22 * u,
            padding: `${20 * u}px ${20 * u}px ${24 * u}px`,
            boxShadow:
              "0 30px 80px rgba(0,0,0,0.65), 0 0 90px rgba(201,168,126,0.08)",
            position: "relative",
          }}
        >
          {/* nó de conexão da marca */}
          <div
            style={{
              position: "absolute",
              top: -5 * u,
              left: 34 * u,
              width: 10 * u,
              height: 10 * u,
              borderRadius: "50%",
              backgroundColor: colors.accentBright,
              boxShadow: "0 0 16px rgba(231,207,168,0.9)",
            }}
          />
          <div style={{ ...labelStyle(15 * u), marginBottom: 6 * u }}>
            cliente real · sem teste
          </div>
          <GhostBubble startFrame={Math.round(0.5 * fps)} u={u} lines={[88, 64]} />
          <GhostBubble
            agent
            startFrame={Math.round(1.2 * fps)}
            u={u}
            lines={[80, 92, 46]}
          />
          <GhostBubble startFrame={Math.round(2.1 * fps)} u={u} lines={[58]} />
          <GhostBubble
            agent
            broken
            startFrame={Math.round(2.9 * fps)}
            u={u}
            lines={[90, 74, 82]}
          />
        </div>
      </div>

      {/* legendas: lateral no horizontal, abaixo do painel no vertical */}
      <div
        style={{
          position: "absolute",
          inset: isVertical
            ? `${height * 0.52}px 0 0 0`
            : `0 ${width * 0.48}px 0 0`,
        }}
      >
        <Caption from={Math.round(0.3 * fps)} to={half} size={capSize}>
          A maioria coloca o agente pra falar com cliente real{" "}
          <span style={{ color: colors.critical }}>sem nunca ter testado.</span>
        </Caption>
        <Caption
          from={half + Math.round(0.15 * fps)}
          to={durationInFrames - Math.round(0.2 * fps)}
          size={capSize}
        >
          E descobre o erro na conversa errada,{" "}
          <span style={{ color: colors.critical }}>com o cliente errado.</span>
        </Caption>
      </div>

      <Grain />
    </AbsoluteFill>
  );
};
