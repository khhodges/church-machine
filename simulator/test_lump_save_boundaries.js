'use strict';

// Focused, browser-free regressions for the compiler SELF handoff and the
// actual two-dialog Save-to-Namespace function.  The dialog cases extract the
// production functions rather than reimplementing their branch logic.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ChurchSimulator = require('./simulator.js');
const CapabilityTokens = require('./capability_tokens.js');

let pass = 0;
let fail = 0;
function check(label, condition, detail) {
    if (condition) {
        pass++;
        console.log('PASS ' + label);
    } else {
        fail++;
        console.error('FAIL ' + label + (detail ? ` — ${detail}` : ''));
    }
}

function extractFunction(source, name) {
    let start = source.indexOf(`function ${name}(`);
    if (start >= 6 && source.slice(start - 6, start) === 'async ') start -= 6;
    if (start < 0) throw new Error(`missing ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
            end = i + 1;
            break;
        }
    }
    if (end < 0) throw new Error(`unterminated ${name}`);
    return source.slice(start, end);
}

function lumpHeader(cw, cc) {
    return (((0x1F << 27) | ((cw & 0x1FFF) << 10) | (cc & 0xFF)) >>> 0);
}

console.log('\n--- compiler SELF placeholder boundary ---');
{
    const sim = new ChurchSimulator();
    const placeholder = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER >>> 0;
    const self = {
        name: '__SELF__',
        rights: ['E'],
        compiler_owned_self: true,
    };
    const resolved = CapabilityTokens.resolveCapabilities([self], { sim, lumps: [] });
    const words = new Array(64).fill(0);
    words[63] = placeholder;
    const intermediate = CapabilityTokens.validateClist(
        words, 63, resolved, { sim, allowCompilerSelfPlaceholder: true }
    );
    const final = CapabilityTokens.validateClist(words, 63, resolved, { sim });
    check(
        'compiler-owned row-zero SELF placeholder is accepted only in explicit intermediate mode',
        intermediate.ok && intermediate.results[0].intermediate === true
    );
    check(
        'the same row-zero SELF placeholder is rejected by strict final validation',
        !final.ok && /placeholder/.test(final.errors.join(' '))
    );

    const misplacedWords = new Array(64).fill(0);
    misplacedWords[62] = sim.createGT(0, 4, { E: 1 }, 1) >>> 0;
    misplacedWords[63] = placeholder;
    const misplacedCaps = CapabilityTokens.resolveCapabilities([self, self], { sim, lumps: [] });
    const misplaced = CapabilityTokens.validateClist(
        misplacedWords, 62, misplacedCaps,
        { sim, allowCompilerSelfPlaceholder: true }
    );
    check(
        'row-one compiler SELF marker remains rejected even in intermediate mode',
        !misplaced.ok && /row 0|only in C-list row 0|placeholder/i.test(misplaced.errors.join(' '))
    );

    const dependency = CapabilityTokens.resolveCapabilities(
        [{ name: 'Future.Dependency', rights: ['E'] }],
        { sim, lumps: [] }
    );
    const nonSelfWords = new Array(64).fill(0);
    nonSelfWords[63] = placeholder;
    const nonSelf = CapabilityTokens.validateClist(
        nonSelfWords, 63, dependency,
        { sim, allowCompilerSelfPlaceholder: true }
    );
    check(
        'non-SELF FEED marker is rejected by the intermediate exception',
        !nonSelf.ok && /Future\.Dependency/.test(nonSelf.errors.join(' '))
    );
}

console.log('\n--- authoritative final-byte validator ---');
{
    const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const context = {
        console,
        CapabilityTokens,
        sim: new ChurchSimulator(),
        _lumpsCache: [],
    };
    vm.createContext(context);
    vm.runInContext(
        extractFunction(appRun, '_validateFinalLumpSaveBinary') +
        '\nthis.validateFinal = _validateFinalLumpSaveBinary;',
        context
    );

    const self = {
        name: '__SELF__',
        rights: ['E'],
        compiler_owned_self: true,
    };
    const concrete = new Array(64).fill(0);
    concrete[0] = lumpHeader(1, 1);
    concrete[63] = context.sim.createGT(0, 9, { E: 1 }, 1) >>> 0;
    check(
        'authoritative concrete row-zero SELF passes final-byte validation',
        context.validateFinal(concrete, [self]) === true
    );

    const unresolved = concrete.slice();
    unresolved[63] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER >>> 0;
    assert.throws(
        () => context.validateFinal(unresolved, [self]),
        /failed final c-list validation|placeholder/
    );
    check(
        'authoritative final-byte validation rejects unresolved row-zero SELF',
        true
    );

    const nonSelf = concrete.slice();
    nonSelf[63] = ChurchSimulator.makePendingGT('Future.Dependency');
    assert.throws(
        () => context.validateFinal(nonSelf, [{ name: 'Future.Dependency', rights: ['E'] }]),
        /failed final c-list validation|placeholder/
    );
    check(
        'authoritative final-byte validation rejects unresolved non-SELF FEED',
        true
    );

    const misplaced = new Array(64).fill(0);
    misplaced[0] = lumpHeader(1, 2);
    misplaced[62] = concrete[63];
    misplaced[63] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER >>> 0;
    assert.throws(
        () => context.validateFinal(misplaced, [self, self]),
        /failed final c-list validation|row 0|placeholder/
    );
    check(
        'authoritative final-byte validation rejects misplaced SELF FEED row',
        true
    );
}

console.log('\n--- extracted two-dialog save flow ---');
{
    const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const elements = {};
    const feedback = [];
    const diagnostics = [];
    const toasts = [];
    const sourceElement = { value: 'method Main { RETURN }' };
    const status = { dataset: {}, style: {}, textContent: '' };
    const saveSlot = {
        value: '5',
        options: [{ value: '5', dataset: { nsLabel: 'Flow.Test' } }],
        selectedIndex: 0,
    };
    const defaults = {
        saveNSSlot: saveSlot,
        saveNSLabel: { value: 'Flow.Test' },
        saveNSType: { value: '1' },
        saveNSStatus: status,
        saveNSConfirmBtn: {
            disabled: false, hidden: false, textContent: '',
            setAttribute() {},
        },
        saveNSCancelBtn: { textContent: '' },
        permR: { checked: false },
        permW: { checked: false },
        permX: { checked: false },
        permL: { checked: false },
        permS: { checked: false },
        permE: { checked: true },
        asmEditor: sourceElement,
    };
    Object.assign(elements, defaults);
    const store = new Map();
    const live = {
        token: 'flow-token-1',
        memory: {
            words: [0x12345678],
            capabilities: [],
            registeredAt: 101,
            sourceText: sourceElement.value,
        },
    };
    const registry = {
        getCurrent: () => live.token,
        resolve: token => token === live.token
            ? {
                abstraction: 'Flow.Test',
                sources: { memory: live.memory, server: { language: 'assembly' } },
            } : null,
    };
    const window = {
        LumpRegistry: registry,
        _pendingLumpData: null,
        _saveNSPreparedSnapshot: null,
        _computeLumpToken: () => null,
    };
    const document = {
        getElementById: id => elements[id] || {
            value: '', checked: false, style: {}, dataset: {},
            setAttribute() {},
        },
        querySelector: () => null,
    };
    const context = {
        console,
        window,
        document,
        localStorage: {
            getItem: key => store.has(key) ? store.get(key) : null,
            setItem: (key, value) => store.set(key, String(value)),
        },
        sessionStorage: {
            getItem: key => store.has(key) ? store.get(key) : null,
            setItem: (key, value) => store.set(key, String(value)),
        },
        sim: {
            MAX_NS_ENTRIES: 64,
            memory: new Array(512).fill(0),
            saveNamespaceStartSlot: () => 2,
            readNSEntry: () => null,
        },
        alert: message => { toasts.push({ title: 'alert', body: message }); },
        fetch: () => { throw new Error('network must not run in dialog branch test'); },
        _lumpSaveSubmittedSource: (snapshot, reused) =>
            reused && snapshot ? snapshot.sourceText : '',
        _setSaveNSFeedback: (kind, message) => feedback.push({ kind, message }),
        _preserveStaleLumpSaveDiagnostic: async (snapshot, label) => {
            diagnostics.push({ snapshot, label });
            return { operation_id: 'diag-flow-1' };
        },
        _persistSaveOperationStatus: () => {},
        _discoverLumpSaveDiagnosticCandidate: async () => null,
        _showFpgaToast: (title, body) => toasts.push({ title, body }),
        _validateFinalLumpSaveBinary: () => true,
        CapabilityTokens: undefined,
    };
    vm.createContext(context);
    vm.runInContext(
        extractFunction(appRun, '_cloneLumpSaveCapabilities') + '\n' +
        extractFunction(appRun, '_captureLumpSaveSnapshot') + '\n' +
        extractFunction(appRun, 'confirmSaveToNamespace') +
        '\nthis.capture = _captureLumpSaveSnapshot;' +
        '\nthis.confirm = confirmSaveToNamespace;',
        context
    );

    function pendingData() {
        return {
            token: live.token,
            registeredAt: live.memory.registeredAt,
            binary: [1, 2],
            caps: [],
            sourceText: sourceElement.value,
            selectedProfile: 'api',
            abstractionName: 'Flow.Test',
        };
    }
    function openSecondDialog() {
        window._pendingLumpData = pendingData();
        window._saveNSPreparedSnapshot = context.capture();
        return window._saveNSPreparedSnapshot;
    }

    (async () => {
        const first = openSecondDialog();
        live.token = 'flow-token-2';
        live.memory = {
            words: [0x87654321],
            capabilities: [],
            registeredAt: 202,
            sourceText: sourceElement.value,
        };
        await context.confirm();
        check(
            'Step 2 rejects a stale registry/token snapshot without a network save',
            diagnostics.length === 1 &&
            feedback.at(-1).kind === 'error' &&
            /active LUMP changed/.test(feedback.at(-1).message)
        );
        check(
            'stale registry snapshot remains available for diagnostics',
            diagnostics[0].snapshot === first && window._pendingLumpData !== null
        );

        live.token = 'flow-token-1';
        live.memory = {
            words: [0x12345678],
            capabilities: [],
            registeredAt: 101,
            sourceText: sourceElement.value,
        };
        sourceElement.value = 'method Main { EDITED AFTER OPEN }';
        const editorSnapshot = openSecondDialog();
        sourceElement.value = 'method Main { EDITED WHILE DIALOG OPEN }';
        await context.confirm();
        check(
            'Step 2 rejects editor drift against the captured compiler pair',
            diagnostics[1].snapshot === editorSnapshot &&
            feedback.at(-1).kind === 'error' &&
            /editor changed/.test(feedback.at(-1).message)
        );
        sourceElement.value = 'method Main { RETURN }';
        const cancelled = openSecondDialog();
        let planCalls = 0;
        window._confirmLumpSavePlan = async () => {
            planCalls++;
            return null;
        };
        await context.confirm();
        check(
            'second dialog cancellation records no-save feedback',
            planCalls === 1 && feedback.at(-1).kind === 'info' &&
            /cancelled/.test(feedback.at(-1).message)
        );
        check(
            'cancel preserves the immutable snapshot for a deliberate retry',
            window._saveNSPreparedSnapshot === cancelled &&
            window._pendingLumpData === null
        );

        const failed = openSecondDialog();
        window._confirmLumpSavePlan = async () => {
            throw new Error('authoritative plan rejected');
        };
        await context.confirm();
        check(
            'save-plan errors are surfaced as an incident without commit',
            window._saveNSPreparedSnapshot === failed &&
            feedback.at(-1).kind === 'incident' &&
            toasts.at(-1).title === 'LUMP Save Plan Failed'
        );
    })().then(() => {
        console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
        if (fail) process.exitCode = 1;
    }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}