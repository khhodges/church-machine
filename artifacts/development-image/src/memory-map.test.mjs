import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const compiled = await transform(readFileSync(new URL("./memory-map.ts", import.meta.url), "utf8"), {loader: "ts", format: "esm"});
const {builtSlots, byteToWord, containingRegion} = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const image = {artifact_sha256: "exact", namespace_revision_id: "design:one", size: 65536};
image.memory_map = {...image, address_unit: "byte", regions: [
  {slot: 1, name: "This.Namespace", kind: "namespace", byteAddress: 0, byteLength: 256, resident: true},
  {slot: 2, name: "This.Thread", kind: "thread", byteAddress: 256, byteLength: 1024, resident: true},
  {slot: 8, name: "Relocated.Lump", kind: "lump", byteAddress: 1280, byteLength: 512, resident: true},
  {slot: 9, name: "Lazy.Lump", kind: "lump", byteAddress: null, byteLength: 0, resident: false},
  {slot: 3, name: "UART", kind: "mmio", byteAddress: 0xffff0000, byteLength: 16, resident: false},
]};
const rows = builtSlots(image);
assert.equal(rows[2].location, 320);
assert.equal(rows[2].allocationWords, 128);
assert.equal(containingRegion(rows, byteToWord("0x500")).name, "Relocated.Lump");
assert.equal(containingRegion(rows, byteToWord("1283")).name, "Relocated.Lump");
assert.equal(byteToWord("1283"), 320.75);
assert.equal(containingRegion(rows, 447.75).slot, 8);
assert.equal(containingRegion(rows, 448), undefined);
assert.equal(containingRegion(rows, 63).kind, "namespace");
assert.equal(containingRegion(rows, 64).kind, "thread");
assert.equal(containingRegion(rows, 319).kind, "thread");
assert.equal(containingRegion(rows, 0xffff0000 / 4), undefined);
assert.equal(rows[4].location, 0x3fffc000);
assert.equal(rows[3].location, null);
for (const input of ["", "-4", "0xZZ", "1e3", "4294967296"]) assert.equal(byteToWord(input), null);
for (const field of ["artifact_sha256", "namespace_revision_id", "size", "address_unit"]) {
  assert.throws(() => builtSlots({...image, memory_map: {...image.memory_map, [field]: "wrong"}}), /does not match/);
}
assert.throws(() => builtSlots({...image, memory_map: undefined}), /unavailable/);
assert.throws(() => builtSlots({...image, memory_map: {...image.memory_map, regions: [
  {...image.memory_map.regions[2], byteAddress: 1281},
]}}), /invalid byte range/);
// A new image must resolve its own relocated names, never the prior projection.
const newer = {...image, artifact_sha256: "new", memory_map: {...image.memory_map,
  artifact_sha256: "new", regions: [{...image.memory_map.regions[2], name: "New.Lump", byteAddress: 2048}]}};
assert.equal(containingRegion(builtSlots(newer), 320), undefined);
assert.equal(containingRegion(builtSlots(newer), 512).name, "New.Lump");
console.log("memory-map tests passed");
