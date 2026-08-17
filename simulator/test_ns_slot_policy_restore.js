'use strict';
// test_ns_slot_policy_restore.js — Regression tests for Task #2726
//
// Confirms that ns_slot_policy and ns_slot stored in the sidecar/detail
// response are correctly pre-populated in the ADD modal when the same LUMP
// is re-added after removal.
//
// Run:  node simulator/test_ns_slot_policy_restore.js
//
// Coverage:
//   T101 — _nsPopulateAddMeta pre-selects 'static' policy from sidecar (cache-hit)
//   T102 — _nsPopulateAddMeta pre-fills ns_slot value from sidecar (cache-hit)
//   T103 — _nsPopulateAddMeta defaults to 'dynamic' when sidecar has no policy
//           and ns_slot is null
//   T104 — _nsPopulateAddMeta infers 'static' when ns_slot is set but
//           ns_slot_policy is absent (backward compat with old sidecars)
//   T105 — Full lifecycle: _nsTableAddConfirm() installs at slot=9 (static),
//           PATCH payload is verified, state is cleared (simulate removal +
//           modal reopen), then _nsPopulateAddMeta runs through the live fetch
//           path and asserts the correct policy/slot are pre-selected from the
//           persisted sidecar.
//   T106 — _nsPopulateAddMeta pre-selects 'dynamic' when sidecar explicitly
//           sets ns_slot_policy='dynamic' (even if a slot is also stored)
//   T107 — _nsPopulateAddMeta sets ns_slot input to empty when ns_slot is null

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ChurchSimulator     = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

// ── Source extraction ─────────────────────────────────────────────────────────
//
// Extracts a top-level function definition (sync or async) from a source file.
// Counts { / } to locate the closing brace.  Works for both
//   function foo(    and
//   async function foo(

function extractTopLevelFn(sourceFile, fnName) {
    const src   = fs.readFileSync(path.join(__dirname, sourceFile), 'utf8');
    const lines = src.split('\n');
    const startRe = new RegExp(`^(?:async\\s+)?function\\s+${fnName}\\s*\\(`);
    let collecting = false;
    let depth = 0;
    const buf = [];

    for (const line of lines) {
        if (!collecting && startRe.test(line)) {
            collecting = true;
        }
        if (!collecting) continue;

        buf.push(line);
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && buf.length > 1) break;
    }

    if (buf.length === 0) {
        throw new Error(`extractTopLevelFn: "${fnName}" not found in ${sourceFile}`);
    }
    return buf.join('\n');
}

const populateAddMetaSrc = extractTopLevelFn('app-memory.js', '_nsPopulateAddMeta');
const confirmFnSrc       = extractTopLevelFn('app-memory.js', '_nsTableAddConfirm');

// ── Extract shared helper definitions from the unit-test export marker ────────
//
// _nsPopulateAddMeta and _nsTableAddConfirm now call _nsSlotPolicyResolve and
// _nsSlotPersistRecord (defined inside the NS_SLOT_PERSIST_UNIT_TEST_EXPORT
// marker block).  VM sandboxes that load the production functions must also
// load the helpers or they get ReferenceError at the call sites.
const _appMemorySrc = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const _MSTART = 'NS_SLOT_PERSIST_UNIT_TEST_EXPORT_START';
const _MEND   = 'NS_SLOT_PERSIST_UNIT_TEST_EXPORT_END';
const _msi = _appMemorySrc.indexOf('/* ---- ' + _MSTART);
const _mei = _appMemorySrc.indexOf(_MEND + ' ---- */');
if (_msi === -1 || _mei === -1) {
    throw new Error('NS_SLOT_PERSIST_UNIT_TEST_EXPORT markers not found in app-memory.js');
}
const helpersSrc = _appMemorySrc.slice(_msi, _mei + _MEND.length + ' ---- */'.length);

// ── Simulator factory ─────────────────────────────────────────────────────────

function makeTestSim() {
    const sim = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    sim.bootComplete = true;
    return sim;
}

// ── Minimal LUMP binary (cw=1, cc=1, lumpSize=64 words) ──────────────────────

const MAGIC    = 0x1F << 27;
const N_M6     = 0;
const LUMP_HDR = (MAGIC | (N_M6 << 23) | (1 << 10) | 1) >>> 0;

function makeWords(hdr) {
    const words = new Array(64).fill(0);
    words[0] = hdr;
    return words;
}

// ── HTML inspection helpers ───────────────────────────────────────────────────
//
// The rendered HTML uses:
//   <option value="static"  selected>   or   <option value="dynamic" selected>
// and:
//   <input ... id="_nsSlotInput" ... value="9" ...>

