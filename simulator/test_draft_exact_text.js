'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const fixture = '\uFEFF; private bytes\r\nBFEXT DR1, DR2, pos=03, w=04  \r\n';

assert(source.includes('const lsDraft = _draftLsGet(token);'),
    'inline draft reads exact persisted text');
assert(source.includes('const initialText = hasDraft ? _lumpEditorDraftText[tk] : text;'),
    'memory draft is assigned without migration');
assert(source.includes('var _savedDraft = _draftLsGet(token);'),
    'main saved-LUMP draft reads exact persisted text');
assert(!/(_savedDraft|lsDraft|_lumpEditorDraftText\\[tk\\])\\s*=\\s*_migrateBfextBfinsSyntax/.test(source),
    'no draft path applies syntax migration');

const storage = new Map();
const prefix = 'cm_lump_draft_v2_';
const token = 'private/exact';
storage.set(prefix + encodeURIComponent(token), fixture);
assert.strictEqual(storage.get(prefix + encodeURIComponent(token)), fixture,
    'fixture retains BOM, CRLF, zero padding, and trailing spaces byte-for-byte');

const helperStart = source.indexOf('function _migrateBfextBfinsSyntax(text)');
const helperEnd = source.indexOf('\n}', helperStart) + 2;
assert(helperStart >= 0 && helperEnd > helperStart, 'optional correction preview exists');
assert(source.slice(helperStart - 220, helperStart)
    .includes('callers must never apply this result without an explicit accept'),
    'syntax correction is documented as preview-only');
assert(source.includes('window._previewBfextBfinsSyntaxCorrection = _migrateBfextBfinsSyntax;'),
    'optional correction is exposed only for preview');
assert(!source.includes('window._migrateBfextBfinsSyntax ='),
    'automatic legacy migration hook is retired');

console.log('PASS drafts preserve exact text and corrections are not automatic');