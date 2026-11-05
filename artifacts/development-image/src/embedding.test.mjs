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
