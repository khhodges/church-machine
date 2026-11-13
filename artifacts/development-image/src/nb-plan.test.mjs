import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
const out = await build({entryPoints: [new URL("./nb-plan.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false});
const p = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
const g = await import(`data:text/javascript;base64,${Buffer.from((await build({entryPoints: [new URL("./nb-geometry.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false})).outputFiles[0].text).toString("base64")}`);
const ns = {slot: 0, name: "Boot.NS", kind: "namespace", location: 0, allocationWords: 64};
const th = {slot: 1, name: "Boot.Thread", kind: "thread", location: 64, allocationWords: 128};
const lump = (slot, words, extra = {}) => ({slot, name: "L" + slot, kind: "lump", location: 192, allocationWords: words, filename: "s.lump", lump_version: 1, ...extra});
const io = {slot: 9, name: "LED_DEV", kind: "mmio", location: 0x40000000, allocationWords: 4};
const rowsA = [ns, th, lump(2, 64), io], rowsB = [ns, th, lump(2, 64), lump(3, 128)];
const frozen = JSON.stringify([rowsA, rowsB]);
const design = side => ({side, rows: side === "A" ? rowsA : rowsB, layoutSource: "saved-design-layout"});
// Same saved addresses in A and B, same identity: still separate, disjoint copies.
let plan = p.planCoResidency([design("B"), design("A")], null);
assert.equal(p.overlaps(plan.items), false, "no overlap within/across A and B");
assert.equal(plan.items.length, 7);
assert.deepEqual(plan.items.map(i => i.side + i.kind[0] + i.start), ["An0", "At64", "Bn192", "Bt256", "Al384", "Bl448", "Bl512"]);
assert.equal(plan.items.filter(i => i.kind === "lump" && i.slot === 2).length, 2, "duplicate identity copies kept");
assert.equal(plan.requiredWords, 640); assert.equal(plan.status, "required-only");
assert.deepEqual(plan.zoneWords, {namespaceA: 192, namespaceB: 192, lumpZone: 256});
assert.equal(plan.external.length, 1, "MMIO listed externally");
assert.equal(plan.items.find(i => i.side === "A" && i.kind === "thread").sourceStart, 64, "source address kept");
assert.equal(JSON.stringify([rowsA, rowsB]), frozen, "saved inputs not mutated");
// Capacity.
assert.equal(p.planCoResidency([design("A"), design("B")], 640).status, "fits");
assert.equal(p.planCoResidency([design("A"), design("B")], 639).status, "insufficient");
// Proportional exact sizes: 64 vs 128 word LUMPs -> 1:2.
const b2 = plan.items.find(i => i.side === "B" && i.slot === 2), b3 = plan.items.find(i => i.side === "B" && i.slot === 3);
assert.equal(g.extentToY(b3.start, b3.words, 640, 0, 420).h / g.extentToY(b2.start, b2.words, 640, 0, 420).h, 2);
// Unknown size: unresolved, later entries blocked, no required span.
plan = p.planCoResidency([{side: "A", rows: [ns, lump(2, null), lump(3, 64)], layoutSource: "saved-design-layout"}], 10000);
assert.equal(plan.status, "unresolved"); assert.equal(plan.requiredWords, null);
assert.equal(plan.items.find(i => i.slot === 3).start, null, "blocked after unresolved");
// Lazy LUMP without allocation: not provisioned, not unresolved.
plan = p.planCoResidency([{side: "A", rows: [ns, lump(4, 0, {policy: "Lazy"})], layoutSource: "saved-design-layout"}], null);
assert.equal(plan.notProvisioned.length, 1); assert.equal(plan.status, "required-only");
// Namespace authority range (non design layout) is not a table extent.
plan = p.planCoResidency([{side: "A", rows: [{...ns, allocationWords: 16384}], layoutSource: "saved-locations"}], null);
assert.equal(plan.status, "unresolved"); assert.equal(plan.items[0].words, null);
// Overflow.
plan = p.planCoResidency([{side: "A", rows: [lump(1, 0x80000000), lump(2, 0x80000000), lump(3, 1)], layoutSource: "saved-design-layout"}], null);
assert.equal(plan.status, "overflow");
assert.equal(p.planCoResidency([], 100).status, "empty");
console.log("PASS co-resident plan: disjoint, separate copies, capacity, unresolved, overflow, immutable inputs");
