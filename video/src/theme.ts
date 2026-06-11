import type React from "react";

// Identidade do projeto — troque o nome/URL aqui e tudo (vídeo inteiro) acompanha.
export const TOOL_NAME = "Sparring";
export const GITHUB_LABEL = "open source · GitHub";
export const AUTHOR_LINE = "feito por Matheus · usado de verdade na 4virtue";

// Tokens do design system 4virtue (4virtue-mapa-do-negocio.html)
export const colors = {
  bg: "#faf9f7",
  card: "#ffffff",
  ink: "#16181d",
  muted: "#6b7280",
  line: "#e7e7e4",
  accent: "#1f5c45",
  accentSoft: "#e8f2ed",
  warn: "#b45309",
  warnSoft: "#fef3e2",
  // chat
  bubbleAgent: "#e8f2ed",
  bubbleLead: "#ffffff",
};

export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif';

export const monoFamily =
  '"Cascadia Code", Consolas, "SF Mono", Menlo, monospace';

// Label uppercase com letter-spacing (assinatura visual da marca)
export const labelStyle = (size: number): React.CSSProperties => ({
  fontSize: size,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: colors.accent,
  fontWeight: 600,
  fontFamily,
});
