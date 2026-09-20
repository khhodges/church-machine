'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

global.ChurchAssembler = require('./assembler.js');
const CLOOMCCompiler = require('./cloomc_compiler.js');

const revision = 'a'.repeat(64);
const authorities = {
    SelfTest: {
        source: 'embedded-binary',
        embedded: true,
        token: '4a000006',
        selectedToken: '4a000006',
        revision,
        selectedRevision: revision,
        api: { methods: [{ name: 'Run', index: 3 }] },
    },
    WukongCallHome: {
        source: 'embedded-binary',
        embedded: true,
        token: '4a000007',
        selectedToken: '4a000007',
        revision,
        selectedRevision: revision,
        api: { methods: [{ name: 'Main', index: 5 }] },
    },
};

const source = `abstraction AuthorityHandoff {
    capabilities {
        SELF E,
        SelfTest E,
        WukongCallHome E
    }
    method Start() {
        CALL CR6[SelfTest], Run
        CALL CR6[WukongCallHome], Main
        SWITCH CR12, CR6, #1
    }
}`;

// Browser-equivalent compile: a local C-list row must beat an unrelated NS[53]
// symbol, and selectors must come from this request's embedded APIs without a
// manually seeded METHOD_REGISTER_CONVENTIONS global.
ChurchAssembler._sharedNsSymbols = { SelfTest: 53, SELFTEST: 53 };
ChurchAssembler._sharedMethodConventions = {};
const browser = new CLOOMCCompiler().compile(source, [], {
    callApiAuthorities: authorities,
});
assert.deepEqual(browser.errors, [], browser.errors.map(e => e.message).join('\n'));
const code = browser.methods[0].code;
assert.equal((code[0] >>> 27) & 0x1F, 2);
assert.equal(code[0] & 0x1F, 1);
assert.equal((code[0] >>> 5) & 0x7F, 4);
assert.equal(code[1] & 0x1F, 2);
assert.equal((code[1] >>> 5) & 0x7F, 6);

// Real subprocess/worker-thread compile. The worker starts with no browser
// convention globals; the private server-prepared authority snapshot must make
// the same source compile successfully.
const worker = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'compile_worker.js')], {
    input: JSON.stringify({
        source,
        language: 'javascript',
        _resolved_call_api_authorities: authorities,
    }),
    encoding: 'utf8',
});
assert.equal(worker.status, 0, worker.stderr);
const workerResult = JSON.parse(worker.stdout);
assert.equal(workerResult.ok, true, workerResult.error);
assert.deepEqual(workerResult.warnings, []);

// An exact selected binary with no declared methods is proof of absence, not an
// invitation to use stale aliases. This mirrors the current saved SelfTest and
// WukongCallHome artifacts and must remain an authoritative error.
const absent = Object.fromEntries(Object.entries(authorities).map(([name, value]) => [
    name,
    { ...value, api: { methods: [] } },
]));
const rejected = new CLOOMCCompiler().compile(source, [], {
    callApiAuthorities: absent,
});
assert(rejected.errors.some(e =>
    e.code === 'CALL_API_METHOD_INVALID' && e.petname === 'SelfTest'));
assert(rejected.errors.some(e =>
    e.code === 'CALL_API_METHOD_INVALID' && e.petname === 'WukongCallHome'));

console.log('compile worker CALL API handoff tests passed');