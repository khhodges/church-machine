import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const compiled = await transform(readFileSync(new URL("./next-bitstream.ts", import.meta.url), "utf8"), {loader: "ts", format: "esm"});
const {checkDraft, parseWords} = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);

assert.equal(parseWords(""), null);
assert.equal(parseWords("0x100"), 256);
assert.equal(typeof parseWords("-4"), "string");
assert.equal(typeof parseWords("0"), "string");
assert.equal(typeof parseWords("1.5"), "string");

let c = checkDraft({total: "", namespaceA: "", namespaceB: "", lumpZone: ""});
assert.equal(c.errors.length, 0); assert.equal(c.total, null); assert.equal(c.scaleSource, "none");
assert.equal(c.remainingWords, null, "blank draft makes no fit claim");

c = checkDraft({total: "1000", namespaceA: "300", namespaceB: "200", lumpZone: "400"});
assert.deepEqual(c.errors, []); assert.equal(c.remainingWords, 100);
assert.deepEqual(c.regions.map(r => r.start), [0, 300, 500]);

c = checkDraft({total: "1000", namespaceA: "600", namespaceB: "500", lumpZone: ""});
assert.match(c.errors[0], /exceeding/); assert.equal(c.remainingWords, null);

c = checkDraft({total: "", namespaceA: "100", namespaceB: "", lumpZone: "50"});
assert.equal(c.scaleSource, "sum-of-regions"); assert.equal(c.regions[2].start, null, "no placement after a gap");
assert.equal(c.remainingWords, null);

c = checkDraft({total: "abc", namespaceA: "1", namespaceB: "1", lumpZone: "1"});
assert.match(c.errors[0], /Proposed total/);

// Switch loop wiring (source-level, cheap).
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const dev = readFileSync(new URL("./DevelopmentImage.tsx", import.meta.url), "utf8");
const next = readFileSync(new URL("./NextBitstreamDesign.tsx", import.meta.url), "utf8");
assert(app.includes("<DevelopmentImage") && app.includes("<NextBitstreamDesign"), "both views mounted");
assert(/hidden=\{mode !== "image"\}/.test(app) && /hidden=\{mode !== "next"\}/.test(app), "toggled, not unmounted");
assert(dev.includes('"Switch to Next Bitstream Design"') && dev.includes("onSwitch("), "image view switches forward");
assert(next.includes("DevelopmentImageView.openDesigner") && next.includes('aria-label="Switch to Namespace Designer"'), "next view returns to designer");
for (const banned of ["/prepare", "uart-install", "installExact", "prepareExact", "/hardware/", "method:"]) assert(!next.includes(banned), "no mutation/hardware: " + banned);
console.log("PASS next-bitstream draft geometry and switch loop");
