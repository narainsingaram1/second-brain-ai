// The newest user message carries the per-turn Synapse context ahead of the user's own words
// (see boundedMessages), so the system message and earlier turns stay identical for prompt caching.
const CONTEXT = '<synapse_context>';
const isContext = part => part?.type === 'text' && part.text.startsWith(CONTEXT);

/** The per-turn context sent with a request: snapshot, date, memory, referenced records. */
export function turnContext(request) {
  const user = request.messages.findLast(m => m.role === 'user' && Array.isArray(m.content) && isContext(m.content[0]));
  return user ? user.content[0].text : '';
}
/** A message's own words, without the per-turn context. */
export function userText(message) {
  if (typeof message.content === 'string') return message.content;
  return (message.content || []).filter(p => p.type === 'text' && !isContext(p)).map(p => p.text).join('');
}
/** A message's parts, without the per-turn context. */
export function userParts(message) {
  return Array.isArray(message.content) ? message.content.filter(p => !isContext(p)) : message.content;
}
