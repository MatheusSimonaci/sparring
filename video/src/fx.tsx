import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, serifFamily, serifItalicFamily } from "./theme";

export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

// Fundo cinematográfico da marca: near-black + glows champanhe à deriva + vinheta.
export const DarkBackdrop: React.FC<{ intensity?: number }> = ({
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const d = Math.max(width, height);

  const g1x = Math.sin(t * 0.21) * d * 0.05;
  const g1y = Math.cos(t * 0.17) * d * 0.04;
  const g2x = Math.cos(t * 0.13) * d * 0.06;
  const g2y = Math.sin(t * 0.19) * d * 0.05;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: d * 0.95,
          height: d * 0.95,
          left: -d * 0.25,
          top: -d * 0.35,
          borderRadius: "50%",
          background: `radial-gradient(50% 50% at 50% 50%, rgba(201,168,126,${
            0.13 * intensity
          }) 0%, rgba(201,168,126,0) 70%)`,
          transform: `translate(${g1x}px, ${g1y}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: d * 0.8,
          height: d * 0.8,
          right: -d * 0.3,
          bottom: -d * 0.3,
          borderRadius: "50%",
          background: `radial-gradient(50% 50% at 50% 50%, rgba(201,168,126,${
            0.09 * intensity
          }) 0%, rgba(201,168,126,0) 70%)`,
          transform: `translate(${g2x}px, ${g2y}px)`,
        }}
      />
      {/* vinheta */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 120% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// Grão de filme sutil (textura viva — desloca a cada frame).
const NOISE_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E";

export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url("${NOISE_URI}")`,
        backgroundPosition: `${(frame * 37) % 240}px ${(frame * 53) % 240}px`,
        opacity: 0.05,
        pointerEvents: "none",
      }}
    />
  );
};

// Título serif com reveal palavra a palavra (stagger).
export const WordReveal: React.FC<{
  text: string;
  startFrame: number;
  size: number;
  color?: string;
  italic?: boolean;
  perWord?: number; // frames de atraso entre palavras
  align?: "center" | "left";
}> = ({
  text,
  startFrame,
  size,
  color = colors.fg,
  italic = false,
  perWord = 4,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <div
      style={{
        fontFamily: italic ? serifItalicFamily : serifFamily,
        fontStyle: italic ? "italic" : "normal",
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.1,
        letterSpacing: "-0.02em",
        color,
        textAlign: align,
      }}
    >
      {words.map((w, i) => {
        const from = startFrame + i * perWord;
        const p = interpolate(frame, [from, from + 0.5 * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeOut,
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p,
              transform: `translateY(${(1 - p) * size * 0.35}px)`,
              whiteSpace: "pre",
            }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};

// Linha de destaque que se desenha (stroke draw horizontal).
export const DrawLine: React.FC<{
  startFrame: number;
  width: number;
  thickness?: number;
}> = ({ startFrame, width, thickness = 2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [startFrame, startFrame + 0.7 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  return (
    <div
      style={{
        width: width * p,
        height: thickness,
        background: `linear-gradient(90deg, ${colors.accent}, rgba(201,168,126,0))`,
        boxShadow: "0 0 18px rgba(201,168,126,0.5)",
      }}
    />
  );
};
