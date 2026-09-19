'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const abstractionsSource = fs.readFileSync(path.join(__dirname, 'app-abstractions.js'), 'utf8');
const faultStyles = fs.readFileSync(path.join(__dirname, 'styles-fault.css'), 'utf8');

for (const [name, context] of [
    ['stepSim', 'Step'],
    ['runSimGo', 'Run'],
    ['runThreadFromModal', 'Thread Run'],
    ['selectThreadContext', 'Thread selection'],
]) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    const body = source.slice(start, source.indexOf('\n}', start) + 2);
    assert(body.includes(`_requireCommittedImageForExecution('${context}')`),
        `${name} blocks fallback execution without a committed image`);
}

assert(source.includes(
    'sim && sim._bootImageLoaded === true'),
    'execution authority requires an image accepted by the simulator');
assert(source.includes(
    '_bootHasCommittedImage()'),
    'execution authority requires the prepared browser cache');
assert(source.includes(
    'this is not a Thread fault'),
    'blocked preparation is explicitly distinguished from an executed Thread fault');
assert(source.includes(
    'No machine instruction ran and no Thread state changed'),
    'blocked preparation reports execution and state-change consequences');
assert(!source.includes("sim.fault('BOOT_IMAGE'"),
    'a boot-image preparation rejection is not recorded as a machine fault');
assert(source.includes(
    'The server rejected the committed boot image:'),
    'the server rejection reason is preserved for the programmer');
assert(source.includes(
    "prepare.textContent = 'Prepare boot image'"),
    'the rejection offers an explicit preparation action');
assert(abstractionsSource.includes(
    'class="abs-boot-binding-status ${stateClass}"'),
    'the persistent preparation diagnostic uses its responsive layout');
assert(abstractionsSource.includes(
    '>Prepare boot image</button>'),
    'stale preparation state offers a named explicit action');
assert(faultStyles.includes('.execution-blocked-dialog'),
    'blocked execution has a distinct diagnostic treatment');
assert(/\.fault-modal-lump-chip\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/.test(faultStyles),
    'long fault location identities wrap without an ellipsis');
assert(/\.fault-modal-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;/.test(faultStyles),
    'fault actions wrap instead of requiring horizontal scrolling');

console.log('committed boot-image execution guard tests passed');