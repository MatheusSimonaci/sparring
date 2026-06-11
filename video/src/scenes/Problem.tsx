import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fontFamily } from "../theme";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const Beat: React.FC<{
  from: number;
  to: number;
  children: React.ReactNode;
  size: number;
  color?: string;
}> = ({ from, to, children, size, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = interpolate(frame, [from, from + 0.45 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const exit = interpolate(frame, [to - 0.3 * fps, to], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(enter, exit);
  if (frame < from - 2 || frame > to + 2) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          fontSize: size,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.25,
          color: color ?? colors.ink,
          textAlign: "center",
          padding: "0 10%",
          opacity,
          transform: `translateY(${(1 - enter) * 26}px)`,
          fontFamily,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

export const Problem: React.FC = () => {
  const { fps, width, height } = useVideoConfig();
  // no vertical, escala a tipografia pra ocupar bem o quadro
  const bw = height > width ? width * 1.5 : width;
  const size = bw * 0.038;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily }}>
      <Beat from={0} to={3.4 * fps} size={size}>
        A maioria coloca o agente pra falar com cliente real{" "}
        <span style={{ color: colors.warn }}>sem nunca ter testado.</span>
      </Beat>
      <Beat from={3.5 * fps} to={6.9 * fps} size={size}>
        E descobre o erro na conversa errada,{" "}
        <span style={{ color: colors.warn }}>com o cliente errado.</span>
      </Beat>
    </AbsoluteFill>
  );
};
