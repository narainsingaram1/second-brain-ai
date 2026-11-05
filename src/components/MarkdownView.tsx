import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

interface MarkdownViewProps {
  content: string;
  renderReference?: (type: string, id: string, before: string) => React.ReactNode;
  className?: string;
  onToggleCheckbox?: (lineIndex: number, newChecked: boolean) => void;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  className = "",
  onToggleCheckbox,
  renderReference,
}) => {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);

  const handleCopyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedBlock(idx);
    setTimeout(() => setCopiedBlock(null), 2000);
  };

  const renderInline = (text: string): React.ReactNode[] => {
    // Regex matching bold, italic, strikethrough, inline code, and links
    const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\[(task|goal|habit|journal|knowledge|event|tracker):([^\]\n]+)\])/g;
    const elements: React.ReactNode[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        elements.push(text.slice(lastIdx, match.index));
      }

      if (match[2]) {
        // Bold: **text**
        elements.push(
          <strong key={match.index} className="font-extrabold text-ink">
            {match[2]}
          </strong>
        );
      } else if (match[3]) {
        // Italic: *text*
        elements.push(
          <em key={match.index} className="italic text-slate-800 dark:text-slate-200">
            {match[3]}
          </em>
        );
      } else if (match[4]) {
        // Strikethrough: ~~text~~
        elements.push(
          <del key={match.index} className="line-through text-slate-400 dark:text-slate-500">
            {match[4]}
          </del>
        );
      } else if (match[5]) {
        // Inline code: `text`
        elements.push(
          <code
            key={match.index}
            className="px-1.5 py-0.5 rounded-md bg-raised text-rose-600 dark:text-rose-400 font-mono text-[11px] font-semibold"
          >
            {match[5]}
          </code>
        );
      } else if (match[6] && match[7]) {
        // Link: [text](url)
        elements.push(
          <a
            key={match.index}
            href={/^(https?:|mailto:|\/(?!\/)|#)/i.test(match[7].trim()) ? match[7].trim() : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            {match[6]}
          </a>
        );
      }

      if (match[8] && match[9]) {
        elements.push(<React.Fragment key={match.index}>{renderReference ? renderReference(match[8], match[9], text.slice(0, match.index)) : match[0]}</React.Fragment>);
      }

      lastIdx = regex.lastIndex;
    }

    if (lastIdx < text.length) {
      elements.push(text.slice(lastIdx));
    }

    return elements;
  };

  const lines = content.split("\n");
  const renderedElements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockLines: string[] = [];
  let codeBlockStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block open/close
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        // Close code block
        const fullCode = codeBlockLines.join("\n");
        const blockId = codeBlockStartIdx;
        renderedElements.push(
          <div
            key={`code-${blockId}`}
            className="relative my-4 rounded-2xl bg-slate-900 border border-slate-800 dark:border-slate-800 shadow-md overflow-hidden text-xs"
          >
            <div className="flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800/80 text-[11px] text-slate-400 font-mono">
              <span>{codeBlockLanguage || "code"}</span>
              <button
                type="button"
                onClick={() => handleCopyCode(fullCode, blockId)}
                className="flex items-center gap-1 hover:text-white transition-colors"
              >
                {copiedBlock === blockId ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 text-slate-200 overflow-x-auto font-mono text-[11px] leading-relaxed">
              <code>{fullCode}</code>
            </pre>
          </div>
        );
        inCodeBlock = false;
        codeBlockLanguage = "";
        codeBlockLines = [];
      } else {
        // Open code block
        inCodeBlock = true;
        codeBlockLanguage = line.trim().slice(3).trim();
        codeBlockLines = [];
        codeBlockStartIdx = i;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Tables stay readable for task schedules and goal comparisons.
    if (line.includes("|") && lines[i + 1]?.includes("|")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
      const headers = cells(line);
      const separators = cells(lines[i + 1]);
      if (headers.length === separators.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
        const rows: string[][] = [];
        let end = i + 2;
        while (end < lines.length && lines[end].trim() && lines[end].includes("|")) { rows.push(cells(lines[end])); end++; }
        const alignment = (index: number) => separators[index].startsWith(":") && separators[index].endsWith(":") ? "center" as const : separators[index].endsWith(":") ? "right" as const : "left" as const;
        renderedElements.push(<div key={`table-${i}`} className="chat-table-container"><table className="chat-table"><thead><tr>{headers.map((header, index) => <th key={index} style={{ textAlign: alignment(index) }}>{renderInline(header)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, index) => <td key={index} style={{ textAlign: alignment(index) }}>{renderInline(row[index] || "")}</td>)}</tr>)}</tbody></table></div>);
        i = end - 1;
        continue;
      }
    }

    // Empty line
    if (!trimmed) {
      renderedElements.push(<div key={`empty-${i}`} className="h-2.5" />);
      continue;
    }

    // Horizontal Rule
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      renderedElements.push(
        <hr key={`hr-${i}`} className="my-6 border-line" />
      );
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      renderedElements.push(
        <h1
          key={`h1-${i}`}
          className="text-2xl font-black text-ink mt-6 mb-3 tracking-tight"
        >
          {renderInline(line.slice(2))}
        </h1>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      renderedElements.push(
        <h2
          key={`h2-${i}`}
          className="text-xl font-extrabold text-ink mt-5 mb-2.5 tracking-tight"
        >
          {renderInline(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith("### ")) {
      renderedElements.push(
        <h3
          key={`h3-${i}`}
          className="text-base font-bold text-slate-800 dark:text-slate-100 mt-4 mb-2 tracking-tight"
        >
          {renderInline(line.slice(4))}
        </h3>
      );
      continue;
    }
    if (line.startsWith("#### ")) {
      renderedElements.push(
        <h4
          key={`h4-${i}`}
          className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1.5"
        >
          {renderInline(line.slice(5))}
        </h4>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      renderedElements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-4 border-blue-500 pl-4 py-2 my-3 text-slate-700 dark:text-slate-300 italic bg-blue-50/50 dark:bg-blue-950/20 rounded-r-2xl font-medium"
        >
          {renderInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Task Checklist: - [ ] or - [x]
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      const isChecked = taskMatch[2].toLowerCase() === "x";
      const taskText = taskMatch[3];
      const lineNum = i;

      renderedElements.push(
        <div
          key={`task-${i}`}
          className="flex items-start gap-2.5 my-1.5 group select-none cursor-pointer"
          onClick={() => {
            if (onToggleCheckbox) {
              onToggleCheckbox(lineNum, !isChecked);
            }
          }}
        >
          <div
            className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center transition-colors shrink-0 ${
              isChecked
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 group-hover:border-blue-500"
            }`}
          >
            {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
          </div>
          <span
            className={`text-xs leading-relaxed transition-all ${
              isChecked
                ? "line-through text-slate-400 dark:text-slate-500"
                : "text-slate-800 dark:text-slate-200"
            }`}
          >
            {renderInline(taskText)}
          </span>
        </div>
      );
      continue;
    }

    // Bullet list: - or *
    if (line.match(/^(\s*)[-*]\s+(.*)$/)) {
      const listMatch = line.match(/^(\s*)[-*]\s+(.*)$/)!;
      renderedElements.push(
        <div key={`bullet-${i}`} className="flex items-start gap-2 my-1 text-xs">
          <span className="text-blue-500 font-bold select-none">•</span>
          <span className="text-slate-800 dark:text-slate-200 leading-relaxed">
            {renderInline(listMatch[2])}
          </span>
        </div>
      );
      continue;
    }

    // Numbered list: 1. 2.
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numMatch) {
      renderedElements.push(
        <div key={`num-${i}`} className="flex items-start gap-2 my-1 text-xs">
          <span className="text-slate-400 dark:text-slate-500 font-mono font-bold select-none min-w-[1.2rem]">
            {numMatch[2]}.
          </span>
          <span className="text-slate-800 dark:text-slate-200 leading-relaxed">
            {renderInline(numMatch[3])}
          </span>
        </div>
      );
      continue;
    }

    // Standard paragraph
    renderedElements.push(
      <p
        key={`p-${i}`}
        className="my-2 text-xs sm:text-[13px] leading-relaxed text-slate-800 dark:text-slate-200"
      >
        {renderInline(line)}
      </p>
    );
  }

  // Handle unclosed code block if file ends inside code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    const fullCode = codeBlockLines.join("\n");
    renderedElements.push(
      <div
        key={`code-unclosed`}
        className="relative my-4 rounded-2xl bg-slate-900 border border-slate-800 p-4 font-mono text-xs text-slate-200 overflow-x-auto"
      >
        <pre>
          <code>{fullCode}</code>
        </pre>
      </div>
    );
  }

  return <div className={`prose-container space-y-1 ${className}`}>{renderedElements}</div>;
};