function selectedPolicy(html) {
    const m = html.match(/<option\s+value="(static|dynamic)"[^>]*selected/);
    return m ? m[1] : null;
}

function nsSlotInputValue(html) {
    // Try: id="_nsSlotInput" before value=
    const m1 = html.match(/id="_nsSlotInput"[^>]*value="([^"]*)"/);
    if (m1) return m1[1];
    // Try: value= before id=
    const m2 = html.match(/value="([^"]*)"[^>]*id="_nsSlotInput"/);
    return m2 ? m2[1] : null;
}

// ── Cache-hit sandbox factory ─────────────────────────────────────────────────
//
// Creates a VM sandbox where _nsAddCurrentToken is already set so
// _nsPopulateAddMeta takes the cache-hit path (no fetch() required).
// Used by T101–T104 and T106–T107 to test the sidecar-to-HTML mapping
// independently of the network layer.

function makeCacheHitSandbox(sim, detailSidecar) {
    const elements = {};
    function makeEl(id, extra) {
        const el = Object.assign({ id, innerHTML: '', disabled: false, value: '', title: '' }, extra || {});
        elements[id] = el;
        return el;
    }
    const container  = makeEl('_nsAddMeta');
    const confirmBtn = makeEl('_nsAddConfirmBtn');
    makeEl('_nsAddSelect', { value: detailSidecar.token });

    const token = detailSidecar.token;
    const words = makeWords(LUMP_HDR);

    const sandbox = {
        sim,
        window: {
            _nsAddCurrentToken:         token,
            _nsAddCurrentWords:         words,
            _nsAddCurrentDetailSidecar: detailSidecar,
            _nsAddCurrentSidecar:       null,
            _nsAddAvailableList:        [detailSidecar],
        },
        document: {
            getElementById(id) { return elements[id] || null; },
        },
        Promise,
        console,
    };

    const ctx = vm.createContext(sandbox);
    // Inject shared helpers first — _nsPopulateAddMeta calls them.
    vm.runInContext(helpersSrc,         ctx, { filename: 'app-memory.js[helpers]'  });
    vm.runInContext(populateAddMetaSrc, ctx, { filename: 'app-memory.js' });
    return { ctx, container, sandbox };
}

