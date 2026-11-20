const textOf = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part: any) => part?.type === "text" ? part.text : "").join("\n") : "";
/**
 * Many chat templates (Qwen, Llama, Mistral served through vLLM or LiteLLM) accept a system message only as
 * the very first message. Leading system messages are merged into one; a later one, such as the instruction to
 * stop using tools and answer, is sent as a user message marked as coming from the app, at the same place.
 */
export function orderSystemMessages<T extends { role: string; content: any }>(messages: T[]): T[] {
  let lead = 0;
  while (lead < messages.length && messages[lead].role === "system") lead++;
  if (lead === messages.length || (lead <= 1 && !messages.slice(lead).some(m => m.role === "system"))) return messages;
  const out: T[] = [];
  if (lead === 1) out.push(messages[0]);
  else if (lead) out.push({ ...messages[0], content: messages.slice(0, lead).map(m => textOf(m.content)).filter(Boolean).join("\n\n") });
  for (const message of messages.slice(lead)) {
    if (message.role !== "system") { out.push(message); continue; }
    const note = `[Instruction from the app, not from the user]\n${textOf(message.content)}`;
    const previous = out[out.length - 1];
    // Merged into a user message just before it, so user turns never come twice in a row.
    if (previous?.role === "user") out[out.length - 1] = { ...previous, content: typeof previous.content === "string" ? `${previous.content}\n\n${note}` : [...previous.content, { type: "text", text: note }] };
    else out.push({ ...message, role: "user", content: note });
  }
  // The next message may itself be a user message; join them too.
  return out.reduce<T[]>((list, message) => {
    const previous = list[list.length - 1];
    if (previous?.role === "user" && message.role === "user" && typeof previous.content === "string" && typeof message.content === "string" && previous.content.startsWith("[Instruction from the app"))
      list[list.length - 1] = { ...message, content: `${previous.content}\n\n${message.content}` };
    else list.push(message);
    return list;
  }, []);
}
