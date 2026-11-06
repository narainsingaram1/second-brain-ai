import type { StudyDocumentKind } from "../types";
import { describeImages } from "./openrouter";

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
/** Matches the cloud table limit (3 MB) with room for multi-byte characters. */
export const MAX_DOCUMENT_CHARS = 1_000_000;
export const ACCEPTED_UPLOADS = ".pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.json,.tex,.py,.java,.c,.cpp,.h,.js,.ts,.html,.png,.jpg,.jpeg,.webp,.gif";

export interface ExtractedDocument {
  kind: StudyDocumentKind;
  text: string;
  pages?: number;
  truncated: boolean;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

/** Paragraph text from Office XML: `para` is the paragraph tag (w:p / a:p), `run` the text tag (w:t / a:t). */
export function officeXmlText(xml: string, para: string, run: string): string[] {
  const out: string[] = [];
  const runPattern = new RegExp(`<${run}(?:\\s[^>]*)?>([^<]*)</${run}>`, "g");
  for (const block of xml.split(`</${para}>`)) {
    let text = "";
    for (const match of block.matchAll(runPattern)) text += decode(match[1]);
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const heading = para === "w:p" && block.match(/<w:pStyle w:val="(?:Heading|heading)(\d)"/);
    const bullet = para === "w:p" && /<w:numPr>/.test(block);
    out.push(heading ? `${"#".repeat(Math.min(6, Number(heading[1]) + 1))} ${trimmed}` : bullet ? `- ${trimmed}` : trimmed);
  }
  return out;
}

export function kindOf(file: { name: string; type: string }): StudyDocumentKind | null {
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (file.type.startsWith("text/") || ["txt", "md", "markdown", "csv", "json", "tex", "py", "java", "c", "cpp", "h", "js", "ts", "html"].includes(ext)) return "text";
  return null;
}

async function pdfText(data: ArrayBuffer, progress?: (s: string) => void) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  let length = 0;
  for (let n = 1; n <= pdf.numPages && length < MAX_DOCUMENT_CHARS; n++) {
    if (n % 5 === 1) progress?.(`Reading page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    // Page headings let search results and citations point at the right page.
    if (text) pages.push(`## Page ${n}\n\n${text}`);
    length += text.length;
    page.cleanup();
  }
  const count = pdf.numPages;
  await pdf.destroy();
  return { text: pages.join("\n\n"), pages: count };
}

async function officeText(data: ArrayBuffer, kind: "docx" | "pptx") {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  if (kind === "docx") {
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("This Word file has no readable document body.");
    return { text: officeXmlText(xml, "w:p", "w:t").join("\n\n") };
  }
  const slideNumber = (path: string) => Number(path.match(/(\d+)\.xml$/)?.[1] || 0);
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => slideNumber(a) - slideNumber(b));
  const parts: string[] = [];
  for (const path of slides) {
    const n = slideNumber(path);
    const body = officeXmlText(await zip.file(path)!.async("string"), "a:p", "a:t");
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async("string");
    // Notes slides repeat the slide number as text; keep only real speaker notes.
    const notes = notesXml ? officeXmlText(notesXml, "a:p", "a:t").filter((t) => t !== String(n)) : [];
    if (body.length || notes.length) parts.push([`## Slide ${n}`, ...body, ...(notes.length ? ["Speaker notes: " + notes.join(" ")] : [])].join("\n\n"));
  }
  return { text: parts.join("\n\n"), pages: slides.length };
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Turns an uploaded file into plain, chunkable text (markdown headings per page or slide). */
export async function extractDocument(file: File, options: { apiKey?: string; visionModel?: string; progress?: (s: string) => void; signal?: AbortSignal } = {}): Promise<ExtractedDocument> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 40 MB.`);
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name}: unsupported file type. Use PDF, Word, PowerPoint, text or images.`);
  let result: { text: string; pages?: number };
  if (kind === "pdf") result = await pdfText(await file.arrayBuffer(), options.progress);
  else if (kind === "docx" || kind === "pptx") result = await officeText(await file.arrayBuffer(), kind);
  else if (kind === "image") {
    if (!options.apiKey || !options.visionModel) throw new Error("Connect an AI provider in Settings to read images.");
    options.progress?.("Reading the image…");
    result = { text: await describeImages([{ name: file.name, dataUrl: await dataUrl(file) }],
      "Transcribe this study material (lecture slide, notes, textbook page, whiteboard or diagram) for later studying.", options.apiKey, options.visionModel, options.signal) };
  } else result = { text: await file.text() };
  const text = result.text.replace(/\u0000/g, "").trim();
  if (!text) throw new Error(kind === "pdf" ? `${file.name} has no selectable text (it may be a scan). Upload page images instead.` : `${file.name} has no readable text.`);
  return { kind, text: text.slice(0, MAX_DOCUMENT_CHARS), pages: result.pages, truncated: text.length > MAX_DOCUMENT_CHARS };
}
