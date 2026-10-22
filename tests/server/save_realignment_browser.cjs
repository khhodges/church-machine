'use strict';
// This is driven only by the private Python fixture, never an existing preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

async function main() {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    assert.equal(process.env.CHURCH_TEST_ISOLATED_MODE, '1');
    assert.match(input.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    // Exercise the production callback verbatim with its frozen lexical inputs.
    // No copied orchestration, substituted preparation methods, or fake writes.
    const source = fs.readFileSync('simulator/app-run.js', 'utf8');
    const start = source.indexOf("return _lumpSaveRequest(fetch, '/api/lumps/save', _svPayload, async function(resp) {");
    const end = source.indexOf('\n        }, {\n            attempted: false,', start);
    assert(start >= 0 && end > start, 'post-save callback extraction boundary changed');
    const callback = source.slice(start, end) + '\n        });';
    const browser = await chromium.launch({
        executablePath: execFileSync('which', ['chromium'], {encoding:'utf8'}).trim(),
        headless: true, args: ['--no-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const calls = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (/\/api\/(lumps\/(save|save-plan|approval-intent)|namespace\/save-table|simulation\/)/.test(response.url()))
            calls.push([new URL(response.url()).pathname, response.status()]);
    });
    // Block external traffic and all hardware even on the disposable server.
    await context.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(input.url + '/') ||
                /\/api\/.*(hardware|wukong|fpga|serial|usb|flash)/i.test(url)) return route.abort();
        return route.continue();
    });
    await context.addInitScript(() => {
        localStorage.setItem('church_welcome_dismissed_perm', '1');
        localStorage.setItem('church_namespace_design_profile', 'legacy');
        sessionStorage.setItem('church_welcome_dismissed_session', '1');
    });
    // Confirm the real protected-review UI, never bypass its server receipt.
    let reviewPump;
    async function load() {
        await page.goto(input.url + '/simulator/');
        await page.waitForFunction(() => window.LumpSaveRealignment && window.SimulationPreparation &&
            typeof _lumpSaveRequest === 'function' && typeof sim !== 'undefined' && sim);
        assert.equal(await page.evaluate(() => NamespaceDesignV1.state.active), false);
        // Async evaluate does not trigger locator handlers, so pump only the
        // actual confirmation button while the application awaits its promise.
        clearInterval(reviewPump);
        reviewPump = setInterval(() => page.getByRole('button', {
            name:'Confirm this change', exact:true}).click({timeout:150}).catch(() => {}), 200);
    }
    async function control(action) {
        const response = await context.request.post(input.url + '/__save_alignment_control', {data:{action}});
        assert(response.ok());
    }
    async function snapshot() {
        return page.evaluate(() => ({
            image: sim.simulationConfiguration && sim.simulationConfiguration.imageHash,
            memory: Array.from(sim.memory), steps: sim.stepCount,
        }));
    }
    async function assertBlocked() {
        const before = await snapshot();
        assert.equal(await page.evaluate(async () => {
            const allowed = await SimulationPreparation.checkExecutionFreshness();
            await stepSim();
            await runSimGo();
            await walkToggle();
            return allowed;
        }), false);
        assert.deepEqual(await snapshot(), before, 'Step/Run/Walk must not execute stale bytes');
    }
    async function assertHistory(saved) {
        await page.waitForFunction(({token, lump_version}) => {
            const body = document.getElementById('lumpHistoryBody_' + _lumpTokenIdentity(token));
            return body && body.querySelector(`tr[data-version="${lump_version}"] input[checked]`);
        }, saved);
    }
    async function namespace() {
        const response = await context.request.get(input.url + '/api/boot-image/ns-state');
        assert(response.ok());
        return (await response.json()).abstractions;
    }
    async function publish(value, previous, mode) {
        return page.evaluate(async ({value, previous, mode, callback}) => {
            const source = `abstraction ide.CapabilityTest {\n method Ping() { return(${value}) }\n}\n`;
            async function post(url, body) {
                const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
                    body:JSON.stringify(body)});
                const data = await response.json();
                if (!response.ok || data.ok === false) throw Error(url + ': ' + JSON.stringify(data));
                return data;
            }
            const compiled = await post('/api/compile', {source, language:'javascript', tier:2});
            const record = compiled.compiler_record;
            const metadata = {abstraction:'ide.CapabilityTest', language:'javascript', content_type:'code',
                capabilities:compiled.capabilities, submitted_source:source, original_source:source,
                trust_origin:compiled.trust_origin, compiler_record:record,
                compiler_identity:record.compiler_identity, compiler_version:record.compiler_version,
                grants:['E'], editor_base:{token:previous.token, filename:previous.filename,
                    binary_hash:previous.binary_hash}, save_as_latest:true};
            const plan = await post('/api/lumps/save-plan', {binary:compiled.words, metadata});
            const approval = await post('/api/lumps/approval-intent', {digest:plan.digest,
                action:plan.action, plan_id:plan.plan_id, confirmation:true,
                approval:{grants:['E'], capability_type:'inform', save_as_latest:true}});
            Object.assign(metadata, {save_plan_id:plan.plan_id, approval_intent:approval.intent,
                portable_binding:plan.portable_binding, compiler_record:plan.compiler_record,
                compiler_identity:plan.compiler_record.compiler_identity,
                compiler_version:plan.compiler_record.compiler_version});
            if (mode === 'draft') window._nsTableDirty = true;
            const payload = {binary:plan.final_binary, metadata};
            const invoke = new Function('_svPayload', 'label', '_svLang', '_caps',
                '_saveSnapshot', '_svWords', '_svTok', '_svAbsName', callback);
            const committed = await invoke(payload, metadata.abstraction, 'javascript', compiled.capabilities,
                {sourceText:source, editorSourceText:source}, compiled.words, plan.token, metadata.abstraction);
            const list = await (await fetch('/api/lumps/list?include_archived=1')).json();
            const matches = list.filter(row => row.token === committed.token &&
                row.filename === committed.lump && row.binary_hash === committed.digest);
            if (matches.length !== 1) throw Error('exact publication missing: ' +
                JSON.stringify({committed, matches, barrier:window._savedLumpRealignment}));
            const saved = matches[0];
            if (saved.archived === true || saved.lump_version !== committed.lump_version)
                throw Error('catalog does not identify the committed active version');
            return {saved, committed, barrier:window._savedLumpRealignment};
        }, {value, previous, mode, callback});
    }
    async function assertActivated(saved, value) {
        const evidence = await page.evaluate(async ({saved, value}) => {
            if (window._savedLumpRealignment) throw Error(window._savedLumpRealignment.message);
            const config = sim.simulationConfiguration;
            if (!config || config.hardwareCertified !== false) throw Error('missing private provenance');
            const row = config.preparedRows.find(row => row.slot === 10);
            const response = await fetch(`/api/lump/${saved.token}/words?exact_filename=${encodeURIComponent(saved.filename)}&binary_hash=${saved.binary_hash}`);
            const body = await response.json();
            const words = Array.isArray(body) ? body : body.words;
            const expected = words.slice();
            expected[expected.length - 1] = parseInt(row.simulationBinding.localSelfGT, 16);
            const location = Number(row.location);
            const actual = Array.from(sim.memory.slice(location, location + expected.length));
            // Do not patch PC/registers or force entry. Execute the prepared boot
            // until the source's return value has been computed, before RETURN.
            for (let i=0; i<40 && sim.dr[1] !== value && !sim.halted; i++) await stepSim();
            return {row, actual, expected, result:sim.dr[1], faults:sim.faultLog, output:sim.output,
                steps:sim.stepCount, configuration:config.configurationHash};
        }, {saved, value});
        assert.equal(evidence.row.filename, saved.filename);
        assert.equal(evidence.row.binary_hash, saved.binary_hash);
        assert.deepEqual(evidence.actual, evidence.expected, 'complete localized saved body');
        assert.equal(evidence.result, value, JSON.stringify(evidence));
        assert.equal(evidence.faults.length, 0, JSON.stringify(evidence.faults));
        assert(evidence.steps > 0);
        return evidence;
    }
    try {
        await load();
        let result = await publish(42, input.old);
        assert.equal(result.barrier, null, JSON.stringify(result.barrier));
        await assertHistory(result.saved);
        await assertActivated(result.saved, 42);
        const first = result.saved;
        // This identity keeps its token across source revisions.
        result = await publish(43, first);
        assert.equal(result.saved.token, first.token);
        assert.notEqual(result.saved.filename, first.filename);
        await assertHistory(result.saved);
        await assertActivated(result.saved, 43);
        const sameToken = result.saved;

        // Identical source produces the same canonical file, token and bytes.
        // Each approved save still has its own history version; do not confuse
        // the archived rows sharing its hash with the committed active row.
        let previous = sameToken;
        for (let repeat = 0; repeat < 2; repeat++) {
            const callStart = calls.length;
            result = await publish(43, previous);
            assert.equal(result.committed.committed, true);
            for (const key of ['token', 'filename', 'binary_hash'])
                assert.equal(result.saved[key], sameToken[key], key);
            assert(result.saved.lump_version > previous.lump_version);
            assert.equal(result.barrier, null, JSON.stringify(result.barrier));
            await assertHistory(result.saved);
            assert.equal(await page.evaluate(() => sim.stepCount), 0,
                'unchanged save must still replace the stopped private machine');
            await assertActivated(result.saved, 43);
            for (const endpoint of ['namespace/save-table', 'simulation/prepare',
                'simulation/approve', 'simulation/activate'])
                assert(calls.slice(callStart).some(([path, status]) =>
                    path === '/api/' + endpoint && status < 300), endpoint);
            previous = result.saved;
        }

        // Dirty draft: publication succeeds, neither table nor image advances.
        const beforeDraft = await snapshot();
        const draftRows = await namespace();
        result = await publish(44, previous, 'draft');
        assert.match(result.barrier.message, /unsaved edits/);
        assert.deepEqual(await snapshot(), beforeDraft);
        assert.deepEqual(await namespace(), draftRows);
        assert.equal(await page.evaluate(() => window._nsTableDirty), true);
        await assertHistory(result.saved);
        await assertBlocked();
        await page.evaluate(() => { window._nsTableDirty = false; });
        await page.getByRole('button', {name:'Retry simulation preparation', exact:true}).click();
        await page.waitForFunction(() => window._savedLumpRealignment === null);
        await assertActivated(result.saved, 44);

        // Expired activation: retained approval exists but old machine is intact.
        const beforeFailure = await snapshot();
        await control('expire-activation');
        result = await publish(45, result.saved);
        assert.match(result.barrier.message, /activate failed/);
        assert.deepEqual(await snapshot(), beforeFailure);
        await assertBlocked();
        await assertHistory(result.saved);
        await control('restart');
        await load();
        assert.equal(await page.evaluate(() => SimulationPreparation.checkExecutionFreshness()), false);
        await page.getByRole('button', {name:'Retry simulation preparation', exact:true}).click();
        await page.waitForFunction(() => window._savedLumpRealignment === null);
        await assertActivated(result.saved, 45);

        // Pause only the GET response, not writes; a second HTTP client wins a
        // genuine compare-and-swap before the callback submits its stale rows.
        let competed = false;
        await page.route('**/api/boot-image/ns-state', async route => {
            const response = await route.fetch();
            const state = await response.json();
            if (!competed) {
                competed = true;
                const rows = state.abstractions.map(row => row.slot === 14 ?
                    {...row, label:'concurrent engineer edit'} : row);
                const data = {namespaceFingerprint:state.namespaceFingerprint, ns_state:{abstractions:rows}};
                let changed = await context.request.post(input.url + '/api/namespace/save-table', {data});
                if (changed.status() === 428) changed = await context.request.post(input.url + '/api/namespace/save-table',
                    {data, headers:{'X-Change-Confirmation':(await changed.json()).change_confirmation.id}});
                assert.equal(changed.status(), 200, await changed.text());
            }
            await route.fulfill({response});
        });
        const beforeConflict = await snapshot();
        const namespaceWritesBeforeConflict = calls.filter(([path]) => path === '/api/namespace/save-table').length;
        const rejection = page.waitForResponse(response =>
            response.url().endsWith('/api/namespace/save-table') && response.status() === 409);
        result = await publish(46, result.saved);
        assert(competed);
        const conflict = await (await rejection).json();
        assert.equal(conflict.committed, false);
        assert.equal(conflict.error, 'change_preflight_failed');
        assert.match(conflict.message, /Namespace changed since review; reload before saving/);
        assert(result.barrier.message.includes(conflict.message), 'barrier retains the server explanation and next action');
        const status = page.locator('#savedLumpRealignmentStatus');
        assert(await status.isVisible(), 'alignment failure must be visible');
        const visibleMessage = await status.innerText();
        assert.match(visibleMessage, /LUMP saved successfully\. Simulation preparation incomplete\./);
        assert(visibleMessage.includes(conflict.message), 'visible status explains the conflict and how to proceed');
        assert.deepEqual(await snapshot(), beforeConflict);
        const conflictedRows = await namespace();
        assert.notEqual(conflictedRows.find(row => row.slot === 10).filename, result.saved.filename);
        assert.equal(conflictedRows.find(row => row.slot === 14).label, 'concurrent engineer edit');
        await assertHistory(result.saved);
        await assertBlocked();
        assert.deepEqual(await namespace(), conflictedRows, 'competing rows remain unchanged while execution is blocked');
        assert.equal(calls.filter(([path]) => path === '/api/namespace/save-table').length,
            namespaceWritesBeforeConflict + 1, 'no silent retry of the rejected Namespace write');
        await page.unroute('**/api/boot-image/ns-state');
        await page.getByRole('button', {name:'Retry simulation preparation', exact:true}).click();
        await page.waitForFunction(() => window._savedLumpRealignment === null);
        await assertActivated(result.saved, 46);
        assert.equal((await namespace()).find(row => row.slot === 14).label, 'concurrent engineer edit',
            'explicit retry must preserve the competing edit');
        for (const endpoint of ['lumps/save-plan','lumps/approval-intent','lumps/save',
            'namespace/save-table','simulation/prepare','simulation/approve','simulation/activate'])
            assert(calls.some(([path,status]) => path === '/api/'+endpoint && status < 300), endpoint);
        assert(calls.some(([path,status]) => path === '/api/simulation/activate' && status === 409));
        console.log('PASS executed saved revision: canonical identity, unchanged saves, same-token History, draft/CAS, activation barrier, restart/retry');
    } catch (error) {
        console.error(error);
        console.error('Save status:', await page.locator('#saveNSStatus').textContent().catch(() => 'absent'));
        console.error('Browser errors:', errors);
        console.error('Endpoint evidence:', calls);
        throw error;
    } finally {
        clearInterval(reviewPump);
        await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
