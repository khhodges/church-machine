'use strict';

const fs = require('fs');
const path = require('path');

function extractFunctionSource(src, name) {
    const match = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
    if (!match) throw new Error('Cannot find function ' + name);
    let i = src.indexOf('{', match.index);
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (; i < src.length; i++) {
        const char = src[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
        } else if (char === '{') {
            depth++;
        } else if (char === '}' && --depth === 0) {
            return src.slice(match.index, i + 1);
        }
    }
    throw new Error('Unterminated function ' + name);
}

const source = fs.readFileSync(
    path.resolve(__dirname, 'app-memory.js'), 'utf8');
const freshnessSource = extractFunctionSource(source, '_nsAssignedLumpFreshness');
const renderSource = extractFunctionSource(source, '_nsRenderAssignedLumpLabel');
const makeFunctions = new Function('_escHtml',
    freshnessSource + '\n' + renderSource +
    '\nreturn {_nsAssignedLumpFreshness, _nsRenderAssignedLumpLabel};');
const escapeHtml = value => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const { _nsAssignedLumpFreshness: classify, _nsRenderAssignedLumpLabel: render } =
    makeFunctions(escapeHtml);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const assigned = {
    token: '00abc001',
    filename: 'Echo.v1.lump',
    lump_version: 1,
};
const staleState = {
    executionFreshness: {
        status: 'stale',
        warnings: [{
            slot: 12,
            selected: { token: 'abc001', filename: 'Echo.v1.lump', version: 1 },
            latest: { token: '00abc002', filename: 'Echo.v2.lump', version: 2 },
        }],
    },
};
const old = classify(12, assigned, staleState);
assert(old.status === 'stale', 'older exact assigned identity must be stale');
const oldHtml = render('Echo', old);
assert(oldHtml.includes('color:#f87171'), 'stale label must render red');
assert(oldHtml.includes('older saved revision'), 'stale label needs visible status text');
assert(oldHtml.includes('aria-label='), 'stale label needs accessible explanation');
assert(oldHtml.includes('exact assigned binding is unchanged'),
    'tooltip must explain that freshness does not change the binding');

const current = classify(12, assigned, {
    executionFreshness: { status: 'current', warnings: [] },
});
assert(current.status === 'current', 'known latest assigned identity must be current');
assert(render('Echo', current) === 'Echo', 'current label must keep normal rendering');

const unknown = classify(12, assigned, null);
assert(unknown.status === 'unknown', 'unavailable freshness must remain unknown');
assert(render('Echo', unknown) === 'Echo', 'unknown label must not be marked stale');

const mismatchedWarning = classify(12, assigned, {
    executionFreshness: {
        status: 'stale',
        warnings: [{
            slot: 12,
            selected: { token: 'deadbeef', filename: 'Other.lump', version: 1 },
            latest: { token: 'feedface', filename: 'Other.v2.lump', version: 2 },
        }],
    },
});
assert(mismatchedWarning.status === 'current',
    'warning for another exact identity must not mark this label stale');
assert(render('<Echo>', mismatchedWarning) === '&lt;Echo&gt;',
    'normal labels remain escaped');

console.log('PASS namespace assigned-LUMP freshness labels');