import type { FileAttachment } from "../types";
import { checkChatFile, ChatFileError, MAX_EXTRACTED_CHARS } from "../utils/chatFiles";

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const textRuns = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(m => decodeXml(m[1])).join("");

/** Shared strings of a workbook (xl/sharedStrings.xml), in order. Rich text runs are joined. */
export function sharedStringsFromXml(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textRuns(m[1]));
}

/** Column index (0-based) from a cell reference such as "C12". */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() || "A";
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n - 1;
}

/** Rows of cell values from a worksheet's XML. Empty rows are dropped; gaps inside a row stay empty cells. */
export function sheetRowsFromXml(xml: string, shared: string[], maxRows = 5000): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= maxRows) break;
    const cells: string[] = [];
    let next = 0;
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1], inner = cell[2] || "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1];
      const column = ref ? columnIndex(ref) : next;
      next = column + 1;
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textRuns(inner);
      else if (type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
      else if (raw !== undefined) value = decodeXml(raw);
      if (column > 1000) continue; // Corrupt or absurdly wide sheets.
      while (cells.length < column) cells.push("");
      cells[column] = value;
    }
    while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
    if (cells.length) rows.push(cells);
  }
  return rows;
}

const csvCell = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
export function rowsToCsv(rows: string[][]): string {
  return rows.map(row => row.map(csvCell).join(",")).join("\n");
}

/** Sheets of a workbook in tab order, each as CSV under a "## Sheet: name" heading. */
export async function workbookText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbook) throw new ChatFileError("This Excel file has no readable workbook.");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string") || "";
  const targets = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [m[1].match(/\bId="([^"]+)"/)?.[1] || "", m[1].match(/\bTarget="([^"]+)"/)?.[1] || ""]));
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared = sharedXml ? sharedStringsFromXml(sharedXml) : [];
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m, index) => ({
    name: decodeXml(m[1].match(/\bname="([^"]*)"/)?.[1] || `Sheet ${index + 1}`),
    target: targets.get(m[1].match(/\br:id="([^"]+)"/)?.[1] || "") || `worksheets/sheet${index + 1}.xml`,
  }));
  const parts: string[] = [];
  let length = 0;
  for (const sheet of sheets) {
    if (length > MAX_EXTRACTED_CHARS) break;
    const path = sheet.target.startsWith("/") ? sheet.target.slice(1) : `xl/${sheet.target.replace(/^\.\//, "")}`;
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const rows = sheetRowsFromXml(xml, shared);
    const body = rows.length ? rowsToCsv(rows) : "(empty)";
    parts.push(`## Sheet: ${sheet.name} (${rows.length} row${rows.length === 1 ? "" : "s"})\n\n${body}`);
    length += body.length;
  }
  return { text: parts.join("\n\n"), pages: sheets.length };
}

/** Plain text from RTF: control words and hidden groups removed, escaped characters decoded. */
export function rtfText(rtf: string): string {
  let out = "";
  const skip: boolean[] = [];
  let skipping = false;
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === "{") { skip.push(skipping); if (rtf.startsWith("{\\*", i) || /^\{\\(fonttbl|colortbl|stylesheet|info|pict|header|footer)/.test(rtf.slice(i, i + 16))) skipping = true; continue; }
    if (ch === "}") { skipping = skip.pop() ?? false; continue; }
    if (ch === "\\") {
      const next = rtf[i + 1];
      if (next === "\\" || next === "{" || next === "}") { if (!skipping) out += next; i++; continue; }
      if (next === "'") { if (!skipping) out += String.fromCharCode(parseInt(rtf.slice(i + 2, i + 4), 16)); i += 3; continue; }
      const word = rtf.slice(i + 1).match(/^([a-z]+)(-?\d+)? ?/i);
      if (!word) { i++; continue; }
      i += word[0].length;
      if (!skipping) {
        if (word[1] === "par" || word[1] === "line") out += "\n";
        else if (word[1] === "tab") out += "\t";
        else if (word[1] === "u" && word[2]) { out += String.fromCharCode((Number(word[2]) + 65536) % 65536); if (rtf[i + 1] === "?") i++; }
      }
      continue;
    }
    if (!skipping && ch !== "\r" && ch !== "\n") out += ch;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Reads an attached document into text the model can analyze. Throws ChatFileError with a readable reason. */
export async function extractChatFile(file: File, progress?: (message: string) => void): Promise<FileAttachment> {
  const kind = checkChatFile(file);
  let result: { text: string; pages?: number };
  try {
    if (kind === "pdf") {
      const { pdfText } = await import("./studyExtract");
      result = await pdfText(await file.arrayBuffer(), progress);
    } else if (kind === "docx" || kind === "pptx") {
      const { officeText } = await import("./studyExtract");
      result = await officeText(await file.arrayBuffer(), kind);
    } else if (kind === "xlsx") result = await workbookText(await file.arrayBuffer());
    else if (kind === "rtf") result = { text: rtfText(await file.text()) };
    else result = { text: await file.text() };
  } catch (error) {
    if (error instanceof ChatFileError) throw error;
    const detail = error instanceof Error && /password/i.test(error.message) ? " It looks password-protected." : "";
    throw new ChatFileError(`${file.name} couldn’t be read.${detail} Check that it opens on your computer and try again.`);
  }
  const text = result.text.replace(/\u0000/g, "").replace(/^﻿/, "").trim();
  if (!text) throw new ChatFileError(kind === "pdf" ? `${file.name} has no selectable text (it may be a scan). Attach page screenshots instead.` : `${file.name} has no readable text.`);
  return {
    id: crypto.randomUUID(), name: file.name || "Attachment", mimeType: file.type || "application/octet-stream", size: file.size, kind,
    text: text.slice(0, MAX_EXTRACTED_CHARS), chars: text.length, ...(result.pages ? { pages: result.pages } : {}),
    ...(text.length > MAX_EXTRACTED_CHARS ? { truncated: true } : {}),
  };
}
