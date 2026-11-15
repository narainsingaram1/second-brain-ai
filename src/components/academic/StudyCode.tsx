import type { ReactNode } from "react";

/**
 * Code in questions, answers and flashcards: light syntax colors and line numbers, so a student can trace it.
 * A small tokenizer is enough for the languages courses use (C family, Java, Python, JS, LC-3 / assembly).
 */
const C_WORDS = "int char void return if else for while do break continue struct sizeof unsigned signed long short const static typedef enum union switch case default float double extern volatile register goto NULL true false bool";
const KEYWORDS: Record<string, string> = {
  c: C_WORDS,
  java: `${C_WORDS} class public private protected new this super extends implements interface import package throws throw try catch finally final boolean byte null instanceof abstract var`,
  python: "def return if elif else for while in not and or is None True False class import from as with try except finally raise lambda yield pass break continue global nonlocal assert del print self",
  js: "function return if else for while do const let var new this class extends import export from default try catch finally throw typeof instanceof null undefined true false async await of in switch case break continue",
  asm: "ADD AND NOT BR BRN BRZ BRP BRNZ BRNP BRZP BRNZP JMP JSR JSRR LD LDI LDR LEA ST STI STR TRAP RET RTI HALT PUTS GETC OUT IN PUTSP .ORIG .FILL .BLKW .STRINGZ .END MOV PUSH POP CALL JMP CMP JE JNE SUB MUL",
};
const FAMILY: Record<string, keyof typeof KEYWORDS> = {
  c: "c", h: "c", cpp: "c", "c++": "c", cc: "c", java: "java", kotlin: "java", cs: "java", csharp: "java",
  python: "python", py: "python", js: "js", javascript: "js", ts: "js", typescript: "js", jsx: "js", tsx: "js",
  asm: "asm", lc3: "asm", "lc-3": "asm", assembly: "asm", s: "asm", nasm: "asm",
};
const LABELS: Record<string, string> = { lc3: "LC-3", "lc-3": "LC-3", asm: "Assembly", cpp: "C++", "c++": "C++", js: "JavaScript", ts: "TypeScript", py: "Python" };

type Token = { kind: "comment" | "string" | "number" | "keyword" | "preprocessor" | "register" | "plain"; text: string };

export function tokenizeCode(code: string, language: string): Token[] {
  const family = FAMILY[language.toLowerCase()];
  const words = new Set((family ? KEYWORDS[family] : `${KEYWORDS.c} ${KEYWORDS.js}`).split(" ").map((w) => (family === "asm" ? w.toUpperCase() : w)));
  const comment = family === "asm" ? ";[^\\n]*" : family === "python" ? "#[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const preprocessor = family === "c" || !family ? "^[ \\t]*#[ \\t]*[a-z]+" : "(?!)";
  const number = family === "asm" ? "#-?\\d+|\\b[xX][0-9a-fA-F]+\\b|\\b\\d+\\b" : "\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?[uUlLfF]*\\b";
  const pattern = new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*')|(${preprocessor})|(${number})|(\\.?[A-Za-z_][A-Za-z0-9_]*)`, "gm");
  const out: Token[] = [];
  let last = 0;
  for (const m of code.matchAll(pattern)) {
    if (m.index! > last) out.push({ kind: "plain", text: code.slice(last, m.index) });
    const [text, isComment, isString, isPre, isNumber, word] = m;
    const kind: Token["kind"] = isComment ? "comment" : isString ? "string" : isPre ? "preprocessor" : isNumber ? "number"
      : word && family === "asm" && /^R[0-7]$/i.test(word) ? "register"
      : word && words.has(family === "asm" ? word.toUpperCase() : word) ? "keyword" : "plain";
    out.push({ kind, text });
    last = m.index! + text.length;
  }
  if (last < code.length) out.push({ kind: "plain", text: code.slice(last) });
  return out;
}

export function StudyCode({ code, language = "" }: { code: string; language?: string }) {
  const lang = language.trim().toLowerCase();
  const lines = code.replace(/\s+$/, "").split("\n");
  const numbered = lines.length >= 4;
  // Tokenize the whole block (block comments span lines), then split the tokens back into lines.
  const rows: ReactNode[][] = [[]];
  tokenizeCode(lines.join("\n"), lang).forEach((token, t) => {
    token.text.split("\n").forEach((piece, i) => {
      if (i > 0) rows.push([]);
      if (piece) rows[rows.length - 1].push(token.kind === "plain" ? piece : <span key={`${t}-${i}`} className={`ac-tok-${token.kind}`}>{piece}</span>);
    });
  });
  const label = LABELS[lang] || (lang && lang !== "text" ? lang.charAt(0).toUpperCase() + lang.slice(1) : "");
  return (
    <figure className="ac-codeblock">
      {label && <figcaption>{label}</figcaption>}
      <pre><code>{rows.map((row, i) => (
        <span key={i} className="ac-code-line">{numbered && <span className="ac-line-no" aria-hidden="true">{i + 1}</span>}<span>{row.length ? row : " "}</span></span>
      ))}</code></pre>
    </figure>
  );
}
