import React, { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { REFERENCE_TYPES } from "../utils/chatPresentation";
import { LINKABLE_TYPES, resolveWikiTarget, type LinkTargetType } from "../utils/noteLinks";
import type { BrainState } from "../types";

interface MarkdownViewProps {
  content: string;
  renderReference?: (type: string, id: string, before: string) => React.ReactNode;
  brainState?: BrainState | null;
  onNavigateRecord?: (type: LinkTargetType, id: string | null, label: string) => void;
  className?: string;
  onToggleCheckbox?: (lineIndex: number, newChecked: boolean) => void;
  /** Custom rendering for a fenced block. Return undefined to show it as code. `block` is its order among all fences. */
  renderFence?: (language: string, code: string, complete: boolean, block: number) => React.ReactNode | undefined;
}

type InlineToken =
  | { kind: "text"; value: string; index: number }
  | { kind: "bold"; value: string; index: number }
  | { kind: "italic"; value: string; index: number }
  | { kind: "strike"; value: string; index: number }
  | { kind: "code"; value: string; index: number }
  | { kind: "link"; label: string; href: string | undefined; index: number }
  | { kind: "recordLink"; targetType: LinkTargetType; targetId: string | null; label: string; syntax: "wiki" | "mention"; index: number }
  | { kind: "ref"; type: string; id: string; before: string; raw: string; index: number };

type MarkdownBlock =
  | { kind: "code"; key: string; blockId: number; language: string; code: string; complete: boolean; fenceIndex: number }
  | { kind: "table"; key: string; headers: InlineToken[][]; rows: InlineToken[][][]; alignments: Array<"left" | "center" | "right"> }
  | { kind: "empty"; key: string }
  | { kind: "hr"; key: string }
  | { kind: "heading"; key: string; level: 1 | 2 | 3 | 4; tokens: InlineToken[] }
  | { kind: "quote"; key: string; tokens: InlineToken[] }
  | { kind: "task"; key: string; lineNum: number; checked: boolean; tokens: InlineToken[] }
  | { kind: "bullet"; key: string; tokens: InlineToken[] }
  | { kind: "numbered"; key: string; number: string; tokens: InlineToken[] }
  | { kind: "paragraph"; key: string; tokens: InlineToken[] };

const INLINE_REGEX = new RegExp(
  `(\\*\\*([^*]+)\\*\\*|\\*([^*]+)\\*|~~([^~]+)~~|\`([^\`]+)\`|@\\[([^\\]\\n]+)\\]\\(synapse:\\/\\/(${LINKABLE_TYPES.join("|")})\\/([^\\s)]+)\\)|\\[\\[([^\\[\\]\\n]+?)\\]\\]|\\[([^\\]]+)\\]\\(([^)]+)\\)|\\[(${REFERENCE_TYPES.join("|")}):([^\\]\\n]+)\\])`,
  "g",
);

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  INLINE_REGEX.lastIndex = 0;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ kind: "text", value: text.slice(lastIdx, match.index), index: lastIdx });
    }
    if (match[2]) {
      tokens.push({ kind: "bold", value: match[2], index: match.index });
    } else if (match[3]) {
      tokens.push({ kind: "italic", value: match[3], index: match.index });
    } else if (match[4]) {
      tokens.push({ kind: "strike", value: match[4], index: match.index });
    } else if (match[5]) {
      tokens.push({ kind: "code", value: match[5], index: match.index });
    } else if (match[6] && match[7] && match[8]) {
      tokens.push({
        kind: "recordLink",
        targetType: match[7] as LinkTargetType,
        targetId: match[8].trim(),
        label: match[6].trim(),
        syntax: "mention",
        index: match.index,
      });
    } else if (match[9]) {
      const inner = match[9].trim();
      const typed = /^([a-z]+):([^|\s]+)\|(.+)$/.exec(inner);
      if (typed && (LINKABLE_TYPES as readonly string[]).includes(typed[1])) {
        tokens.push({
          kind: "recordLink",
          targetType: typed[1] as LinkTargetType,
          targetId: typed[2].trim(),
          label: typed[3].trim(),
          syntax: "wiki",
          index: match.index,
        });
      } else {
        tokens.push({
          kind: "recordLink",
          targetType: "knowledge",
          targetId: null,
          label: inner,
          syntax: "wiki",
          index: match.index,
        });
      }
    } else if (match[10] && match[11]) {
      const trimmed = match[11].trim();
      tokens.push({
        kind: "link",
        label: match[10],
        href: /^(https?:|mailto:|\/(?!\/)|#)/i.test(trimmed) ? trimmed : undefined,
        index: match.index,
      });
    }
    if (match[12] && match[13]) {
      tokens.push({
        kind: "ref",
        type: match[12],
        id: match[13],
        before: text.slice(0, match.index),
        raw: match[0],
        index: match.index,
      });
    }
    lastIdx = INLINE_REGEX.lastIndex;
  }

  if (lastIdx < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIdx), index: lastIdx });
  }
  return tokens;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split("\n");
  const blocks: MarkdownBlock[] = [];

  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockLines: string[] = [];
  let codeBlockStartIdx = 0;
  let fenceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        blocks.push({
          kind: "code",
          key: `code-${codeBlockStartIdx}`,
          blockId: codeBlockStartIdx,
          language: codeBlockLanguage,
          code: codeBlockLines.join("\n"),
          complete: true,
          fenceIndex: fenceCount++,
        });
        inCodeBlock = false;
        codeBlockLanguage = "";
        codeBlockLines = [];
      } else {
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

    if (line.includes("|") && lines[i + 1]?.includes("|")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
      const headers = cells(line);
      const separators = cells(lines[i + 1]);
      if (headers.length === separators.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
        const rows: string[][] = [];
        let end = i + 2;
        while (end < lines.length && lines[end].trim() && lines[end].includes("|")) { rows.push(cells(lines[end])); end++; }
        const alignments = separators.map(sep => (sep.startsWith(":") && sep.endsWith(":") ? "center" : sep.endsWith(":") ? "right" : "left") as "left" | "center" | "right");
        blocks.push({
          kind: "table",
          key: `table-${i}`,
          headers: headers.map(tokenizeInline),
          rows: rows.map(row => headers.map((_, index) => tokenizeInline(row[index] || ""))),
          alignments,
        });
        i = end - 1;
        continue;
      }
    }

    if (!trimmed) { blocks.push({ kind: "empty", key: `empty-${i}` }); continue; }
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") { blocks.push({ kind: "hr", key: `hr-${i}` }); continue; }
    if (line.startsWith("# ")) { blocks.push({ kind: "heading", key: `h1-${i}`, level: 1, tokens: tokenizeInline(line.slice(2)) }); continue; }
    if (line.startsWith("## ")) { blocks.push({ kind: "heading", key: `h2-${i}`, level: 2, tokens: tokenizeInline(line.slice(3)) }); continue; }
    if (line.startsWith("### ")) { blocks.push({ kind: "heading", key: `h3-${i}`, level: 3, tokens: tokenizeInline(line.slice(4)) }); continue; }
    if (line.startsWith("#### ")) { blocks.push({ kind: "heading", key: `h4-${i}`, level: 4, tokens: tokenizeInline(line.slice(5)) }); continue; }
    if (line.startsWith("> ")) { blocks.push({ kind: "quote", key: `quote-${i}`, tokens: tokenizeInline(line.slice(2)) }); continue; }

    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      blocks.push({ kind: "task", key: `task-${i}`, lineNum: i, checked: taskMatch[2].toLowerCase() === "x", tokens: tokenizeInline(taskMatch[3]) });
      continue;
    }

    const listMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (listMatch) {
      blocks.push({ kind: "bullet", key: `bullet-${i}`, tokens: tokenizeInline(listMatch[2]) });
      continue;
    }

    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numMatch) {
      blocks.push({ kind: "numbered", key: `num-${i}`, number: numMatch[2], tokens: tokenizeInline(numMatch[3]) });
      continue;
    }

    blocks.push({ kind: "paragraph", key: `p-${i}`, tokens: tokenizeInline(line) });
  }

  if (inCodeBlock) {
    blocks.push({
      kind: "code",
      key: `code-${codeBlockStartIdx}`,
      blockId: codeBlockStartIdx,
      language: codeBlockLanguage,
      code: codeBlockLines.join("\n"),
      complete: false,
      fenceIndex: fenceCount,
    });
  }

  return blocks;
}

