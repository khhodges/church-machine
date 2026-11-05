import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const temp = mkdtempSync(join(tmpdir(), "latest-image-test-"));
try {
  execFileSync("node_modules/.bin/esbuild", ["artifacts/development-image/src/latest-image.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${temp}/module.mjs`]);
  const {latestChoices, inspectChoice, sourceId} = await import(`file://${temp}/module.mjs`);
  const entries = [{id: "design:one", name: "New Layout"}, {id: "archive", name: "Old"}];
  assert.equal(latestChoices(entries)[0].id, "latest:design:one");
  assert.equal(latestChoices(entries).length, 3);
  assert.equal(sourceId("latest:design:one"), "design:one");
  const calls = [];
  let bad = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options.method || "GET"]);
    assert(!/install|command|stop|upload/.test(url), "Inspection must never control hardware");
    return {ok: true, json: async () => url.includes("/inspect")
      ? {id: "design:one", name: "New Layout", rows: [{location: 9000}], warnings: []}
      : {namespace_revision_id: "design:one", freshness_policy: "latest-every-lump",
          artifact_sha256: "hash", size: 65536,
          layout_rows: bad ? undefined : [{slot: 6, location: 160, allocationWords: 64}]}};
  };
  const built = await inspectChoice("latest:design:one", new AbortController().signal);
  assert.equal(built.layoutRows[0].location, 160);
  assert.equal(built.capacityWords, 16384);
  assert.equal(built.fingerprint, "hash");
  assert.equal(calls.length, 2);
  bad = true;
  await assert.rejects(inspectChoice("latest:design:one", new AbortController().signal), /matching built layout/);
  calls.length = 0;
  await inspectChoice("design:one", new AbortController().signal);
  assert.equal(calls.length, 1, "Saved inspection must not compile");
  console.log("Latest dropdown, exact geometry, no fallback, and inspection-only requests passed");
} finally { rmSync(temp, {recursive: true, force: true}); }
