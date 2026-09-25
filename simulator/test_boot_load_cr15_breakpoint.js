'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
const ChurchSimulator = require('./simulator.js');

// Synthetic boot-control coverage only: do not load or execute a real image.
const sim = new ChurchSimulator();
const firstAttempt = sim.bootAttemptId;
assert.strictEqual(sim.bootStep, 0);
assert.strictEqual(
    sim.checkBootLoadCR15BreakpointBeforeExecute(true), true,
    'enabled boot breakpoint pauses before the first LOAD CR15');
assert.strictEqual(sim.bootStep, 0,
    'breakpoint check does not retire LOAD CR15');
assert.strictEqual(
    sim.checkBootLoadCR15BreakpointBeforeExecute(true), false,
    'resume continues through the current breakpoint once');
assert.strictEqual(
    sim.checkBootLoadCR15BreakpointBeforeExecute(true), true,
    'remaining at B:00 after the one-time resume rearms the persistent breakpoint');

// Explicit Step retires B:00 outside the breakpoint check. Model only that
// control-state transition; no boot image or workload is executed.
sim.bootStep = 1;
assert.strictEqual(
    sim.checkBootLoadCR15BreakpointBeforeExecute(true), false,
    'breakpoint applies only to the active B:00 instruction');

sim.reset('synthetic boot-breakpoint rearm test');
assert.notStrictEqual(sim.bootAttemptId, firstAttempt,
    'reset creates a new boot attempt');
assert.strictEqual(
    sim.checkBootLoadCR15BreakpointBeforeExecute(true), true,
    'a new boot attempt rearms the LOAD CR15 breakpoint');
assert.strictEqual(
    sim.checkBootLoadCR15BreakpointBeforeExecute(false), false,
    'disabled breakpoint never pauses boot');

const runSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert(runSource.includes('if (_bootLoadCR15BreakpointBeforeNextInstruction())') &&
    runSource.includes('function runSim(preserveView)'),
    'Run checks the boot breakpoint before draining boot');
assert(runSource.includes('function slowBoot()') &&
    runSource.includes('if (walkRunning) finishWalk();'),
    'Walk/animated boot stops when the boot breakpoint fires');
assert(indexSource.includes('id="breakOnBootLoadCR15Chk"') &&
    indexSource.includes('checked'),
    'Step Settings exposes the enabled boot breakpoint');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let index = brace; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) {
            return source.slice(start, index + 1);
        }
    }
    throw new Error(`unterminated ${name}`);
}

// Isolated pending-program Step fixture: instantBoot's false return at B:00 is
// a pause, so the breakpoint report survives and is never relabelled "halted".
{
    const editorConsole = { textContent: '[BP] Breakpoint at B:00', className: '' };
    let instantBootCalls = 0;
    const context = {
        window: {
            TargetState: { authorize: () => ({ok: true}) },
            LumpRegistry: null,
            _lastCLOOMCResult: null,
        },
        sim: {
            bootComplete: false, halted: false, bootStep: 0,
            auditLog: [], output: '', _bootStep() {
                throw new Error('explicit Step must not execute through a boot pause');
            },
        },
        _pendingSimLoad: {},
        _requireCommittedImageForExecution: () => true,
        instantBoot: () => {
            instantBootCalls++;
            editorConsole.textContent = '[BP] Breakpoint at B:00 — LOAD CR15 (paused before execution)';
            return false;
        },
        document: { getElementById: id => id === 'editorConsole' ? editorConsole : null },
        lastMethodTableSize: 0,
        bootAnimating: false,
        _bootAnimTimer: null,
        pipelineViz: null,
        _bootAuditAccum: [],
        console,
    };
    vm.runInNewContext(`${extractFunction(runSource, 'stepSim')}; stepSim();`, context);
    assert.strictEqual(instantBootCalls, 1);
    assert.match(editorConsole.textContent, /paused before execution/);
    assert.doesNotMatch(editorConsole.textContent, /failed|halted/);

    // The same Step path still labels a genuine halted return as failure.
    context.sim.halted = true;
    context.instantBoot = () => {
        instantBootCalls++;
        return false;
    };
    context.stepSim();
    assert.strictEqual(instantBootCalls, 2);
    assert.strictEqual(
        editorConsole.textContent,
        'Auto-boot failed — machine halted during boot sequence');
}

console.log('boot LOAD CR15 breakpoint regressions passed');