const MarkdownViewInner: React.FC<MarkdownViewProps> = ({
  content,
  className = "",
  onToggleCheckbox,
  renderReference,
  brainState,
  onNavigateRecord,
  renderFence,
}) => {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  const handleCopyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedBlock(idx);
    setTimeout(() => setCopiedBlock(null), 2000);
  };

  const renderInline = (tokens: InlineToken[]): React.ReactNode[] =>
    tokens.map((tok, i) => {
      switch (tok.kind) {
        case "text": return tok.value;
        case "bold": return <strong key={tok.index} className="font-extrabold text-ink">{tok.value}</strong>;
        case "italic": return <em key={tok.index} className="italic text-slate-800 dark:text-slate-200">{tok.value}</em>;
        case "strike": return <del key={tok.index} className="line-through text-slate-400 dark:text-slate-500">{tok.value}</del>;
        case "code": return (
          <code key={tok.index} className="px-1.5 py-0.5 rounded-md bg-raised text-rose-600 dark:text-rose-400 font-mono text-[11px] font-semibold">
            {tok.value}
          </code>
        );
        case "link": return (
          <a key={tok.index} href={tok.href} target="_blank" rel="noopener noreferrer" className="text-muted dark:text-slate-400 underline underline-offset-2 hover:opacity-80 transition-opacity">
            {tok.label}
          </a>
        );
        case "recordLink": {
          const resolved = tok.targetId
            ? { type: tok.targetType, id: tok.targetId, label: tok.label }
            : resolveWikiTarget(tok.label, brainState);
          return (
            <button
              key={`${tok.index}-${i}`}
              type="button"
              onClick={() => onNavigateRecord?.(resolved.type, resolved.id, resolved.label)}
              className={`nx-record-pill nx-pill-${resolved.type}`}
              title={`Open ${resolved.type === "knowledge" ? "note" : resolved.type}: ${resolved.label}`}
            >
              {resolved.label}
            </button>
          );
        }
        case "ref": return (
          <React.Fragment key={`${tok.index}-${i}`}>
            {renderReference ? renderReference(tok.type, tok.id, tok.before) : tok.raw}
          </React.Fragment>
        );
      }
    });

  const renderedElements: React.ReactNode[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "code": {
        const custom = renderFence?.(block.language, block.code, block.complete, block.fenceIndex);
        if (custom !== undefined) {
          renderedElements.push(<React.Fragment key={block.key}>{custom}</React.Fragment>);
          break;
        }
        if (!block.complete) {
          if (block.code.length > 0) {
            renderedElements.push(
              <div key="code-unclosed" className="relative my-4 rounded-2xl bg-slate-900 border border-slate-800 p-4 font-mono text-xs text-slate-200 overflow-x-auto">
                <pre><code>{block.code}</code></pre>
              </div>
            );
          }
          break;
        }
        renderedElements.push(
          <div key={block.key} className="relative my-4 rounded-2xl bg-slate-900 border border-slate-800 dark:border-slate-800 shadow-md overflow-hidden text-xs">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800/80 text-[11px] text-slate-400 font-mono">
              <span>{block.language || "code"}</span>
              <button type="button" onClick={() => handleCopyCode(block.code, block.blockId)} className="flex items-center gap-1 hover:text-white transition-colors">
                {copiedBlock === block.blockId ? (
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
              <code>{block.code}</code>
            </pre>
          </div>
        );
        break;
      }
      case "table":
        renderedElements.push(
          <div key={block.key} className="chat-table-container">
            <table className="chat-table">
              <thead>
                <tr>{block.headers.map((header, index) => <th key={index} style={{ textAlign: block.alignments[index] }}>{renderInline(header)}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, index) => <td key={index} style={{ textAlign: block.alignments[index] }}>{renderInline(cell)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        break;
      case "empty":
        renderedElements.push(<div key={block.key} className="h-2.5" />);
        break;
      case "hr":
        renderedElements.push(<hr key={block.key} className="my-6 border-line" />);
        break;
      case "heading":
        if (block.level === 1) renderedElements.push(<h1 key={block.key} className="text-2xl font-black text-ink mt-6 mb-3 tracking-tight">{renderInline(block.tokens)}</h1>);
        else if (block.level === 2) renderedElements.push(<h2 key={block.key} className="text-xl font-extrabold text-ink mt-5 mb-2.5 tracking-tight">{renderInline(block.tokens)}</h2>);
        else if (block.level === 3) renderedElements.push(<h3 key={block.key} className="text-base font-bold text-slate-800 dark:text-slate-100 mt-4 mb-2 tracking-tight">{renderInline(block.tokens)}</h3>);
        else renderedElements.push(<h4 key={block.key} className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1.5">{renderInline(block.tokens)}</h4>);
        break;
      case "quote":
        renderedElements.push(
          <blockquote key={block.key} className="border-l-4 border-line pl-4 py-2 my-3 text-slate-700 dark:text-slate-300 italic bg-raised rounded-r-2xl font-medium">
            {renderInline(block.tokens)}
          </blockquote>
        );
        break;
      case "task":
        renderedElements.push(
          <div key={block.key} className="flex items-start gap-2.5 my-1.5 group select-none cursor-pointer" onClick={() => onToggleCheckbox?.(block.lineNum, !block.checked)}>
            <div className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center transition-colors shrink-0 ${
              block.checked ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 group-hover:border-line"
            }`}>
              {block.checked && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
            <span className={`text-xs leading-relaxed transition-all ${block.checked ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-200"}`}>
              {renderInline(block.tokens)}
            </span>
          </div>
        );
        break;
      case "bullet":
        renderedElements.push(
          <div key={block.key} className="flex items-start gap-2 my-1 text-xs">
            <span className="text-muted font-bold select-none">•</span>
            <span className="text-slate-800 dark:text-slate-200 leading-relaxed">{renderInline(block.tokens)}</span>
          </div>
        );
        break;
      case "numbered":
        renderedElements.push(
          <div key={block.key} className="flex items-start gap-2 my-1 text-xs">
            <span className="text-slate-400 dark:text-slate-500 font-mono font-bold select-none min-w-[1.2rem]">{block.number}.</span>
            <span className="text-slate-800 dark:text-slate-200 leading-relaxed">{renderInline(block.tokens)}</span>
          </div>
        );
        break;
      case "paragraph":
        renderedElements.push(
          <p key={block.key} className="my-2 text-xs sm:text-[13px] leading-relaxed text-slate-800 dark:text-slate-200">
            {renderInline(block.tokens)}
          </p>
        );
        break;
    }
  }

  return <div className={`prose-container space-y-1 ${className}`}>{renderedElements}</div>;
};

export const MarkdownView = React.memo(MarkdownViewInner);
