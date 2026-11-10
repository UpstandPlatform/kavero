import type { CSSProperties, ReactNode } from "react";
import type { EditorExtension, EditorExtensionEffect } from "./types";

function intensity(parameters: Record<string, unknown>) {
  const value = parameters.intensity;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0.05, Math.min(0.8, value)) : 0.32;
}

export const auroraFill: EditorExtensionEffect = {
  id: "aurora-fill",
  name: "Aurora field",
  description: "Layer a soft, shifting-color inspired glow over a shape, image, or text block.",
  type: "shader-fill",
  defaultParameters: { intensity: 0.32 },
  render: ({ children, effect }) => (
    <div style={{ position: "relative", isolation: "isolate", width: "100%", height: "100%", overflow: "hidden" }}>
      <div style={{ position: "relative", zIndex: 0, width: "100%", height: "100%" }}>{children}</div>
      <div aria-hidden style={{
        position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: intensity(effect.parameters), mixBlendMode: "screen",
        backgroundImage: "radial-gradient(ellipse at 18% 25%, rgb(48 224 255 / 80%), transparent 46%), radial-gradient(ellipse at 80% 20%, rgb(193 82 255 / 70%), transparent 44%), radial-gradient(ellipse at 54% 88%, rgb(64 120 255 / 62%), transparent 54%)",
        backgroundSize: "140% 140%",
      }} />
    </div>
  ),
};

export const prismEffect: EditorExtensionEffect = {
  id: "prism-glow",
  name: "Prism glow",
  description: "Add a vivid spectrum glow to a selected layer.",
  type: "shader-effect",
  defaultParameters: { intensity: 0.32 },
  render: ({ children, effect }) => {
    const glow = Math.round(8 + intensity(effect.parameters) * 24);
    const style: CSSProperties = { width: "100%", height: "100%", filter: `saturate(1.25) drop-shadow(0 0 ${glow}px rgb(138 92 246 / 72%))` };
    return <div style={style}>{children}</div>;
  },
};

export const auroraFillExtension: EditorExtension = {
  manifest: {
    id: "com.kavero.aurora-fill",
    name: "Aurora fill",
    description: "Add an editable aurora-inspired color field to a selected slide element.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "kavero", name: "Kavero" },
    capabilities: ["catalog.write", "editor.render"],
    types: ["shader-fill"],
    categories: ["Creative", "Color"],
    license: "MIT",
  },
  contribute: () => ({ effects: [auroraFill] }),
};

export const prismGlowExtension: EditorExtension = {
  manifest: {
    id: "com.kavero.prism-glow",
    name: "Prism glow",
    description: "Add an editable spectrum glow to a selected slide element.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "kavero", name: "Kavero" },
    capabilities: ["catalog.write", "editor.render"],
    types: ["shader-effect"],
    categories: ["Creative", "Visual effects"],
    license: "MIT",
  },
  contribute: () => ({ effects: [prismEffect] }),
};

export function effectPreview(effectId: string): ReactNode {
  if (effectId === auroraFill.id) return <div aria-hidden className="size-full rounded-lg bg-gradient-to-br from-cyan-400 via-violet-500 to-indigo-950" />;
  return <div aria-hidden className="size-full rounded-lg bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400" />;
}
