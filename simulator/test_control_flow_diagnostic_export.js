'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Simulator = require('./simulator.js');
const source = fs.readFileSync(require.resolve('./app-shell.js'), 'utf8');
const start = source.indexOf('    sim.setControlFlowDiagnosticContextProvider');
const end = source.indexOf('    _verifyServedSimulatorAsset();', start);
assert.ok(start >= 0 && end > start);
const sim = new Simulator();
let clicked = false, revoked = false;
const context = {
    sim, window: {}, Blob,
    _executionIdentityGet: () => ({ token: 'synthetic-only', status: 'unverified' }),
    URL: {
        createObjectURL: blob => { assert.equal(blob.type, 'application/json'); return 'blob:test'; },
        revokeObjectURL: url => { assert.equal(url, 'blob:test'); revoked = true; },
    },
    document: { createElement: () => ({ click() { clicked = true; } }) },
    setTimeout: fn => fn(),
};
vm.runInNewContext(source.slice(start, end), context);
sim.recordControlFlowDiagnostic('UI_STOP', { stopReason: 'breakpoint' });
const api = context.window.SimulatorControlFlowDiagnostics;
const captured = api.get();
assert.equal(captured.events.at(-1).externalContext.executionIdentity.token, 'synthetic-only');
captured.events.length = 0;
assert.ok(api.get().events.length > 0);
const html = fs.readFileSync(require.resolve('./index.html'), 'utf8');
const button = html.match(/<button\b[^>]*id="downloadSimDiagnosticsBtn"[^>]*>Download diagnostics<\/button>/);
assert.ok(button, 'visible diagnostics download button exists');
const handler = button[0].match(/onclick="([^"]+)"/)[1];
const beforeDownload = JSON.stringify(sim.getControlFlowDiagnostics());
vm.runInNewContext(handler, context);
assert.equal(JSON.stringify(sim.getControlFlowDiagnostics()), beforeDownload,
    'button export does not execute, reset, or clear the capture');
assert.ok(clicked && revoked);
assert.ok(fs.readFileSync(require.resolve('./app-run.js'), 'utf8')
    .includes("sim.recordControlFlowDiagnostic('UI_STOP', { stopReason, breakpointAddr });"));
console.log('PASS detached browser control-flow export and stop wiring');