async function runPopulate(detailSidecar) {
    const sim = makeTestSim();
    const { ctx, container } = makeCacheHitSandbox(sim, detailSidecar);
    await vm.runInContext(
        `_nsPopulateAddMeta(${JSON.stringify(detailSidecar.token)})`,
        ctx
    );
    return container.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════════
// T101 — 'static' policy pre-selected when sidecar says static (cache-hit)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T101: static policy pre-selected from sidecar (cache-hit path) ---');
(async () => {
    const sidecar = {
        token: 'ab000101',
        abstraction: 'TestStatic',
        ns_slot_policy: 'static',
        ns_slot: 9,
        cw: 1, cc: 1,
        content_type: 'code',
        grants: ['E'],
    };
    const html = await runPopulate(sidecar);
    check('T101: _nsSlotPolicy select pre-selects "static"',
        selectedPolicy(html) === 'static');
})().catch(e => { console.error('T101 error:', e); fail++; });

// ═══════════════════════════════════════════════════════════════════════════════
// T102 — ns_slot number pre-filled in input (cache-hit)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T102: ns_slot value pre-filled in input (cache-hit path) ---');
(async () => {
    const sidecar = {
        token: 'ab000102',
        abstraction: 'TestSlotFill',
        ns_slot_policy: 'static',
        ns_slot: 9,
        cw: 1, cc: 1,
        content_type: 'code',
        grants: ['E'],
    };
    const html = await runPopulate(sidecar);
    check('T102: _nsSlotInput has value "9"',
        nsSlotInputValue(html) === '9');
})().catch(e => { console.error('T102 error:', e); fail++; });

// ═══════════════════════════════════════════════════════════════════════════════
// T103 — 'dynamic' is default when both ns_slot_policy and ns_slot are absent
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T103: dynamic default when sidecar has no policy or slot ---');
(async () => {
    const sidecar = {
        token: 'ab000103',
        abstraction: 'TestDynDefault',
        cw: 1, cc: 1,
        content_type: 'code',
        grants: ['E'],
    };
    const html = await runPopulate(sidecar);
    check('T103: _nsSlotPolicy defaults to "dynamic" when both fields absent',
        selectedPolicy(html) === 'dynamic');
    check('T103: _nsSlotInput is empty when ns_slot absent',
        nsSlotInputValue(html) === '');
})().catch(e => { console.error('T103 error:', e); fail++; });

// ═══════════════════════════════════════════════════════════════════════════════
// T104 — 'static' inferred from ns_slot when ns_slot_policy not stored
//         (backward compat with sidecars written before the policy field existed)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T104: static inferred from ns_slot when policy field absent ---');
(async () => {
    const sidecar = {
        token: 'ab000104',
        abstraction: 'TestInferred',
        ns_slot: 5,
        cw: 1, cc: 1,
        content_type: 'code',
        grants: ['E'],
    };
    const html = await runPopulate(sidecar);
    check('T104: policy inferred as "static" when ns_slot is set but policy absent',
        selectedPolicy(html) === 'static');
})().catch(e => { console.error('T104 error:', e); fail++; });

// ═══════════════════════════════════════════════════════════════════════════════
// T105 — Full re-add lifecycle
//
// Phase 1 — Install (_nsTableAddConfirm):
//   DOM fields set to: loadMode=lazy, slotPolicy=static, slotInput=9, gtType=1.
//   _nsTableAddConfirm() is run; the PATCH fetch call to persist policy/slot is
//   intercepted and its payload verified.
//
// Phase 2 — Remove / modal reopen:
//   _nsAddCurrentToken, _nsAddCurrentWords, _nsAddCurrentDetailSidecar are all
//   cleared (exactly as _nsTableAdd() does before showing the ADD modal again).
//   This forces _nsPopulateAddMeta to take the live fetch path, not the
//   cache-hit branch.
//
// Phase 3 — Re-open (fetch path):
//   fetch is re-mocked to serve the persisted sidecar (ns_slot_policy='static',
//   ns_slot=9) from /api/lumps/<token>/detail and a valid binary from /words.
//
// Phase 4 — Assert pre-selection:
//   _nsPopulateAddMeta completes; container.innerHTML must show "static" selected
//   and the slot input pre-filled with "9".
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T105: full install → remove → re-add (fetch path) ---');
(async () => {
    const TOKEN     = 'ab000105';
    const SLOT      = 12;   // slots 0-10 are pre-occupied by the boot catalog
    const POLICY    = 'static';
    const LUMP_NAME = 'TestReAdd';

    const sim = makeTestSim();
    const words = makeWords(LUMP_HDR);

    // ── DOM element registry ──────────────────────────────────────────────────
    const elements = {};
    function makeEl(id, extra) {
        // remove() is needed because _doInstall calls _overlay.remove() to
        // dismiss the modal after installing.  All other default values keep
        // the DOM stubs non-null so guards like `if (errEl)` pass normally.
        const el = Object.assign(
            { id, innerHTML: '', disabled: false, value: '', title: '',
              textContent: '', remove() {} },
            extra || {}
        );
        elements[id] = el;
        return el;
    }

    const container  = makeEl('_nsAddMeta');
    makeEl('_nsAddConfirmBtn', { textContent: 'Install' });
    makeEl('_nsAddError');
    makeEl('_nsAddModalOverlay');
    makeEl('nsSaveBtn');

    const selectEl = makeEl('_nsAddSelect', {
        value: TOKEN,
        options: [{ text: LUMP_NAME }],
        selectedIndex: 0,
    });
    makeEl('_nsSlotInput',  { value: String(SLOT)  });
    makeEl('_nsGtType',     { value: '1'           });
    makeEl('_nsSlotPolicy', { value: POLICY        });

    // ── Persisted sidecar: what /detail returns after PATCH is committed ──────
    const persistedSidecar = {
        token:           TOKEN,
        abstraction:     LUMP_NAME,
        ns_slot_policy:  POLICY,
        ns_slot:         SLOT,
        cw: 1, cc: 1,
        content_type:    'code',
        grants:          ['E'],
    };
    const leanSidecar = {
        token:       TOKEN,
        abstraction: LUMP_NAME,
        ns_slot:     null,
        cw: 1, cc: 1,
        grants:      ['E'],
    };

    // ── Phase 1 fetch mock: intercept PATCH, stub everything else ─────────────
    let patchPayload = null;
    function installFetch(url, opts) {
        if (opts && opts.method === 'PATCH' && url.includes('/meta')) {
            patchPayload = JSON.parse(opts.body || '{}');
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }

    // ── Phase 3 fetch mock: serve persisted sidecar ───────────────────────────
    function reopenFetch(url) {
        if (url.includes('/detail')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(persistedSidecar) });
        }
        if (url.includes('/words')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(words) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }

    // ── Sandbox ───────────────────────────────────────────────────────────────
    const sandbox = {
        sim,
        window: {
            _nsAddCurrentToken:         TOKEN,
            _nsAddCurrentWords:         words,
            _nsAddCurrentDetailSidecar: null,
            _nsAddCurrentSidecar:       leanSidecar,
            _nsAddAvailableList:        [leanSidecar],
            _nsTableDirty:              false,
        },
        document: {
            getElementById(id)  { return elements[id] || null; },
            querySelector(sel)  {
                if (sel === 'input[name="_nsLoadMode"]:checked') return { value: 'lazy' };
                return null;
            },
        },
        fetch: installFetch,
        _setNsDirty(d) { sandbox.window._nsTableDirty = Boolean(d); },
        updateNamespace() {},
        Promise,
        setImmediate,
        console,
    };

    const ctx = vm.createContext(sandbox);
    // Inject shared helpers first — both production functions call them.
    vm.runInContext(helpersSrc,          ctx, { filename: 'app-memory.js[helpers]'  });
    vm.runInContext(confirmFnSrc,        ctx, { filename: 'app-memory.js[confirm]'  });
    vm.runInContext(populateAddMetaSrc,  ctx, { filename: 'app-memory.js[populate]' });

    // ── Phase 1: Install ──────────────────────────────────────────────────────
    vm.runInContext('_nsTableAddConfirm()', ctx);
    // Drain microtasks: fire-and-forget fetch calls (including PATCH) execute here
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    check('T105a: PATCH /api/lump/<token>/meta was called during _nsTableAddConfirm',
        patchPayload !== null);
    check('T105b: PATCH payload ns_slot_policy is "static"',
        patchPayload !== null && patchPayload.ns_slot_policy === 'static');
    check('T105c: PATCH payload ns_slot is 9',
        patchPayload !== null && patchPayload.ns_slot === SLOT);
    check('T105d: NS slot 9 is now valid in sim after install',
        sim.isNSEntryValid(SLOT));

    // ── Phase 2: Remove — clear state exactly as _nsTableAdd() does ──────────
    sandbox.window._nsAddCurrentToken         = null;
    sandbox.window._nsAddCurrentWords         = null;
    sandbox.window._nsAddCurrentDetailSidecar = null;
    sandbox.window._nsAddCurrentSidecar       = null;
    sandbox.window._nsAddAvailableList        = [leanSidecar];
    selectEl.value = TOKEN;

    // ── Phase 3: Re-open — switch to persisted-sidecar fetch mock ────────────
    sandbox.fetch = reopenFetch;

    // ── Phase 4: _nsPopulateAddMeta through the live fetch path ──────────────
    // _nsAddCurrentToken is null so it cannot take the cache-hit branch.
    await vm.runInContext(`_nsPopulateAddMeta(${JSON.stringify(TOKEN)})`, ctx);

    const html = container.innerHTML;
    check('T105e: policy pre-selected as "static" on re-add (live fetch path)',
        selectedPolicy(html) === 'static');
    check('T105f: slot input pre-filled with "9" on re-add (live fetch path)',
        nsSlotInputValue(html) === String(SLOT));
})().catch(e => { console.error('T105 error:', e); fail++; });

// ═══════════════════════════════════════════════════════════════════════════════
// T106 — explicit 'dynamic' policy pre-selected even when ns_slot is also stored
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T106: explicit dynamic policy takes precedence over ns_slot presence ---');
(async () => {
    const sidecar = {
        token: 'ab000106',
        abstraction: 'TestDynExplicit',
        ns_slot_policy: 'dynamic',
        ns_slot: 7,
        cw: 1, cc: 1,
        content_type: 'code',
        grants: ['E'],
    };
    const html = await runPopulate(sidecar);
    check('T106: explicit ns_slot_policy="dynamic" wins over ns_slot presence heuristic',
        selectedPolicy(html) === 'dynamic');
})().catch(e => { console.error('T106 error:', e); fail++; });

// ═══════════════════════════════════════════════════════════════════════════════
// T107 — ns_slot input is empty when ns_slot is null (dynamic LUMP)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- T107: ns_slot input empty when ns_slot is null ---');
(async () => {
    const sidecar = {
        token: 'ab000107',
        abstraction: 'TestNullSlot',
        ns_slot_policy: 'dynamic',
        ns_slot: null,
        cw: 1, cc: 1,
        content_type: 'code',
        grants: ['E'],
    };
    const html = await runPopulate(sidecar);
    check('T107: _nsSlotInput value is empty string when ns_slot=null',
        nsSlotInputValue(html) === '');
})().catch(e => { console.error('T107 error:', e); fail++; });

// ── Final summary ─────────────────────────────────────────────────────────────
setImmediate(() => setImmediate(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}));
