import type React from "react";
import { loadFont as loadNewsreader } from "@remotion/google-fonts/Newsreader";
import { loadFont as loadOutfit } from "@remotion/google-fonts/Outfit";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

// Identidade do projeto — troque o nome/URL aqui e tudo (vídeo inteiro) acompanha.
export const TOOL_NAME = "Sparring";
export const GITHUB_LABEL = "open source";
export const GITHUB_URL = "github.com/MatheusSimonaci/sparring";
export const AUTHOR_LINE = "feito por Matheus · usado de verdade na 4virtue";

// Fontes do design system (bloqueiam o render até carregar)
const newsreader = loadNewsreader("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin", "latin-ext"],
});
const newsreaderItalic = loadNewsreader("italic", {
  weights: ["400", "500"],
  subsets: ["latin", "latin-ext"],
});
const outfit = loadOutfit("normal", {
  weights: ["300", "400", "500", "600"],
  subsets: ["latin", "latin-ext"],
});
const jetbrains = loadJetBrainsMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin", "latin-ext"],
});

export const serifFamily = newsreader.fontFamily; // títulos
export const serifItalicFamily = newsreaderItalic.fontFamily;
export const fontFamily = outfit.fontFamily; // corpo / UI
export const monoFamily = jetbrains.fontFamily; // labels técnicos

// Tokens do design system 4virtue (design-system/colors_and_type.css)
export const colors = {
  bg: "#060605",
  bgDeep: "#000000",
  bgRaised: "#100F0D",
  surface1: "#15140F",
  surface2: "#1C1A14",
  surface3: "#262219",
  line: "rgba(244,239,230,0.08)",
  lineStrong: "rgba(244,239,230,0.16)",
  fg: "#F4EFE6",
  fgStrong: "#FFFFFF",
  muted: "#A39C8F",
  faint: "#6E685D",
  ghost: "#443F38",
  onLight: "#1A140C",
  accent: "#C9A87E",
  accentBright: "#E7CFA8",
  accentDeep: "#8C7150",
  accentTint: "rgba(201,168,126,0.12)",
  accentLine: "rgba(201,168,126,0.34)",
  critical: "#C98A7E",
  criticalTint: "rgba(201,138,126,0.14)",
  criticalLine: "rgba(201,138,126,0.38)",
  // chat
  bubbleAgent: "rgba(201,168,126,0.12)",
  bubbleLead: "#1C1A14",
};

// Eyebrow mono uppercase com letter-spacing (assinatura visual da marca)
export const labelStyle = (size: number): React.CSSProperties => ({
  fontSize: size,
  letterSpacing: "0.22em",
  textTransform: "uppercase" as const,
  color: colors.accent,
  fontWeight: 500,
  fontFamily: monoFamily,
});
