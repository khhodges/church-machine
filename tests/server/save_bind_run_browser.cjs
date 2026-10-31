'use strict';
// Only launched by new_layout_call_browser_server.py --regression.
// No synthetic service successes, editor writes, or direct prepare/accept calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {chromium, expect} = require('@playwright/test');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
assert.equal(process.env.CHURCH_TEST_ISOLATED_MODE, '1');
assert.match(input.url, /^http:\/\/127\.0\.0\.1:\d+$/);
const hash = words => {
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((w, i) => bytes.writeUInt32LE(w >>> 0, i * 4));
    return createHash('sha256').update(bytes).digest('hex');
};

async function main() {
    const browser = await chromium.launch({headless:true, args:['--no-sandbox'],
        executablePath:execFileSync('which', ['chromium'], {encoding:'utf8'}).trim()});
    const calls = [], errors = [];
    let held, delayNext = false, lastBind, prebootHash;
    async function open() {
        const context = await browser.newContext({viewport:{width:1500,height:1100}});
        await context.addInitScript(() => {
            for (const key of ['church_welcome_dismissed_perm','church_whatsnew_dismissed_perm',
                'churchMachine_mathGuideDismissed_perm']) localStorage.setItem(key,'1');
            localStorage.setItem('churchMachine_autoBootOnOpen','0');
            sessionStorage.setItem('church_welcome_dismissed_session','1');
            for (const lang of ['cloomc','javascript','haskell','english','symbolic','lambda','assembly'])
                localStorage.setItem(`church_intro_dismissed_${lang}`,'true');
        });
        await context.route('**/*', async route => {
            const req = route.request(), url = new URL(req.url());
            if (url.origin !== input.url || /\/(hardware|wukong|fpga|serial|usb|flash)(\/|$)/i.test(url.pathname))
                return route.abort();
            if (req.method() === 'PUT' && url.pathname === '/api/namespace/design-v1') {
                const response = await route.fetch();
                if (response.ok() && req.postDataJSON().bind) {
                    const events = (await response.text()).trim().split('\n').map(JSON.parse);
                    lastBind = events.find(e=>e.type==='result')?.result || events[0];
                }
                return route.fulfill({response});
            }
            if (url.pathname.endsWith('/prepare') && delayNext) {
                delayNext = false;
                const response = await route.fetch();
                assert.equal(response.status(), 200, await response.text());
                held = {route, response, body:await response.json()};
                return;
            }
            return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => {
            if (req.method() !== 'GET') calls.push({
                path:new URL(req.url()).pathname, body:req.postDataJSON()});
        });
        await page.goto(input.url + '/simulator/?namespaceProfile=ascending#namespace');
        await page.waitForFunction(() => window.NamespaceDesignV1?.state.document &&
            !NamespaceDesignV1.state.loading && window.DesignSimulation);
        return {context, page};
    }
    const document = page => page.evaluate(() => JSON.parse(JSON.stringify(NamespaceDesignV1.state.document)));
    const source = page => page.locator('#asmEditor').inputValue();
    const snapshot = page => page.evaluate(() => ({
        words:Array.from(sim.memory), pc:sim.pc, steps:sim.stepCount,
        boot:sim.bootComplete, running:sim.running, faults:sim.faultLog,
        configuration:sim.simulationConfiguration
    }));
    const confirm = page => page.getByRole('button', {name:'Confirm this change',exact:true});
    const persisted = async page => (await page.request.get(input.url + '/__save_bind_run_state')).json();
    async function bind(page) {
        const review = page.waitForResponse(r => r.request().method() === 'PUT' &&
            r.url().includes('/api/namespace/design-v1') && r.status() === 428);
        await page.getByRole('button',{name:'Bind Namespace Design',exact:true}).click();
        await review;
        const success = page.waitForResponse(r => r.request().method() === 'PUT' &&
            r.url().includes('/api/namespace/design-v1') && r.status() === 200);
        await confirm(page).click();
        await success;
        await page.waitForFunction(() => !NamespaceDesignV1.state.saving);
        await page.getByText('Close all',{exact:true}).click();
        return lastBind;
    }
    async function prepare(page) {
        const responses = Promise.all(['prepare','approve','activate'].map(async action =>
            (await page.waitForResponse(r =>
                r.url().includes('/api/simulation/design/ascending/' + action) && r.status() === 200)).json()));
        responses.catch(()=>{});
        // Reset routes through the selected-design command and prepares when
        // invalidated, without executing an instruction.
        await page.locator('button[onclick="resetSim()"]').click();
        const [prepared, approved, active] = await responses;
        // Configuring an explicit handler validates Boot.Thread and the handler
        // with mLoad, setting only their descriptor G cache bits. Admission
        // bytes remain immutable; compare runtime with that exact expected delta.
        const expected = active.words.slice();
        const handler = (await document(page)).faultHandlerSlot;
        if (handler !== undefined) {
            for (const slot of [2, handler])
                expected[slot*4+1] = (expected[slot*4+1] | 0x40000000) >>> 0;
        }
        prebootHash = hash(expected);
        await expect.poll(async () => hash((await snapshot(page)).words)).toBe(prebootHash);
        assert.equal(prepared.imageHash, active.imageHash);
        assert.equal(prepared.configurationHash, approved.configurationHash);
        assert.equal(prepared.configurationHash, active.configurationHash);
        assert.equal(prepared.preparationId, active.preparationId);
        assert.equal(active.hardwareCertified, false);
        assert.equal(hash(active.words), prepared.imageHash);
        assert.deepEqual((await snapshot(page)).words, expected);
        return prepared;
    }
    let page;
    try {
        ({page} = await open());
        const original = await document(page);
        assert.equal(original.rows.length, 21, 'Acceptance fixture membership drifted; do not repair it');
        assert.equal(original.rows.find(r => r.slot === 21).name, 'ide.AmoebaStartup');
        await page.locator('[onclick="NamespaceDesignV1.source(21)"]').click();
        await expect(page.locator('#asmEditor')).toHaveValue(/AmoebaStartup/);
        const untouchedSource = await source(page);
        const beforeSave = await snapshot(page);
        const beforeRejectedSave = await persisted(page);
        await page.locator('#btnToolbarSaveLump').click();
        await page.locator('#saveNSConfirmBtn').click();
        await expect(page.locator('#saveNSConfirmBtn')).toHaveText('Approve & Save', {timeout:15000});
        await page.locator('#saveNSConfirmBtn').click();
        await expect(confirm(page)).toBeVisible();
        // Reject the real protected review, rather than manufacturing a 409.
        await page.getByRole('button',{name:'Reject — keep unchanged',exact:true}).click();
        await expect(confirm(page)).toBeHidden();
        assert.equal(await source(page), untouchedSource);
        assert.deepEqual(await document(page), original);
        assert.deepEqual(await snapshot(page), beforeSave);
        assert.deepEqual(await persisted(page), beforeRejectedSave,
            'Rejected review cannot publish bytes, approvals or Namespace selections');
        await page.locator('#saveNSConfirmBtn').click();
        await expect(page.locator('#saveNSConfirmBtn')).toHaveText('Approve & Save', {timeout:15000});
        await page.locator('#saveNSConfirmBtn').click();
        await confirm(page).click();
        // Publication and advancing the selected Namespace are distinct reviews.
        await confirm(page).click();
        await page.waitForFunction(revision => !window._savedLumpRealignment?.pending &&
            NamespaceDesignV1.state.document.rows.find(r=>r.slot===21).selection.revision >
            revision, original.rows.find(r=>r.slot===21).selection.revision);
        await expect(page.locator('#saveNSDialog')).toBeHidden();
        assert.equal(await source(page), untouchedSource);
        const saved = await document(page);
        const oldRow = original.rows.find(r=>r.slot===21), newRow = saved.rows.find(r=>r.slot===21);
        assert(newRow.selection.revision > oldRow.selection.revision);
        assert.deepEqual(saved.rows.filter(r=>r.slot!==21), original.rows.filter(r=>r.slot!==21));
        assert.deepEqual({...newRow,selection:null}, {...oldRow,selection:null});
        await page.evaluate(() => switchView('namespace'));
        const bound = await bind(page);
        assert.equal(bound.bindingReport.installed, false);
        assert.deepEqual(await document(page), saved);
        const prepared = await prepare(page);
        const machine = await snapshot(page);
        const resident = saved.rows.filter(r=>r.kind==='lump' && r.policy==='Resident');
        assert.equal(resident.length, 9);
        const schemas = new Set();
        for (const row of resident) {
            const item = bound.bindingReport.lists.find(b=>b.slot===row.slot);
            assert(item && item.boundWords, `NS${row.slot} has no bound words`);
            const binding = prepared.artifactBindings.find(b=>b.slot===row.slot);
            schemas.add(binding.portableBinding.schema);
            const descriptor = row.slot * 4;
            const base = machine.words[descriptor];
            const cc = item.boundWords[0] & 255;
            assert(cc > 0);
            // Binding reports retain the editing artifact; preparation installs
            // its API-only derivative, whose allocation can be smaller.
            const installedHeader = machine.words[base] >>> 0;
            const installedSize = 64 * (2 ** ((installedHeader >>> 23) & 15));
            assert.equal(installedHeader >>> 27, 31, `NS${row.slot} installed LUMP header`);
            assert.equal(installedHeader & 255, cc, `NS${row.slot} installed C-list count`);
            assert.deepEqual(machine.words.slice(base+installedSize-cc, base+installedSize),
                item.boundWords.slice(-cc), `complete NS${row.slot} C-list including SELF`);
        }
        assert.deepEqual([...schemas].sort(), ['church.portable-lump-binding/v1','church.symbolic-lump-binding/v1']);
        await page.locator('#toolBreakBtn').click();
        await page.locator('#breakOnBootLoadCR15Chk').uncheck();
        await page.locator('#toolBreakBtn').click();
        await page.locator('#btnRunSim').click();
        await expect.poll(async () => (await snapshot(page)).boot, {timeout:15000}).toBe(true);
        await expect.poll(async () => (await snapshot(page)).steps).toBeGreaterThan(10);
        if (await page.locator('#btnStopSim').isVisible()) await page.locator('#btnStopSim').click();
        assert.deepEqual((await snapshot(page)).faults, []);
        await page.locator('button[onclick="resetSim()"]').click();
        const reset = await snapshot(page);
        assert.equal(reset.pc, 0); assert.equal(reset.steps, 0);
        assert.equal(hash(reset.words), prebootHash);
        assert.equal(reset.configuration.configurationHash, prepared.configurationHash);
        assert.deepEqual(reset.faults, []);
        assert.equal(reset.boot, false);
        await page.locator('#toolBreakBtn').click();
        await page.locator('#breakOnBootLoadCR15Chk').check();
        await page.locator('#toolBreakBtn').click();
        const fresh = await open();
        const again = await prepare(fresh.page);
        assert.equal(again.imageHash, prepared.imageHash);
        assert.deepEqual(await document(fresh.page), saved);
        await fresh.context.close();

        await page.evaluate(() => switchView('namespace'));
        await bind(page);
        delayNext = true;
        await page.locator('button[onclick="resetSim()"]').click();
        await expect.poll(() => !!held).toBe(true);
        await bind(page);
        assert.deepEqual(await document(page), saved);
        assert.equal(await page.evaluate(() => DesignSimulation.traceContext()), null);
        const stale = held.body;
        await held.route.fulfill({response:held.response});
        held = null;
        // Wait for the stale browser promise to settle; fresh preparation then
        // provides a causal barrier before checking the complete request log.
        await page.waitForFunction(() => !document.getElementById('btnStopSim') ||
            getComputedStyle(document.getElementById('btnStopSim')).display === 'none');
        assert.equal(await page.evaluate(() => DesignSimulation.traceContext()), null,
            'Late Prepare cannot restore the invalidated machine');
        const current = await prepare(page);
        assert.notEqual(current.preparationId, stale.preparationId);
        assert.equal(current.imageHash, stale.imageHash, 'unchanged graph may generate identical bytes');
        assert(!calls.some(c=>/\/(approve|activate)$/.test(c.path) &&
            c.body?.preparationId === stale.preparationId), 'stale Prepare must never be approved or activated');
        assert.deepEqual(await document(page), saved);
        assert.equal(await source(page), untouchedSource);
        assert.deepEqual(errors, []);
        console.log('PASS real Save/Bind reviews, resident C-lists, image hashes, Run/Reset/fresh context, stale Prepare race');
    } catch(error) {
        console.error(error);
        console.error('Requests:', JSON.stringify(calls.map(c=>({path:c.path,preparationId:c.body?.preparationId}))));
        if (page) console.error((await page.locator('body').innerText()).slice(-16000));
        throw error;
    } finally {
        if (held) await held.route.abort().catch(()=>{});
        await browser.close();
    }
}
main().catch(error => {console.error(error); process.exitCode=1;});
