/**
 * Some models (Qwen, Nemotron, Mistral and others behind providers that don't parse their tool calls) write a tool
 * call as text instead of sending it as one. This finds those calls so they can be turned back into real calls, and
 * strips the markup so it never reaches the user. Recognised shapes, with or without a <tool_call> /
 * <function_calls> wrapper and with or without a closing tag (a reply cut off mid-call):
 *   <function=NAME><parameter=KEY>VALUE</parameter>…</function>
 *   <NAME><parameter=KEY>VALUE</parameter>…</function>        (or </NAME>)
 *   <invoke name="NAME"><parameter name="KEY">VALUE</parameter>…</invoke>
 *   <function name="NAME">{"key": …}</function>
 *   <tool_call>{"name": "NAME", "arguments": {…}}</tool_call>
 *   [TOOL_CALLS][{"name": "NAME", "arguments": {…}}]
 * Text inside ``` code fences is left alone, so code the model is explaining is never touched.
 */
export interface TextToolCall {
  name: string;
  /** Raw parameter values from parameter tags; the caller types them by the tool's schema. */
  params: Record<string, string> | null;
  /** Arguments given as one JSON object. */
  args: Record<string, unknown> | null;
}

const OPENER = /<(?:function=["']?([\w.:-]+)["']?|(?:function|invoke|tool)\s+name=["']([\w.:-]+)["']|([a-z][\w.-]*))\s*>/gi;
const PARAM = /<parameter(?:=["']?([\w.:-]+)["']?|\s+name=["']([\w.:-]+)["'])\s*>([\s\S]*?)(?:<\/parameter>|(?=<parameter[=\s])|$)/gi;
const WRAPPER = /<\/?(?:tool_call|tool_calls|function_calls)>|<\|\/?tool_calls?(?:_begin|_end)?\|>/gi;
const STRAY_CLOSER = /<\/(?:parameter|function|invoke)>/gi;
const WRAPPER_NAMES = new Set(["tool_call", "tool_calls", "function_calls", "parameter"]);

const jsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(text.trim());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
};

/** A {"name", "arguments"} object as models write it in text; arguments may itself be a JSON string. */
function namedCall(value: unknown): TextToolCall | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, any>;
  const name = String(v.name || v.function?.name || "");
  let args = v.arguments ?? v.parameters ?? v.function?.arguments ?? {};
  if (typeof args === "string") args = jsonObject(args);
  if (!name || !args || typeof args !== "object" || Array.isArray(args)) return null;
  return { name, params: null, args };
}

/** Runs `fn` on the text outside ``` code fences only. */
function outsideFences(text: string, fn: (chunk: string) => string): string {
  return text.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => i % 2 ? part : fn(part)).join("");
}

function extractFrom(chunk: string, names: ReadonlySet<string>, calls: TextToolCall[]): string {
  // JSON calls inside <tool_call> wrappers.
  chunk = chunk.replace(/<tool_call>\s*(\{[\s\S]*?\})\s*(?:<\/tool_call>|$)/gi, (whole, json) => {
    const call = namedCall(jsonObject(json));
    if (!call) return whole;
    calls.push(call);
    return "";
  });
  // Mistral-style call lists.
  chunk = chunk.replace(/\[TOOL_CALLS\]\s*(\[[\s\S]*\]|\{[\s\S]*\})\s*$/, (whole, json) => {
    let list: unknown;
    try { list = JSON.parse(json); } catch { return whole; }
    const found = (Array.isArray(list) ? list : [list]).map(namedCall).filter((c): c is TextToolCall => !!c);
    if (!found.length) return whole;
    calls.push(...found);
    return "";
  });
  // Tag-style calls.
  let out = "", at = 0;
  OPENER.lastIndex = 0;
  for (let m = OPENER.exec(chunk); m; m = OPENER.exec(chunk)) {
    const bare = m[3];
    const name = (m[1] || m[2] || bare || "").trim();
    const after = chunk.slice(m.index + m[0].length);
    // A bare <name> is a call only for an offered tool, or when parameter tags follow it directly.
    if (bare && (WRAPPER_NAMES.has(bare.toLowerCase()) || (!names.has(bare) && !/^\s*<parameter[=\s]/i.test(after)))) continue;
    const closer = new RegExp(`</(?:function|invoke|tool|${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})>`, "i").exec(after);
    const body = closer ? after.slice(0, closer.index) : after;
    const end = m.index + m[0].length + (closer ? closer.index + closer[0].length : after.length);
    let params: Record<string, string> | null = null;
    PARAM.lastIndex = 0;
    for (const p of body.matchAll(PARAM)) (params ??= {})[(p[1] || p[2]).trim()] = p[3].replace(/^\s*\n|\n\s*$/g, "");
    const args = params ? null : jsonObject(body) ?? (body.trim() ? null : {});
    // Without parameters or a JSON body this is not a call: keep scanning inside it (it may wrap one).
    if (!params && !args) continue;
    calls.push({ name, params, args });
    out += chunk.slice(at, m.index);
    at = end;
    OPENER.lastIndex = end;
  }
  return out + chunk.slice(at);
}

const tidy = (text: string) => text.replace(WRAPPER, "").replace(STRAY_CLOSER, "").replace(/\n{3,}/g, "\n\n");

/** Finds tool calls written as text; `rest` is the text with every call and its wrapper markup removed. */
export function extractTextToolCalls(content: string, toolNames: Iterable<string> = []): { rest: string; calls: TextToolCall[] } {
  const calls: TextToolCall[] = [];
  if (!content || !/<|\[TOOL_CALLS\]/.test(content)) return { rest: content, calls };
  const names = new Set(toolNames);
  const rest = outsideFences(content, chunk => tidy(extractFrom(chunk, names, calls))).trim();
  return { rest, calls };
}

/**
 * Removes tool-call markup from text meant for the user. While `streaming`, an unfinished opener at the very end
 * (e.g. "<show_ca" or "<tool_call>\n<function=") is hidden too, so the half-written call never flashes on screen.
 */
export function stripToolMarkup(content: string, toolNames: Iterable<string> = [], streaming = false): string {
  if (!content) return content;
  let rest = extractTextToolCalls(content, toolNames).rest;
  if (streaming && !/```[^`]*$/.test(rest.replace(/```[\s\S]*?```/g, ""))) {
    const names = [...toolNames].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const open = new RegExp(`(?:<(?:tool_call|function_calls|function[=\\s]|invoke\\s|parameter[=\\s]${names.length ? `|(?:${names.join("|")})>` : ""})|\\[TOOL_CALLS\\])[\\s\\S]*$|<[\\w=|/]*$`, "i").exec(rest);
    if (open) rest = rest.slice(0, open.index).trimEnd();
  }
  return rest;
}
