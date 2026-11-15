/** Question and choice text with `inline code` kept monospaced (choices are often expressions or program output). */
export function StudyText({ text }: { text: string }) {
  return <>{text.split(/(`[^`\n]+`)/g).map((part, i) => (part.length > 2 && part.startsWith("`") && part.endsWith("`") ? <code key={i} className="ac-code">{part.slice(1, -1)}</code> : part))}</>;
}

/** Flashcard text: fenced code blocks as code, everything else as text with inline code. Safe inside a button. */
export function StudyRich({ text }: { text: string }) {
  return <>{text.split(/(```[^\n]*\n[\s\S]*?```)/g).map((part, i) => {
    const fence = part.match(/^```[^\n]*\n([\s\S]*?)```$/);
    if (fence) return <code key={i} className="ac-code-block">{fence[1].replace(/\n$/, "")}</code>;
    const trimmed = part.replace(/^\n+|\n+$/g, "");
    return trimmed ? <span key={i} className="ac-rich-text"><StudyText text={trimmed} /></span> : null;
  })}</>;
}
