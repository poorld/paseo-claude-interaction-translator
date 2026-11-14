import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveResponseMessageId } from "../shared/response-identity.ts";

test("keeps the provider identity when available", () => {
  assert.equal(resolveResponseMessageId("message-123", "Summary"), "message-123");
});
test("missing message identity is deterministic between client and server", () => {
  const content = "Claude 完成的总结: **Fixed** ✅";
  const id = resolveResponseMessageId(undefined, content);
  assert.match(id, /^text:/);
  assert.equal(id, resolveResponseMessageId(undefined, content));
  assert.notEqual(id, resolveResponseMessageId(undefined, "Different response"));
});
test("blank and oversized message IDs use the same stable fallback", () => {
  assert.equal(resolveResponseMessageId("", "abc"), resolveResponseMessageId(undefined, "abc"));
  assert.equal(resolveResponseMessageId("x".repeat(513), "abc"), resolveResponseMessageId(undefined, "abc"));
});
