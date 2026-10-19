'use strict';
// Real saved compiler artifact and admission, on the disposable server supplied
// by pytest. No editor changes, catalog/Namespace saves, or hardware writes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium, expect} = require('@playwright/test');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

(async () => {
    assert.match(input.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const browser = await chromium.launch({
        executablePath:execFileSync('which', ['chromium'], {encoding:'utf8'}).trim(),
        headless:true, args:['--no-sandbox'],
    });
    try {
        const context = await browser.newContext({viewport:{width:1440,height:1000}});
        const page = await context.newPage(), errors = [], writes = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin !== input.url || /\/(api\/.*)?(hardware|wukong|fpga|serial|usb|flash)/i.test(url.pathname))
                return route.abort();
            if (url.pathname === '/api/browser-diagnostics') return route.fulfill({
                status:200, contentType:'application/json', body:'{"ok":true}',
            });
            if (/\/api\/boot-image\/(binary|download)|\/boot-image\.bin$/.test(url.pathname)) return route.abort();
            if (!['GET','HEAD','OPTIONS'].includes(request.method())) {
                writes.push(url.pathname);
                assert.match(url.pathname, /^\/api\/simulation\/design\/phase1\/(prepare|approve|activate)$/);
            }
            return route.continue();
        });
        await context.addInitScript(() => {
            localStorage.setItem('church_welcome_dismissed_perm','1');
            localStorage.setItem('church_whatsnew_dismissed_perm','1');
            localStorage.setItem('churchMachine_mathGuideDismissed_perm','1');
            localStorage.setItem('churchMachine_autoBootOnOpen','0');
            localStorage.setItem('church.sim.breakpoint.bootLoadCR15','false');
            sessionStorage.setItem('church_welcome_dismissed_session','1');
            for (const lang of ['cloomc','javascript','haskell','english','symbolic','lambda','assembly'])
                localStorage.setItem(`church_intro_dismissed_${lang}`,'true');
        });
        await page.goto(input.url + '/simulator/?namespaceProfile=phase1#namespace');
        await page.waitForFunction(() => window.NamespaceDesignV1?.state.document &&
            !NamespaceDesignV1.state.loading && typeof sim !== 'undefined' && sim);
        const source = await page.locator('#asmEditor').inputValue();
        const step = page.locator('#toolStepBtn');
        const header = page.locator('#executionIdentityTrace');
        for (let stage = 1; stage <= 3; stage++) {
            await step.click();
            await page.waitForFunction(stage => sim.bootStep === stage, stage, {timeout:5000}).catch(async error => {
                console.error(await page.evaluate(() => ({bootStep:sim.bootStep, halted:sim.halted,
                    faults:sim.faultLog, message:DesignSimulation.markup(),
                    console:document.getElementById('editorConsole').textContent})));
                console.error(errors);
                throw error;
            });
            assert.equal(await page.evaluate(() => _traceData.length), stage);
            await expect(header).not.toContainText('VERIFIED SAVED PROGRAM');
        }
        assert.deepEqual(await page.evaluate(() => _traceData.map(row => ({
            op:row.opName, domain:row.domain, artifact:row.executionIdentity, token:row.lumpToken,
            frozen:Object.isFrozen(row.bootEvidence), phase:row.bootEvidence.phase,
        }))), ['LOAD','CHANGE','CALL'].map((op,index) => ({
            op, domain:'boot-rom', artifact:null, token:null, frozen:true, phase:index+1,
        })));
        for (let count = 1; count <= 2; count++) {
            await step.click();
            await page.waitForFunction(count => _traceData.length === count + 3, count);
            await expect(header).toContainText('VERIFIED SAVED PROGRAM');
            await expect(header).toContainText('ide.SelfTest#1');
            await expect(header).toContainText('NS[10]');
        }
        await page.evaluate(() => switchView('trace'));
        await expect(header).toBeVisible();
        for (const label of ['Boot 1/3','Boot 2/3','Boot 3/3','Code 1','Code 2'])
            await expect(page.locator('#traceTableBody')).toContainText(label);
        await expect(header).not.toContainText('No program loaded');
        await expect(page.locator('#executionIdentityAnnouncement')).not.toContainText('unverified');
        const rows = await page.evaluate(() => _traceData.map(row => ({
            identity:row.executionIdentity, evidence:row.executionEvidence,
        })));
        for (const row of rows.slice(3)) {
            assert.equal(row.identity.filename, input.selection.filename);
            assert.equal(row.identity.binaryHash, input.selection.binaryHash);
            assert.equal(row.identity.nsSlot, 10);
            assert.equal(row.identity.rawWord, row.evidence.instruction.raw);
        }
        // The editor controller must not overwrite the admitted Trace identity.
        await page.evaluate(() => ExecutionIdentity.render());
        await expect(header).toContainText('VERIFIED SAVED PROGRAM');
        assert.equal(await page.locator('#asmEditor').inputValue(), source);
        assert.equal(await page.evaluate(() => Object.isFrozen(sim.simulationConfiguration.artifactBindings[0])), true);
        assert.equal(await page.evaluate(() => {
            const evidence = _traceData.at(-1).executionEvidence;
            return DesignSimulation.traceIdentity({executionEvidence:{...evidence,
                simulationConfiguration:{...evidence.simulationConfiguration, imageHash:'0'.repeat(64)}}}) === null;
        }), true, 'unrelated or fabricated evidence never establishes the header');

        // Mutating a different code word must fail closed, even if this
        // occurrence's word matches. This changes only disposable RAM.
        assert.equal(await page.evaluate(() => {
            const result = {executionEvidence:_traceData.at(-1).executionEvidence};
            const base = result.executionEvidence.pre.artifact.codeCapability.word1;
            const original = sim.memory[base + 1];
            sim.memory[base + 1] ^= 1;
            const invalid = DesignSimulation.traceIdentity(result);
            _renderTraceExecutionIdentity();
            const lostVerification = document.getElementById('executionIdentityTrace').textContent.includes('no longer verified');
            sim.memory[base + 1] = original;
            return invalid === null && lostVerification;
        }), true);
        assert.equal(await page.evaluate(() => {
            const result = {executionEvidence:_traceData.at(-1).executionEvidence};
            const original = sim.memory[41];
            sim.memory[41] ^= 1 << 21; // generation, unlike the mutable G bit
            const invalid = DesignSimulation.traceIdentity(result);
            _renderTraceExecutionIdentity();
            const lostVerification = document.getElementById('executionIdentityTrace').textContent.includes('no longer verified');
            sim.memory[41] = original;
            return invalid === null && lostVerification;
        }), true, 'a changed Namespace generation invalidates the artifact label');
        // Captured identity survives later mutable registry/editor metadata.
        await page.evaluate(() => {
            window._nsState = {abstractions:[{slot:10,token:'deadbeef'}]};
            _renderTraceExecutionIdentity();
        });
        await expect(header).toContainText('ide.SelfTest#1');
        await page.evaluate(() => {
            switchView('namespace');
            NamespaceDesignV1.setProfile('ascending');
        });
        await page.evaluate(() => switchView('trace'));
        await expect(header).toContainText('Previous simulation');
        assert.deepEqual(await page.evaluate(() => _traceData.map(row => ({
            identity:row.executionIdentity, evidence:row.executionEvidence,
        }))), rows);
        await page.evaluate(() => {
            switchView('namespace');
            NamespaceDesignV1.setProfile('phase1');
        });
        await page.waitForFunction(() => NamespaceDesignV1.state.profile === 'phase1' &&
            !NamespaceDesignV1.state.loading && !!NamespaceDesignV1.state.document);
        await step.click();
        await page.waitForFunction(() => sim.bootStep === 1);
        await expect(header).not.toContainText('ide.SelfTest#1');
        assert.equal(await page.evaluate(() => _traceData.length), 1);
        await page.locator('button[onclick="resetSim()"]').click();
        await page.waitForFunction(() => sim.bootStep === 0);
        await expect(header).toContainText('Boot in progress');
        assert.equal(await page.evaluate(() => _traceData.length), 0);
        // Boot rows use the same recording path in Walk and Run, not just Step.
        for (const action of ['walk','run']) {
            await page.locator(action === 'walk' ? '#toolWalkBtn' : '#btnRunSim').click();
            await page.waitForFunction(() => _traceData.filter(row => row.domain === 'code').length >= 2);
            if (action === 'walk') await page.locator('#btnStopSim').click();
            else await page.waitForFunction(() => sim.halted);
            await page.evaluate(() => switchView('trace'));
            for (const label of ['Boot 1/3','Boot 2/3','Boot 3/3','Code 1','Code 2'])
                await expect(page.locator('#traceTableBody')).toContainText(label);
            assert.deepEqual(await page.evaluate(() => _traceData.filter(row => row.domain === 'boot-rom')
                .map(row => row.opName)), ['LOAD','CHANGE','CALL']);
            await expect(header).toContainText('VERIFIED SAVED PROGRAM');
            await page.locator('button[onclick="resetSim()"]').click();
            await page.waitForFunction(() => sim.bootStep === 0);
        }
        assert.equal(await page.locator('#asmEditor').inputValue(), source);
        assert.equal(writes.length, 6, 'only two private prepare/approve/activate cycles');
        assert.deepEqual(errors, []);
        console.log('PASS saved-design trace identity: three Boot steps, two NS[10] instructions, exact frozen identity, stale selection and reset, no source/Namespace/hardware writes');
    } finally {
        await browser.close();
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
