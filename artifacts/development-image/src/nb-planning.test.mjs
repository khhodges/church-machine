import assert from "node:assert/strict";
import {build} from "esbuild";
const load = async f => import(`data:text/javascript;base64,${Buffer.from((await build({entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, format: "esm", write: false})).outputFiles[0].text).toString("base64")}`);
const p = await load("./nb-plan.ts"), a = await load("./nb-association.ts");
const ns = {slot: 0, name: "NS", kind: "namespace", location: 0, allocationWords: 64};
const sel = (rev, hash) => ({filename: "x.lump", revision: rev, token: "t1", binaryHash: hash});
const res = (slot, words, extra = {}) => ({slot, name: "R" + slot, kind: "lump", location: 0, allocationWords: words, plannedWords: words,
  geometry: {sizeWords: words * 3}, resolutionSource: "latest-verified-compilation", unresolved: false, selection: sel(2, "h1"), ...extra});
const lazy = (slot, planned, extra = {}) => res(slot, null, {policy: "Lazy", plannedWords: planned, geometry: {sizeWords: planned * 3}, ...extra});
const inp = (side, rows) => ({side, rows, layoutSource: "saved-design-layout"});

// Partial input: A ready, B loading/error -> no fit, B never zero.
for (const pend of [{side: "B", state: "loading"}, {side: "B", state: "error", message: "boom"}]) {
  const plan = p.planCoResidency([inp("A", [ns, res(1, 100)])], 1_000_000, [pend]);
  assert.equal(plan.status, "incomplete"); assert.equal(plan.requiredWords, null); assert.equal(plan.targetStatus, "not-assessed");
  assert.ok(plan.messages.some(m => m.includes("Namespace B")));
  assert.equal(plan.items.some(i => i.side === "B"), false);
  assert.equal(plan.zoneWords.namespaceB, null);
  assert.equal(plan.zoneWords.lumpZone, null);
}
// Lazy demand separate, never resident.
let plan = p.planCoResidency([inp("A", [ns, res(1, 100), lazy(2, 500)])], null);
assert.equal(plan.requiredWords, 164); assert.equal(plan.lazyWords, 500);
assert.equal(plan.items.some(i => i.slot === 2), false); assert.equal(plan.notProvisioned[0].start, null);
assert.equal(plan.notProvisioned[0].binaryWords, 1500);
// Lazy failure: specific reason.
plan = p.planCoResidency([inp("A", [ns, lazy(2, null, {unresolved: true, plannedWords: null, geometry: null, resolutionError: "no verified compilation of x.lump@2"})])], null);
assert.equal(plan.notProvisioned[0].problem, "no verified compilation of x.lump@2"); assert.equal(plan.lazyUnresolved, 1);
// Unknown resident blocks later addresses; known sizes still counted.
plan = p.planCoResidency([inp("A", [ns, res(1, null, {unresolved: true, plannedWords: null, resolutionError: "hash mismatch"}), res(2, 40)])], 10_000);
assert.equal(plan.status, "unresolved"); assert.equal(plan.items.find(i => i.slot === 2).start, null);
assert.equal(plan.items.find(i => i.slot === 2).words, 40); assert.equal(plan.knownResidentWords, 104);
assert.equal(plan.items.find(i => i.slot === 1).problem, "hash mismatch");
// Exact identity and count: same identity in A+B -> 2 disjoint copies; different hash -> not associated.
const rowsA = [ns, res(1, 100)], rowsB = [ns, res(1, 100)], rowsC = [ns, res(1, 100, {selection: sel(2, "h2")})];
plan = p.planCoResidency([inp("A", rowsA), inp("B", rowsB)], null);
assert.equal(plan.items.filter(i => i.kind === "lump").length, 2); assert.equal(p.overlaps(plan.items), false);
assert.equal(plan.requiredWords, 328);
assert.equal(a.associate(a.lumpMembers("A", rowsA), a.lumpMembers("B", rowsB)).length, 1);
assert.equal(a.associate(a.lumpMembers("A", rowsA), a.lumpMembers("B", rowsC)).length, 2);
assert.equal(a.lumpIdentity(rowsA[1]), "x.lump@2#t1$h1");
// Staging outside app RAM; provisional target doesn't override total.
plan = p.planCoResidency([inp("A", [ns, res(1, 32704)])], 1000);
assert.equal(plan.requiredWords, 32768); assert.equal(plan.status, "insufficient"); assert.equal(plan.targetStatus, "fits");
assert.equal(plan.stagingWords, 4096); assert.equal(plan.appTargetWords, 32768);
console.log("PASS planning: partial input, lazy demand, unresolved reasons, exact identity/count, staging");
