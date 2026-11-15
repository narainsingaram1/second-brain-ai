import { studyFence } from "./StudyDiagram";

/** Inline study text: `code` stays monospaced and **bold** stays bold (choices are often expressions or output). */
export function StudyText({ text }: { text: string }) {
  return <>{text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={i} className="ac-code">{part.slice(1, -1)}</code>;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  })}</>;
}

/**
 * Prompts, answers, explanations and flashcards: fenced blocks become code (or diagrams), the rest is text with
 * inline code. Uses only spans and figures, so it can sit inside a flashcard button.
 */
export function StudyRich({ text }: { text: string }) {
  return <>{text.split(/(```[^\n]*\n[\s\S]*?```)/g).map((part, i) => {
    const fence = part.match(/^```([^\n]*)\n([\s\S]*?)```$/);
    if (fence) return <span key={i} className="ac-rich-block">{studyFence(fence[1], fence[2].replace(/\n$/, ""), true)}</span>;
    const trimmed = part.replace(/^\n+|\n+$/g, "");
    return trimmed ? <span key={i} className="ac-rich-text"><StudyText text={trimmed} /></span> : null;
  })}</>;
}
