import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  colors,
  fontFamily,
  labelStyle,
  monoFamily,
  TOOL_NAME,
} from "../theme";
import {
  events,
  leadName,
  leadRole,
  outcomeLabel,
  totalCostUsd,
  type ChatEvent,
} from "../data/demo";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

// Distribui os eventos no tempo disponível, com peso pelo tamanho do texto
// (mensagem longa fica mais tempo na tela antes da próxima entrar).
const computeStarts = (totalFrames: number) => {
  const stampFrames = Math.round(totalFrames * 0.16); // reserva pro desfecho
  const usable = totalFrames - stampFrames;
  const weights = events.map((e) => 18 + Math.sqrt(e.text.length) * 2.4);
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const starts = events.map((e, i) => {
    const start = Math.round((acc / sum) * usable);
    acc += weights[i];
    return start;
  });
  return { starts, stampStart: usable };
};

// u = escala relativa ao painel do chat (1 = painel de 880px de largura),
// pra manter a mesma legibilidade no horizontal e no vertical.
const ToolChip: React.FC<{ name: string; enter: number; u: number }> = ({
  name,
  enter,
  u,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8 * u,
      backgroundColor: colors.warnSoft,
      color: colors.warn,
      border: `1px solid ${colors.warn}33`,
      borderRadius: 999,
      padding: `${7 * u}px ${15 * u}px`,
      fontSize: 20 * u,
      fontFamily: monoFamily,
      fontWeight: 600,
      opacity: enter,
      transform: `scale(${0.85 + enter * 0.15})`,
    }}
  >
    <span
      style={{
        width: 9 * u,
        height: 9 * u,
        borderRadius: "50%",
        backgroundColor: colors.warn,
      }}
    />
    {name}
  </span>
);

