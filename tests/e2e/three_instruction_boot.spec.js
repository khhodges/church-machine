'use strict';

// Served-browser proof for the prepared-CR0 three-instruction boot path.
// This intentionally drives the real page singleton rather than requiring
// simulator.js directly, so stale browser assets and UI regressions fail here.

const { test, expect } = require('@playwright/test');

async function openCurrentSimulator(page) {
    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
        localStorage.setItem('bootEntrySlot', '6');
    });
    await page.goto('/simulator/?boot-proof=three-instruction', {
        // The IDE opens long-lived hardware telemetry requests, so networkidle
        // is not a valid readiness signal for the served page.
        waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() =>
        typeof sim !== 'undefined' &&
        typeof instantBoot === 'function' &&
        window.bootImageAvailable === true &&
        sim._bootImageLoaded === true
    );
}

test.describe('served three-instruction boot', () => {
    test('executes and displays only LOAD CR15, CHANGE CR12, CALL CR0', async ({ page }) => {
        await openCurrentSimulator(page);

        const result = await page.evaluate(() => {
            const displayedProgress = [];
            for (let i = 0; i < 3; i++) {
                switchView('pipeline');
                pipelineViz.setNIA(_bootNIARows(sim.bootStep));
                pipelineViz.render();
                displayedProgress.push(
                    document.getElementById('pipelineContainer')?.innerText || ''
                );
                sim._bootStep();
            }
            const ok = sim.bootComplete && !sim.halted;
            const progress = sim.bootProgress.map(row => ({
                instruction: row.instruction,
                status: row.status,
                bootRomAddress: row.bootRomAddress,
            }));
            switchView('pipeline');
            pipelineViz.setNIA(_bootNIARows(0));
            pipelineViz.render();
            return {
                ok,
                progress,
                assetId: window.__CHURCH_SIMULATOR_ASSET_ID__,
                bootPathVersion: window.__CHURCH_BOOT_PATH_VERSION__,
                diagnostic: window.__CHURCH_BOOT_PATH_DIAGNOSTIC__,
                pipelineText: displayedProgress.join('\n'),
            };
        });

        expect(result.ok).toBe(true);
        expect(result.progress).toEqual([
            { instruction: 'LOAD CR15, CR15[0]', status: 'completed', bootRomAddress: 0 },
            { instruction: 'CHANGE CR12, CR15[1]', status: 'completed', bootRomAddress: 1 },
            { instruction: 'CALL CR0', status: 'completed', bootRomAddress: 2 },
        ]);
        expect(result.assetId).toBe('simulator-three-instruction-boot-v1');
        expect(result.bootPathVersion).toBe('three-instruction-v1');
        expect(result.diagnostic.ok).toBe(true);
        expect(result.diagnostic.serverAssetId).toBe(result.assetId);
        expect(result.pipelineText).toContain('LOAD CR15');
        expect(result.pipelineText).not.toMatch(/INIT_ABSTR|B:05|target[- ]write/i);
    });

    test('reports CALL CR0 provenance for every invalid prepared CR0', async ({ page }) => {
        await openCurrentSimulator(page);

        const faults = await page.evaluate(() => {
            const cases = [
                ['out-of-range slot', machine => {
                    const entry = machine.readNSEntry(machine.bootEntrySlot);
                    return machine.createGT(entry.gtSeq, 255, { E: 1 }, 1);
                }, 'BOUNDS'],
                ['stale sequence', machine => {
                    const entry = machine.readNSEntry(machine.bootEntrySlot);
                    return machine.createGT((entry.gtSeq + 1) & 0x1FF,
                        machine.bootEntrySlot, { E: 1 }, 1);
                }, 'VERSION'],
                ['wrong type', machine => {
                    const entry = machine.readNSEntry(machine.bootEntrySlot);
                    return machine.createGT(entry.gtSeq, machine.bootEntrySlot, { E: 1 }, 0);
                }, 'TYPE'],
                ['missing target', () => 0, 'NULL_CAP'],
            ];
            return cases.map(([name, makeGT, expectedGate]) => {
                sim.reset();
                const home = sim.inspectBootEntryBinding().homeAddress;
                sim.memory[home] = makeGT(sim) >>> 0;
                sim._bootStep();
                sim._bootStep();
                sim._bootStep();
                const fault = sim.faultLog.at(-1);
                const evidence = fault && fault.bootEvidence;
                document.getElementById('faultModalOverlay')?.remove();
                return {
                    name,
                    type: fault && fault.type,
                    message: fault && fault.message,
                    gate: evidence && evidence.gate,
                    provenanceRegister: evidence && evidence.provenanceRegister,
                    bootRomAddress: evidence && evidence.bootRomAddress,
                    slot: evidence && evidence.slot,
                    hasRawInstruction: Number.isInteger(evidence && evidence.instructionWord),
                    location: JSON.stringify(fault && fault.instructionProvenance) || '',
                };
            });
        });

        expect(faults).toHaveLength(4);
        for (const fault of faults) {
            expect(fault.provenanceRegister, fault.name).toBe('CR0');
            expect(fault.bootRomAddress, fault.name).toBe(2);
            expect(fault.gate, fault.name).toBe(fault.type);
            expect(fault.hasRawInstruction, fault.name).toBe(true);
            expect(fault.message, fault.name).toContain('CALL');
            expect(fault.location, fault.name).not.toContain('Boot.NS +0');
        }
        expect(faults.map(fault => fault.type)).toEqual([
            'BOUNDS', 'VERSION', 'TYPE', 'NULL_CAP',
        ]);
        expect(faults[0].message).toContain('namespace index 255 out of bounds');
        expect(faults[1].message).toContain('gt_seq mismatch');
        expect(faults[2].message).toContain('GT type is NULL');
        expect(faults[3].message).toContain('CR0 is NULL');
        expect(faults[3].slot).toBe(null);
    });

    test('labels historical fault records without raw words as incomplete', async ({ page }) => {
        await openCurrentSimulator(page);

        const text = await page.evaluate(() => {
            const historical = {
                type: 'BOOT_BINDING',
                message: 'historical boot record',
                pc: 0,
                physicalPC: 0,
                step: 0,
                bootEvidence: {
                    attemptId: 4,
                    bootRomAddress: 2,
                    provenanceRegister: 'CR0',
                    provenanceGT: 0,
                    slot: null,
                    sequence: null,
                },
            };
            showFaultModal(historical);
            // The trace/evidence body is intentionally collapsed in the UI;
            // inspect served modal markup so collapsed historical evidence is
            // still proven present and explicitly incomplete.
            return document.getElementById('faultModalOverlay')?.innerHTML || '';
        });
        expect(text).toContain('instruction unavailable (historical record has no raw word)');
        expect(text).toContain('Known ROM instruction');
        expect(text).toContain('observed fault word');
    });
});
