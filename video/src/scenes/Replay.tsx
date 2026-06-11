import React from "react";
import {
  AbsoluteFill,
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
  serifFamily,
  TOOL_NAME,
} from "../theme";
import { DarkBackdrop, easeOut, Grain } from "../fx";
import {
  events,
  leadName,
  leadRole,
  outcomeLabel,
  totalCostUsd,
  type ChatEvent,
} from "../data/demo";

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
      backgroundColor: "rgba(201,168,126,0.06)",
      color: colors.accent,
      border: `1px solid ${colors.accentLine}`,
      borderRadius: 999,
      padding: `${6 * u}px ${14 * u}px`,
      fontSize: 18 * u,
      fontFamily: monoFamily,
      fontWeight: 500,
      opacity: enter,
      transform: `scale(${0.85 + enter * 0.15})`,
    }}
  >
    <span
      style={{
        width: 8 * u,
        height: 8 * u,
        borderRadius: "50%",
        backgroundColor: colors.accent,
        boxShadow: "0 0 10px rgba(201,168,126,0.9)",
      }}
    />
    {name}
  </span>
);

// "digitando…" — aparece LOGO ABAIXO da última mensagem, no lado de quem
// vai responder, durante a pausa antes da próxima mensagem entrar.
const TypingDots: React.FC<{ agent: boolean; u: number; enter: number }> = ({
  agent,
  u,
  enter,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        display: "flex",
        justifyContent: agent ? "flex-end" : "flex-start",
        marginTop: 14 * u,
        opacity: enter,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 7 * u,
          alignItems: "center",
          backgroundColor: agent ? colors.bubbleAgent : colors.bubbleLead,
          border: `1px solid ${agent ? colors.accentLine : colors.line}`,
          borderRadius: 18 * u,
          borderBottomRightRadius: agent ? 5 * u : 18 * u,
          borderBottomLeftRadius: agent ? 18 * u : 5 * u,
          padding: `${13 * u}px ${17 * u}px`,
        }}
      >
        {[0, 1, 2].map((i) => {
          const pulse =
            0.25 +
            0.75 *
              Math.max(
                0,
                Math.sin(((frame / fps) * 2.6 - i * 0.28) * Math.PI),
              );
          return (
            <span
              key={i}
              style={{
                width: 8 * u,
                height: 8 * u,
                borderRadius: "50%",
                backgroundColor: agent ? colors.accent : colors.faint,
                opacity: pulse,
                transform: `translateY(${-(pulse - 0.25) * 4 * u}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

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
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut },
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
          border: `1px solid ${isAgent ? colors.accentLine : colors.line}`,
          borderRadius: 21 * u,
          borderBottomRightRadius: isAgent ? 6 * u : 21 * u,
          borderBottomLeftRadius: isAgent ? 21 * u : 6 * u,
          padding: `${15 * u}px ${21 * u}px`,
          fontSize: 26 * u,
          lineHeight: 1.45,
          color: isAgent ? colors.fg : colors.muted,
          fontFamily,
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

  // próxima mensagem a entrar → mostra "digitando…" na janela anterior a ela
  const nextIdx = starts.findIndex((s) => frame < s);
  const typingWindow = Math.round(0.55 * fps);
  const showTyping =
    nextIdx >= 0 && frame >= starts[nextIdx] - typingWindow && frame >= 6;
  const typingEnter = showTyping
    ? interpolate(
        frame,
        [starts[nextIdx] - typingWindow, starts[nextIdx] - typingWindow + 5],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;

  const panelEnter = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  const stampEnter = spring({
    frame: frame - stampStart,
    fps,
    config: { damping: 14, mass: 0.7 },
    durationInFrames: Math.round(0.5 * fps),
  });

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <DarkBackdrop />

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
          <div style={labelStyle(width * 0.0105)}>o treinamento, ao vivo</div>
          <h2
            style={{
              fontSize: width * 0.027,
              fontWeight: 500,
              fontFamily: serifFamily,
              letterSpacing: "-0.02em",
              color: colors.fg,
              lineHeight: 1.18,
              margin: `${width * 0.012}px 0 0`,
            }}
          >
            O {TOOL_NAME} cria clientes que negociam de verdade.
          </h2>
          <p
            style={{
              fontSize: width * 0.0125,
              color: colors.muted,
              lineHeight: 1.55,
              marginTop: width * 0.012,
              maxWidth: "30ch",
            }}
          >
            Conversa real, sem edição. As etiquetas douradas são as ações do
            agente no CRM simulado.
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
          backgroundColor: colors.surface1,
          border: `1px solid ${colors.lineStrong}`,
          borderRadius: 27 * u,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.65), 0 0 90px rgba(201,168,126,0.10)",
          overflow: "hidden",
          opacity: panelEnter,
          transform: `translateY(${(1 - panelEnter) * 30}px)`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* nó de conexão da marca */}
        <div
          style={{
            position: "absolute",
            top: -5 * u,
            left: 38 * u,
            width: 10 * u,
            height: 10 * u,
            borderRadius: "50%",
            backgroundColor: colors.accentBright,
            boxShadow: "0 0 16px rgba(231,207,168,0.9)",
            zIndex: 2,
          }}
        />
        {/* header do chat */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${15 * u}px ${23 * u}px`,
            borderBottom: `1px solid ${colors.line}`,
            backgroundColor: colors.surface2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 13 * u }}>
            <div
              style={{
                width: 38 * u,
                height: 38 * u,
                borderRadius: "50%",
                backgroundColor: colors.accentTint,
                border: `1px solid ${colors.accentLine}`,
                color: colors.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 500,
                fontSize: 20 * u,
                fontFamily: serifFamily,
              }}
            >
              {leadName.charAt(0)}
            </div>
            <div>
              <div
                style={{
                  fontSize: 24 * u,
                  fontWeight: 500,
                  color: colors.fg,
                }}
              >
                {leadName}
              </div>
              <div style={{ fontSize: 18 * u, color: colors.faint }}>
                {leadRole}
              </div>
            </div>
          </div>
          <div
            style={{
              fontFamily: monoFamily,
              fontSize: 20 * u,
              fontWeight: 500,
              color: colors.accent,
              backgroundColor: colors.accentTint,
              border: `1px solid ${colors.accentLine}`,
              borderRadius: 999,
              padding: `${6 * u}px ${17 * u}px`,
              fontVariantNumeric: "tabular-nums",
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
          {showTyping && nextIdx >= 0 ? (
            <TypingDots
              agent={events[nextIdx].role === "agent"}
              u={u}
              enter={typingEnter}
            />
          ) : null}
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
            color: colors.onLight,
            borderRadius: 999,
            padding: `${15 * u}px ${34 * u}px`,
            fontSize: 26 * u,
            fontWeight: 600,
            fontFamily: monoFamily,
            boxShadow: "0 0 60px rgba(201,168,126,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {outcomeLabel} · custo real: ${totalCostUsd.toFixed(4)}
        </div>
      ) : null}

      <Grain />
    </AbsoluteFill>
  );
};