const Bubble: React.FC<{
  event: ChatEvent;
  startFrame: number;
  u: number;
}> = ({ event, startFrame, u }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < startFrame) return null;

  const enter = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 16, mass: 0.6 },
    durationInFrames: Math.round(0.4 * fps),
  });

  const isAgent = event.role === "agent";
  const chipDelay = Math.round(0.22 * fps);
  const chipEnter = interpolate(
    frame,
    [startFrame + chipDelay, startFrame + chipDelay + 0.3 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease },
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isAgent ? "flex-end" : "flex-start",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 18}px) scale(${0.96 + enter * 0.04})`,
        marginTop: 17 * u,
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          backgroundColor: isAgent ? colors.bubbleAgent : colors.bubbleLead,
          border: `1px solid ${isAgent ? colors.accent + "22" : colors.line}`,
          borderRadius: 23 * u,
          borderBottomRightRadius: isAgent ? 6 * u : 23 * u,
          borderBottomLeftRadius: isAgent ? 23 * u : 6 * u,
          padding: `${15 * u}px ${21 * u}px`,
          fontSize: 26 * u,
          lineHeight: 1.45,
          color: colors.ink,
          fontFamily,
          boxShadow: "0 1px 2px rgba(22,24,29,0.05)",
          whiteSpace: "pre-wrap",
        }}
      >
        {event.text}
      </div>
      {event.tools && event.tools.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 10 * u,
            marginTop: 9 * u,
            flexWrap: "wrap",
            justifyContent: isAgent ? "flex-end" : "flex-start",
          }}
        >
          {event.tools.map((t) => (
            <ToolChip key={t} name={t} enter={chipEnter} u={u} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const Replay: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { starts, stampStart } = computeStarts(durationInFrames);

  const isVertical = height > width;
  const panelWidth = isVertical ? width * 0.92 : Math.min(width * 0.46, 880);
  const panelHeight = height * (isVertical ? 0.74 : 0.86);
  const u = panelWidth / 880;

  // contador de custo: sobe conforme as mensagens aparecem, termina no custo real
  const visibleCount = starts.filter((s) => frame >= s).length;
  const costNow =
    visibleCount === 0
      ? 0
      : totalCostUsd *
        interpolate(visibleCount, [0, events.length], [0, 1], {
          extrapolateRight: "clamp",
        });

  const panelEnter = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  const stampEnter = spring({
    frame: frame - stampStart,
    fps,
    config: { damping: 14, mass: 0.7 },
    durationInFrames: Math.round(0.5 * fps),
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
      }}
    >
      {/* legenda: lateral no horizontal, topo no vertical */}
      {!isVertical ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.06,
            top: "50%",
            transform: "translateY(-50%)",
            width: width * 0.34,
            opacity: panelEnter,
          }}
        >
          <div style={labelStyle(width * 0.011)}>cliente simulado</div>
          <h2
            style={{
              fontSize: width * 0.028,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: colors.ink,
              lineHeight: 1.25,
              margin: `${width * 0.01}px 0 0`,
            }}
          >
            O {TOOL_NAME} cria clientes que negociam de verdade com o seu
            agente.
          </h2>
          <p
            style={{
              fontSize: width * 0.0135,
              color: colors.muted,
              lineHeight: 1.55,
              marginTop: width * 0.012,
            }}
          >
            Esta conversa é real: aconteceu entre o agente da 4virtue e um
            cliente simulado, antes de qualquer lead de verdade. As etiquetas
            laranja são as ações no CRM.
          </p>
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            top: height * 0.045,
            left: "50%",
            transform: "translateX(-50%)",
            width: panelWidth,
            textAlign: "center",
            opacity: panelEnter,
          }}
        >
          <div style={labelStyle(22 * u)}>conversa real · cliente simulado</div>
        </div>
      )}

      {/* painel do chat */}
      <div
        style={{
          position: "absolute",
          right: isVertical ? (width - panelWidth) / 2 : width * 0.05,
          top: isVertical ? height * 0.095 : (height - panelHeight) / 2,
          width: panelWidth,
          height: panelHeight,
          backgroundColor: colors.card,
          border: `1px solid ${colors.line}`,
          borderRadius: 27 * u,
          boxShadow: "0 10px 40px rgba(22,24,29,0.08)",
          overflow: "hidden",
          opacity: panelEnter,
          transform: `translateY(${(1 - panelEnter) * 30}px)`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* header do chat */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${15 * u}px ${23 * u}px`,
            borderBottom: `1px solid ${colors.line}`,
            backgroundColor: colors.bg,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 13 * u }}>
            <div
              style={{
                width: 38 * u,
                height: 38 * u,
                borderRadius: "50%",
                backgroundColor: colors.accentSoft,
                color: colors.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 19 * u,
              }}
            >
              {leadName.charAt(0)}
            </div>
            <div>
              <div
                style={{
                  fontSize: 24 * u,
                  fontWeight: 700,
                  color: colors.ink,
                }}
              >
                {leadName}
              </div>
              <div style={{ fontSize: 18 * u, color: colors.muted }}>
                {leadRole}
              </div>
            </div>
          </div>
          <div
            style={{
              fontFamily: monoFamily,
              fontSize: 21 * u,
              fontWeight: 700,
              color: colors.accent,
              backgroundColor: colors.accentSoft,
              borderRadius: 999,
              padding: `${6 * u}px ${17 * u}px`,
            }}
          >
            custo: ${costNow.toFixed(4)}
          </div>
        </div>

        {/* mensagens, ancoradas no rodapé (novas empurram as antigas pra cima) */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            overflow: "hidden",
            padding: `${19 * u}px ${23 * u}px ${23 * u}px`,
          }}
        >
          {events.map((e, i) => (
            <Bubble key={i} event={e} startFrame={starts[i]} u={u} />
          ))}
        </div>
      </div>

      {/* desfecho */}
      {frame >= stampStart ? (
        <div
          style={{
            position: "absolute",
            bottom: isVertical ? height * 0.05 : height * 0.06,
            left: "50%",
            transform: `translateX(-50%) scale(${0.9 + stampEnter * 0.1})`,
            opacity: stampEnter,
            backgroundColor: colors.accent,
            color: "#fff",
            borderRadius: 999,
            padding: `${15 * u}px ${34 * u}px`,
            fontSize: 27 * u,
            fontWeight: 700,
            boxShadow: "0 10px 30px rgba(31,92,69,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {outcomeLabel} · custo real: ${totalCostUsd.toFixed(4)}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
