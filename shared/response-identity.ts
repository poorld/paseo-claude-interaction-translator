/** Stable, matching client/server identity when a provider omits messageId.
 * We still match exact source text before showing cached translations.
 */
export function resolveResponseMessageId(messageId: string | undefined, text: string): string {
  if (messageId && messageId.length <= 512) return messageId;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + (i & 0xffff)), 0x01000193);
  }
  return `text:${text.length.toString(36)}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
