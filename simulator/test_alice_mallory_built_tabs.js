'use strict';
// Render the actual as-built UI against generated candidate evidence only.
// This does not substitute candidate data into the running IDE.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const evidence = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const panel = {innerHTML: '', offsetParent: {}};
const context = {
    console,
    document: {getElementById: id => id === 'lumpResidentPanel' ? panel : null,
        querySelector: () => null, querySelectorAll: () => []},
    localStorage: {getItem: () => null, setItem() {}},
    addEventListener() {},
    AbortController,
    fetch: async () => ({status: 200, ok: true, json: async () => ({
        imageSha256: evidence.candidateSha256, entries: [], threads: evidence.threads,
        savedNamespaceMatchesBuilt: true, provenanceStatus: 'missing',
    })}),
    ThreadDesign: require('./thread_design'),
    ThreadRegisterDesign: require('./thread-register-design'),
    ThreadTupleDesign: null,
    BOARD_PROFILES: {'wukong-xc7a100t': {totalRamWords: 16384}},
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8'), context);
context.lumpEditorBuiltNamespaceRefresh();
setImmediate(() => {
    for (const [slot, dr, gt, name] of [
        [11, '0xA11CE002', '0x4A000010', 'ide.Alice'],
        [12, '0x0BAD0003', '0x4A000011', 'ide.Mallory'],
    ]) {
        context.lumpEditorBnTab(String(slot));
        const html = panel.innerHTML;
        assert(html.includes(dr) && html.includes(gt) && html.includes(name), `${name} exact registers visible`);
        assert(html.includes('Initial data registers') && html.includes('Initial capability registers'));
        assert(html.includes('0x00000000'), `${name} initialized heap words visible`);
        assert(html.includes('TurnState') && html.includes('initialize'), `${name} tuple definition and policy visible`);
        assert(html.includes(`data-bn-tab="${slot}"`), 'Thread tab is present');
        console.log(`PASS generated candidate as-built tab NS[${slot}]: ${dr}, ${gt}, ${name}`);
    }
});
