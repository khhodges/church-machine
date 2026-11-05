const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {transformSync} = require("esbuild");
const path = require("node:path");
function load(name, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "src", name), "utf8");
  const context = {module: {exports: {}}, ...globals};
  vm.runInNewContext(transformSync(source, {
    loader: "ts", format: "cjs", target: "es2020",
  }).code, context);
  return context.module.exports;
}
const {connectionStatus, reconnectHelp} = load("connection-status.ts");
assert.match(connectionStatus(), /current reception unconfirmed/);
const remembered = {physical_target: {live: false, device_uid: "remembered", session_id: "old"},
  bridge_poll_age: 90, last_trace_age: 90};
assert.match(connectionStatus(remembered), /no live identified target/);
assert.doesNotMatch(connectionStatus(remembered), /recent command poll accepted/);
const restored = {...remembered, bridge_poll_age: 0, last_trace_age: 0,
  physical_target: {live: true, device_uid: "current", session_id: "new"}};
assert.match(connectionStatus(restored), /recent command poll accepted/);
assert.match(connectionStatus(restored), /identified target reported live/);
assert.match(connectionStatus({...restored, last_trace_age: 99}), /current reception unconfirmed/);
assert.match(reconnectHelp, /401\/403/);
(async () => {
  for (const status of [401, 403]) {
    const {request} = load("image-api.ts", {fetch: async () => ({
      status, json: () => {throw Error("private-response-body");},
    })});
    await assert.rejects(request("/hardware/wukong/status"), error =>
      error.message.includes(`HTTP ${status}`) && !error.message.includes("private-response-body"));
  }
  const {request} = load("image-api.ts", {fetch: async () => ({
    status: 200, ok: true, json: async () => restored,
  })});
  assert.match(connectionStatus(await request("/hardware/wukong/status")), /identified target reported live/);
  console.log("Connection evidence, stale identity, authorization rejection and reconnection passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
