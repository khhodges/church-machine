#!/usr/bin/env node
// Executable client-side Add + Save harness. The server test feeds it only a
// private fixture image, then POSTs the actual browser-generated payload to
// the real protected Flask route with isolated artifact paths.
'use strict';

const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('crypto');
const ChurchSimulator = require('./simulator.js');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync(require('path').join(__dirname, 'app-memory.js'), 'utf8');
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
global.window = { bootConfig: input.config };
const sim = new ChurchSimulator();
const image = Buffer.from(input.image, 'base64');
const ab = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
if (!sim.loadBootImage(ab)) throw new Error(sim.lastBootImageError);
for (const row of input.state.abstractions) {
    if (row && Number.isInteger(row.slot) && sim.isNSEntryValid(row.slot)) {
        sim.nsLabels[row.slot] = row.name;
    }
}
let original = Buffer.from(sim.memory.buffer, 0, sim.NS_TABLE_BASE * 4);
const selected = input.selection;
const elements = {
    _nsPlacementName: { value: selected.name },
    _nsPlacementSlot: { value: '14' },
    _nsAddSelect: { selectedIndex: selected.record ? 1 : 0 },
    _nsAddError: { textContent: '' },
    _nsAddPlacementBtn: { disabled: false, textContent: '' },
    nsSaveBtn: { disabled: false, textContent: '', style: {} },
    _nsAddModalOverlay: { remove() {} },
    _nsSlotInput: { value: '14' },
    _nsSlotPolicy: { value: 'static' },
    _nsLoadPolicy: { value: 'Resident' },
    _nsGtType: { value: '1' },
    _nsAddConfirmBtn: { disabled: false, textContent: '' },
};
elements._nsAddSelect = {
    selectedIndex: selected.record ? 1 : 0,
    value: selected.record ? selected.record.token : '',
    options: [{ text: '' }, { text: selected.name }],
};
let payload = null;
const payloads = [];
const windowState = {
    bootConfig: input.config,
    _nsState: Object.assign({}, input.state, {
        namespaceFingerprint: input.fingerprint
    }),
    _nsTableSaveError: null,
    _nsTableSaveCancelled: false,
    _nsAddAvailableList: selected.record ? [selected.record] : [],
    _nsAddInspectionPending: false,
    _nsAddCurrentWords: input.aliceWords || null,
    _nsAddCurrentToken: selected.record ? selected.record.token : null,
    _nsAddCurrentCatalogIndex: selected.record ? 0 : null,
    _nsAddCurrentApproval: null,
    _nsAddCurrentInspection: { apiDefinition: { name: 'ide.Alice' } },
    _nsAddExecutableReceipt: input.aliceWords ? {
        token: selected.record.token,
        catalogIndex: 0,
        filename: selected.record.filename,
        approved: false,
        binaryHash: selected.record.binary_hash,
    } : null,
    _nsExplicitArtifactBindings: {},
    _nsPrefetchDirty: false,
    confirm: () => true,
    _ensureNamespaceBuildConfig: async () => input.config,
};
if (input.pending) {
    const words = input.aliceWords;
    const header = sim.parseLumpHeader(words[0]);
    const location = sim.findFreeLumpRange(header.lumpSize);
    if (location === null) throw new Error('No room for isolated pending Alice');
    for (let index = 0; index < header.lumpSize; index++) {
        sim.writePersistentWord(location + index, words[index]);
    }
    sim.withNamespaceWrite('simulate browser pending Install from earlier version', () => {
        sim.writeNSEntry(14, location, header.cw, 0, 0, 1,
            sim._nsSequenceForWrite(14), header.cc, 0);
    });
    sim.nsLabels[14] = 'ide.Alice';
    const seq = sim.parseNSWord1(sim.readNSEntry(14).word1_limit).gtSeq;
    windowState._nsExplicitArtifactBindings['14'] = {
        name: 'ide.Alice', slot: 14, seq,
        token: selected.record.token, filename: selected.record.filename,
        binary_hash: selected.record.binary_hash,
        resident: true, boot_resident: true, load_policy: 'Resident',
    };
    original = Buffer.from(sim.memory.buffer, 0, sim.NS_TABLE_BASE * 4);
}
const ctx = {
    window: windowState, sim,
    bootEntrySlot: input.state.abstractions.find(row => row.boot === true).slot,
    document: { getElementById: name => elements[name] || null },
    fetch: async (url, opts) => {
        if (url === '/api/boot-image/save-ns') {
            payload = JSON.parse(opts.body);
            payloads.push(payload);
            return { ok: false, status: 409 };
        }
        throw new Error('Unexpected fetch: ' + url);
    },
    _actionableJsonResponse: async () => {
        throw new Error('generate_boot_image: Namespace slot 14 exact hash-bound approval required: no compiler admission record matches the exact SHA-256');
    },
    _setNsDirty: () => {},
    updateNamespace: () => {},
    _renderBootExecutionFreshness: () => {},
    _formatActionableNetworkError: (_operation, error) => String(error.message || error),
    crypto: webcrypto,
    btoa, Uint8Array, Uint32Array, Buffer, console, setTimeout,
};
vm.createContext(ctx);
vm.runInContext(part('function _nsInheritSavedArtifactMetadata(', '(function _initNsStateFetch()'), ctx);
vm.runInContext(part('async function _nsAddPlacementConfirm()', 'async function _nsOpenNewAssembler()'), ctx);
vm.runInContext(part('async function _nsHashImmutableWords(', 'function _nsMatchingApproval('), ctx);
vm.runInContext(part('function _nsTableAddConfirm()', '// ── NS table: Clear slot'), ctx);
vm.runInContext(part('async function _nsKeepPendingAsPlacement(', '// ── NS table: Clear slot'), ctx);
vm.runInContext(part('window._nsTableSave = async function(btn)', '// ── NS label click'), ctx);
(async () => {
    if (input.pending) {
        await windowState._nsTableSave(elements.nsSaveBtn);
        if (payloads.length !== 1 ||
                payloads[0].ns_state.abstractions.find(row => row.slot === 14).symbolic === true ||
                !original.equals(Buffer.from(sim.memory.buffer, 0, sim.NS_TABLE_BASE * 4))) {
            throw new Error('Rejected executable candidate did not remain in the browser unchanged');
        }
        await vm.runInContext('_nsKeepPendingAsPlacement(14)', ctx);
        if (payloads.length !== 2 || windowState._nsExplicitArtifactBindings['14']) {
            throw new Error('Explicit Keep as design did not submit the retained selected slot');
        }
        process.stdout.write(JSON.stringify(payloads));
        return;
    }
    if (input.aliceWords) {
        vm.runInContext('_nsTableAddConfirm()', ctx);
        for (let attempt = 0; attempt < 60 && !elements._nsAddError.textContent; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        if (!/no trusted executable approval/i.test(elements._nsAddError.textContent) ||
                windowState._nsExplicitArtifactBindings['14'] ||
                !original.equals(Buffer.from(sim.memory.buffer, 0, sim.NS_TABLE_BASE * 4))) {
            throw new Error('Actual Install did not reject unapproved Alice before mutating Namespace bytes: ' +
                elements._nsAddError.textContent);
        }
    }
    await vm.runInContext('_nsAddPlacementConfirm()', ctx);
    if (!payload) throw new Error('Actual Add/Save handlers did not submit a candidate');
    const selectedRow = payload.ns_state.abstractions.find(row => row.slot === 14);
    if (!selectedRow || selectedRow.symbolic !== true ||
            selectedRow.selection.status !== selected.status ||
            selectedRow.location !== '0x00000000' ||
            !original.equals(Buffer.from(sim.memory.buffer, 0, sim.NS_TABLE_BASE * 4))) {
        throw new Error('Add modified resident bytes or submitted an executable row');
    }
    process.stdout.write(JSON.stringify(payload));
})().catch(err => {
    console.error(err);
    process.exitCode = 1;
});