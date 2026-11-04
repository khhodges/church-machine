/* Browser verification against the running artifact. No real hardware writes. */
const {chromium} = require("playwright");
const {execFileSync} = require("node:child_process");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    executablePath: execFileSync("which", ["chromium"], {encoding: "utf8"}).trim(),
    args: ["--no-sandbox"], headless: true,
  });
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
    const errors = [];
    const writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request();
      if (req.method() !== "GET" && req.method() !== "HEAD") {
        writes.push(req.url());
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const base = process.env.IMAGE_APP_URL || "http://127.0.0.1:22382/development-image/";
    await page.goto(base);
    await page.locator("tbody tr").first().waitFor();
    const menu = page.getByRole("button", {name: "IDE menu", exact: true});
    await menu.click();
    await page.getByRole("navigation", {name: "IDE navigation"}).waitFor();
    assert.equal(await page.getByRole("link", {name: "Namespace Table", exact: true}).getAttribute("href"), "/simulator/#namespace");
    assert.equal(await page.getByRole("link", {name: "Testing", exact: true}).getAttribute("href"), "/simulator/#builder?tab=testing");
    await page.keyboard.press("Escape");
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await menu.press("ArrowDown");
    await page.getByRole("navigation", {name: "IDE navigation"}).waitFor();
    await page.getByRole("heading", {name: "Development image", exact: true}).click();
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("tbody tr").count(), 14);
    assert.equal(await page.locator(".kiss-region").count(), 9);
    assert.equal(await page.locator(".kiss-region.is-selected").count(), 0);
    assert.equal(await page.locator("tbody tr").last().locator("td").first().textContent(), "00");
    await page.getByRole("button", {name: /Show details for slot 0, Boot.NS/}).click();
    assert.equal(await page.locator(".kiss-region.is-selected").count(), 1);
    assert.equal(await page.getByRole("img", {name: "Namespace icon"}).count(), 1);
    await page.getByRole("button", {name: /Show details for slot 2, UART_DEV/}).click();
    assert.equal(await page.getByRole("img", {name: /uart device/}).count(), 1);
    await page.getByRole("button", {name: "Send build to FPGA", exact: true}).click();
    await page.getByRole("status").filter({hasText: /Not sent/}).waitFor();
    assert.equal(writes.length, 0, "Inspection and rejected send must never bind or queue commands.");
    const next = await page.locator("#kiss-namespace option").evaluateAll(options =>
      options.find(option => option.textContent.startsWith("New Layout")).value);
    await page.selectOption("#kiss-namespace", next);
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 21);
    assert(await page.locator(".kiss-region").count() > 1, "Changing to New Layout must fill the memory glass.");
    await page.getByRole("button", {name: "Show details for slot 2, Boot.Thread", exact: true}).click();
    assert.equal(await page.locator(".kiss-region.is-selected").count(), 1);
    assert.match(await page.locator(".kiss-device-card").innerText(), /0x00000100/);
    const phase = await page.locator("#kiss-namespace option").evaluateAll(options =>
      options.find(option => option.textContent === "Phase 1").value);
    await page.selectOption("#kiss-namespace", phase);
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 17);
    assert(await page.locator(".kiss-region").count() > 1, "Changing to Phase 1 must fill known allocations.");
    await page.selectOption("#kiss-namespace", next);
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 21);
    assert.equal(await page.locator(".kiss-region.is-selected").count(), 0);
    await page.setViewportSize({width: 1024, height: 783});
    assert(await page.evaluate(() => {
      const table = document.querySelector(".kiss-table-scroll").getBoundingClientRect();
      const map = document.querySelector(".kiss-water-map").getBoundingClientRect();
      const glass = document.querySelector(".kiss-glass-figure").getBoundingClientRect();
      const card = document.querySelector(".kiss-device-card").getBoundingClientRect();
      return Math.abs(table.y - map.y) < 2 && map.x >= table.right - 1 &&
        Math.abs(glass.y - card.y) < 2 && card.x >= glass.right;
    }), "Reference-width layout must keep table, glass and inline details side by side.");
    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile layout overflow");
    assert.deepEqual(errors, []);
    console.log("Live saved-data checks passed: row counts, memory geometry, upward slots, icons, selection reset, no writes, mobile layout.");

    // Positive send path uses entirely intercepted fixtures, not a live board.
    const isolated = await browser.newPage();
    const digest = "a".repeat(64), revision = "b".repeat(64);
    const image = {profile: "amoeba-retry-25mhz-uart-v1", namespace_revision_id: revision,
      artifact_sha256: digest, required_bitstream_sha256: "c".repeat(64), size: 65536};
    const target = {device_uid: "test-only-board", session_id: "test-only-session", live: true};
    const calls = [];
    await isolated.route("**/api/**", route => {
      const req = route.request(), url = new URL(req.url());
      let value;
      if (url.pathname.endsWith("/catalog")) value = {ok: true, entries: [{id: revision, name: "Original", saved_at: "", preparation: "retained"}]};
      else if (url.pathname.endsWith("/inspect")) value = {ok: true, id: revision, name: "Original", rows: [],
        fingerprint: revision, capacityWords: 16384, capacitySource: "saved-image", image, warnings: [], metadata: {}};
      else if (url.pathname.endsWith("/uart-prepare")) {calls.push("prepare"); value = {ok: true, ...image};}
      else if (url.pathname.endsWith("/uart-install")) {
        calls.push("install");
        const body = req.postDataJSON();
        assert.equal(body.artifact_sha256, digest);
        assert.equal(body.namespace_revision_id, revision);
        assert.equal(body.target_device_uid, target.device_uid);
        assert.equal(body.confirm_runtime_memory_replacement, true);
        value = {ok: true, ...image, id: 42, queued: true};
      } else throw Error("Unexpected fixture API request: " + url.pathname);
      return route.fulfill({json: value});
    });
    await isolated.route("**/hardware/**", route => route.fulfill({json: {
      physical_target: target, command_delivery: {id: 42, artifact_sha256: digest, write_ok: true,
        target_device_uid: target.device_uid, target_session_id: target.session_id},
      runtime_upload_ack: {command_id: 42, artifact_sha256: digest, ok: true},
    }}));
    await isolated.goto(base);
    const send = isolated.getByRole("button", {name: "Send build to FPGA", exact: true});
    await send.waitFor();
    await isolated.waitForFunction(() => !document.querySelector(".kiss-send-button").disabled);
    await send.click();
    await isolated.getByRole("dialog").waitFor();
    assert.deepEqual(calls, [], "Opening confirmation must not submit.");
    await isolated.getByRole("button", {name: "Cancel", exact: true}).click();
    assert.deepEqual(calls, []);
    await send.click();
    await isolated.getByLabel("IDE hardware access token").fill("test-fixture-only");
    await isolated.getByRole("button", {name: "Replace runtime memory and send", exact: true}).click();
    await isolated.getByRole("status").filter({hasText: /Upload acknowledged/}).waitFor();
    assert.deepEqual(calls, ["prepare", "install"]);
    assert.match(await isolated.getByRole("status").textContent(), /not verified/);
    console.log("Isolated transfer checks passed: explicit consent, cancel safety, exact digest/revision/target, delivery correlation, no false readback claim.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
