import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const compiled = await transform(readFileSync(new URL("./nb-geometry.ts", import.meta.url), "utf8"), {loader: "ts", format: "esm"});
const g = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const row = (slot, location, allocationWords, kind = "lump") => ({slot, name: "L" + slot, kind, location, allocationWords});
// 64 vs 128 words -> 1:2 heights on the same scale.
const a = g.extentToY(0, 64, 1024, 42, 420), b = g.extentToY(0, 128, 1024, 42, 420);
assert.equal(b.h / a.h, 2);
assert.equal(a.y + a.h, 462, "word 0 sits at glass base");
// Distinct A/B addresses stay distinct; no relocation.
const A = g.savedObjects("A", [row(2, 256, 64)], 1024), B = g.savedObjects("B", [row(2, "0x200", 64)], 1024);
assert.equal(A[0].start, 256); assert.equal(B[0].start, 512);
assert.notEqual(g.extentToY(A[0].start, 64, 1024, 42, 420).y, g.extentToY(B[0].start, 64, 1024, 42, 420).y);
// Unknown size -> marker, unknown location -> unplaced, beyond scale -> out-of-range, MMIO excluded.
const mixed = g.savedObjects("A", [row(1, 10, null), row(3, null, 32), row(4, 1000, 64), row(5, 2048, 8), row(6, 0, 4, "mmio"), row(7, 0, 16, "thread")], 1024);
assert.deepEqual(mixed.map(o => o.placement), ["marker", "unplaced", "out-of-range", "out-of-range", "extent"]);
assert.equal(mixed[0].words, null);
// Shared scale uses supplied capacities, else original fallback.
assert.deepEqual(g.sharedScale([4096, 16384]), {words: 16384, source: "capacity"});
assert.deepEqual(g.sharedScale([null, undefined]), {words: 16384, source: "fallback"});
assert.equal(g.hexWord(255), "0x000000FF");
console.log("PASS saved A/B coordinate geometry");
