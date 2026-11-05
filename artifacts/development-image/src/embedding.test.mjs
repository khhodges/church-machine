// Run: npx tsx src/embedding.test.mjs
import assert from "node:assert/strict";
import { ideUrl, isEmbeddedInIde, redirectStandalone } from "./embedding.ts";
const mk = (parentDoc, search) => {
  const win = { location: { search, origin: "https://ide.test", replaced: null, replace(u) { this.replaced = u; } } };
  win.parent = parentDoc === undefined ? win : { document: parentDoc };
  return win;
};
assert.equal(ideUrl("?namespace=design:abc"), "/simulator/#development-image?namespace=design%3Aabc");
assert.equal(ideUrl(""), "/simulator/#development-image");
let w = mk(undefined, "?namespace=design:abc");
assert.equal(redirectStandalone(w), true);
assert.equal(w.location.replaced, "/simulator/#development-image?namespace=design%3Aabc");
w = mk({ getElementById: id => (id === "developmentImageFrame" ? {} : null) }, "?namespace=x");
assert.equal(isEmbeddedInIde(w), true);
assert.equal(redirectStandalone(w), false, "embedded frame never redirects (no loop)");
assert.equal(w.location.replaced, null);
w = mk({ getElementById: () => null }, "");
assert.equal(redirectStandalone(w), true, "foreign frame is sent to the IDE");
console.log("PASS standalone redirect preserves selection; embedded never loops");
import { acceptLoadRequest, loadRequestReady } from "./embedding.ts";
{
  const parent = {}; const win = { parent, location: { origin: "https://ide.test" } };
  const ok = { origin: "https://ide.test", source: parent, data: { type: "development-image:load", namespace: "design:abc", requestId: "r1" } };
  assert.deepEqual(acceptLoadRequest(ok, win), ok.data);
  assert.equal(acceptLoadRequest({ ...ok, origin: "https://evil.test" }, win), null, "cross-origin rejected");
  assert.equal(acceptLoadRequest({ ...ok, source: {} }, win), null, "non-parent source rejected");
  assert.equal(acceptLoadRequest({ ...ok, data: { ...ok.data, requestId: "" } }, win), null, "explicit request id required");
  const top = { location: { origin: "https://ide.test" } }; top.parent = top;
  assert.equal(acceptLoadRequest({ ...ok, source: top }, top), null, "standalone never accepts");
  const handled = new Set();
  assert.equal(loadRequestReady(ok.data, "design:other", handled), false, "exact identity required");
  assert.equal(loadRequestReady(ok.data, "design:abc", handled), true);
  handled.add("r1");
  assert.equal(loadRequestReady(ok.data, "design:abc", handled), false, "one-shot");
  console.log("PASS load handoff: same-origin parent, exact identity, one-shot");
}
