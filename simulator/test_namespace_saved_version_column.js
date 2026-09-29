'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const start = source.indexOf('function _nsAssignedLumpFreshness(');
const endMarker = 'window._nsRenderSavedVersionCell = _nsRenderSavedVersionCell;';
const end = source.indexOf(endMarker);
assert(start >= 0 && end >= 0, 'Namespace saved-version helpers are present');

const context = {
    window: {
        _nsState: null,
    },
    Number,
    String,
    _escHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end + endMarker.length), context);

function state(warnings, status = 'stale') {
    return { executionFreshness: { status, warnings } };
}

const assigned = {
    slot: 7,
    filename: 'Demo.v7.lump',
    token: '00000007',
    binary_hash: '7'.repeat(64),
    lump_version: 7,
    issue_n: 907,
};
const warning = {
    slot: 7,
    selected: { filename: 'Demo.v7.lump', token: '00000007', version: 7 },
    latest: { filename: 'Demo.v8.lump', token: '00000008', version: 8 },
};
const stale = context._nsAssignedLumpFreshness(7, assigned, state([warning]));
const staleCell = context._nsRenderSavedVersionCell(assigned, stale);
assert(staleCell.includes('>v7</a>'), 'renders the exact committed saved version as a link');
assert(staleCell.includes('ns-saved-version-stale'), 'red/stale class requires a proven version difference');
assert(staleCell.includes('color:#f87171'), 'different saved version renders red');
assert(staleCell.includes('latest eligible saved revision v8'), 'explains the exact comparison');
assert(staleCell.includes('_nsOpenSavedVersion(7)'),
    'version link targets the committed Namespace slot');

let openedIdentity = null;
context.window._nsState = { abstractions: [assigned] };
context.window._openSavedLumpVersionDetails = identity => {
    openedIdentity = identity;
};
assert.strictEqual(context._nsOpenSavedVersion(7), true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(openedIdentity)), {
    slot: 7,
    token: assigned.token,
    filename: assigned.filename,
    binary_hash: assigned.binary_hash,
    lump_version: 7,
    abstraction: null,
}, 'click uses the exact committed filename/token/hash/version, not latest freshness');

const current = context._nsAssignedLumpFreshness(
    7, assigned, state([], 'current'));
const currentCell = context._nsRenderSavedVersionCell(assigned, current);
assert(currentCell.includes('>v7</a>'));
assert(!currentCell.includes('ns-saved-version-stale'));
assert(!currentCell.includes('color:#f87171'));

const sameVersionDifferentArtifact = context._nsAssignedLumpFreshness(7, assigned, state([{
    slot: 7,
    selected: { filename: assigned.filename, token: assigned.token, version: 7 },
    latest: { filename: 'Demo.corrected.lump', token: '00000008', version: 7 },
}]));
const sameVersionCell = context._nsRenderSavedVersionCell(
    assigned, sameVersionDifferentArtifact);
assert(!sameVersionCell.includes('ns-saved-version-stale'),
    'an exact-artifact freshness warning is not a saved-version difference');

const missingCell = context._nsRenderSavedVersionCell({
    slot: 7,
    issue_n: 22,
    sequence: 33,
    token: '00000016',
}, { status: 'stale', selected: { version: 22 }, latest: { version: 23 } });
assert(missingCell.includes('>NA</td>'));
assert(!missingCell.includes('<a '), 'NA without an exact saved artifact is not clickable');
assert(!missingCell.includes('ns-saved-version-stale'));
assert(!missingCell.includes('color:#f87171'),
    'missing saved versions remain neutral and do not infer issue/sequence/token');

const contradictoryCell = context._nsRenderSavedVersionCell(assigned, {
    status: 'stale',
    selected: { version: 6 },
    latest: { version: 8 },
});
assert(contradictoryCell.includes('>v7</a>'));
assert(!contradictoryCell.includes('ns-saved-version-stale'),
    'contradictory comparison metadata does not make the committed version red');

const incompleteArtifactCell = context._nsRenderSavedVersionCell({
    slot: 8,
    filename: 'Demo.v8.lump',
    token: '00000008',
    lump_version: 8,
}, { status: 'current' });
assert(incompleteArtifactCell.includes('>v8</td>'));
assert(!incompleteArtifactCell.includes('<a '),
    'saved version without exact binary-hash evidence remains nonclickable');
context.window._nsState = { abstractions: [{
    slot: 8,
    filename: 'Demo.v8.lump',
    token: '00000008',
    lump_version: 8,
}] };
openedIdentity = null;
assert.strictEqual(context._nsOpenSavedVersion(8), false);
assert.strictEqual(openedIdentity, null, 'incomplete committed identity does not navigate');

const legacyVersionZero = {
    slot: 9,
    filename: 'Ethernet.1.b169bba4.lump',
    token: 'b169bba4',
    binary_hash: '9'.repeat(64),
    lump_version: 0,
};
const legacyCell = context._nsRenderSavedVersionCell(
    legacyVersionZero, { status: 'current' });
assert(legacyCell.includes('>v0</a>'),
    'authoritatively recovered legacy version zero is visible and clickable');
context.window._nsState = { abstractions: [legacyVersionZero] };
openedIdentity = null;
assert.strictEqual(context._nsOpenSavedVersion(9), true);
assert.strictEqual(openedIdentity.lump_version, 0);

assert(source.includes(
    '<th>Idx</th><th class="ns-saved-version-col">v#</th><th class="ns-label-col">Label</th>'),
'v# header is between Idx and Label');
assert(source.includes('html += _savedVersionCell;\n            const _gapLabel'),
    'rows without live entries render a version cell');
assert(source.includes('html += _savedVersionCell;\n            html += `<td class="ns-label'),
    'private rows render a version cell before Label');
assert(source.includes('<td colspan="7" style="color:#777;font-size:0.78rem;">Lockbox'),
    'private rows retain the full table width with the new version column');
assert(source.includes('html += _savedVersionCell;\n        let nsLabelInner'),
    'normal rows render a version cell before Label');

console.log('Namespace saved version column tests passed');