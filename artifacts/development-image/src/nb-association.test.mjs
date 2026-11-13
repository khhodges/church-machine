import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const compiled = await transform(readFileSync(new URL("./nb-association.ts", import.meta.url), "utf8"), {loader: "ts", format: "esm"});
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const lump = (slot, name, extra = {}) => ({slot, name, kind: "lump", location: 10, allocationWords: null, ...extra});
// Same name + slot in A and B but no exact identity: must stay separate.
let a = m.lumpMembers("A", [lump(3, "Math"), {slot: 1, name: "Boot.NS", kind: "namespace", location: 0, allocationWords: 4}]);
let b = m.lumpMembers("B", [lump(3, "Math")]);
let items = m.associate(a, b);
assert.equal(items.length, 2, "no accidental name/slot dedupe");
assert.deepEqual(items.map(m.sideOf), ["A", "B"]);
assert.equal(a[0].words, null, "unknown size stays unknown");
// Exact identity shared even at different slots and names.
a = m.lumpMembers("A", [lump(2, "Str", {filename: "str.lump", lump_version: 4, allocationWords: 96})]);
b = m.lumpMembers("B", [lump(7, "Strings", {selection: {filename: "str.lump", revision: 4}})]);
items = m.associate(a, b);
assert.equal(items.length, 1); assert.equal(m.sideOf(items[0]), "AB");
// Different revision of same file is not shared.
b = m.lumpMembers("B", [lump(2, "Str", {filename: "str.lump", lump_version: 5})]);
assert.equal(m.associate(a, b).length, 2);
// Token mismatch is not shared; duplicate identity within one side stays two copies.
const tA = m.lumpMembers("A", [lump(1, "X", {filename: "x", lump_version: 1, token: "t1"}), lump(2, "X", {filename: "x", lump_version: 1, token: "t1"})]);
const tB = m.lumpMembers("B", [lump(1, "X", {filename: "x", lump_version: 1, token: "t2"})]);
items = m.associate(tA, tB);
assert.equal(items.length, 3);
// Bidirectional selection: row -> glass, glass -> tab + row.
a = m.lumpMembers("A", [lump(2, "Str", {filename: "s", lump_version: 1}), lump(5, "OnlyA")]);
b = m.lumpMembers("B", [lump(9, "Str", {filename: "s", lump_version: 1}), lump(5, "OnlyA")]);
items = m.associate(a, b);
const shared = items.find(i => i.members.length === 2);
assert.equal(m.glassKeyFor(items, {side: "B", slot: 9}), shared.key);
assert.equal(m.glassKeyFor(items, {side: "A", slot: 2}), shared.key);
assert.deepEqual(m.pickFromGlass(shared, "B"), {tab: "B", pick: {side: "B", slot: 9}}, "keeps current tab");
const onlyB = items.find(i => i.key === "B:5");
assert.deepEqual(m.pickFromGlass(onlyB, "A"), {tab: "B", pick: {side: "B", slot: 5}}, "switches to owning tab");
assert.notEqual(m.glassKeyFor(items, {side: "A", slot: 5}), m.glassKeyFor(items, {side: "B", slot: 5}));
// Unassigned states.
assert.deepEqual(m.lumpMembers("A", null), []);
assert.deepEqual(m.associate([], []), []);
assert.equal(m.glassKeyFor([], {side: "A", slot: 1}), null);
assert.equal(m.glassKeyFor(items, null), null);
console.log("PASS A/B LUMP association and bidirectional selection");
