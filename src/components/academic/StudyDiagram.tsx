import { useEffect, useState, type ReactNode } from "react";
import { StudyCode } from "./StudyCode";

let mermaidReady: Promise<typeof import("mermaid").default> | undefined;
let renderCount = 0;
/** Loaded on first use: most screens never show a diagram. */
function loadMermaid(dark: boolean) {
  mermaidReady ??= import("mermaid").then((m) => m.default);
  return mermaidReady.then((mermaid) => {
    // "strict" escapes labels and drops click handlers and scripts the model might write.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "inherit" });
    return mermaid;
  });
}

/** A diagram a generated question or card draws with Mermaid; falls back to its source if it doesn't parse. */
export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const dark = document.documentElement.classList.contains("dark");
    loadMermaid(dark)
      .then((mermaid) => mermaid.render(`study-diagram-${++renderCount}`, code))
      .then(({ svg }) => live && setSvg(svg))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [code]);
  if (failed) return <code className="ac-code-block">{code}</code>;
  if (!svg) return <div className="ac-diagram is-loading" aria-label="Drawing diagram" />;
  return <div className="ac-diagram" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A drawing the model wrote as SVG. Shown as an image, so any script inside it never runs. */
export function SvgFigure({ code }: { code: string }) {
  if (!/^\s*<svg[\s>]/i.test(code) || code.length > 80_000) return <code className="ac-code-block">{code}</code>;
  return <div className="ac-diagram ac-svg"><img alt="Figure" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}`} /></div>;
}

/** Fence renderer for study content: mermaid and svg fences become pictures; code gets line numbers and colors. */
export function studyFence(language: string, code: string, complete: boolean): ReactNode {
  const lang = language.trim().toLowerCase();
  if (lang !== "mermaid" && lang !== "svg") return <StudyCode code={code} language={lang} />;
  if (!complete) return <div className="ac-diagram is-loading" aria-label="Drawing diagram" />;
  return lang === "mermaid" ? <MermaidDiagram code={code} /> : <SvgFigure code={code} />;
}
