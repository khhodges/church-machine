'use strict';
// Focused tests for Thread design heap tuple definitions (design intent only).
const assert = require('assert');
const fs = require('fs');
const R = require('./thread-heap-record');
global.ThreadHeapRecord = R;
const T = require('./thread-tuple-design');
const HEAP = 256 - 12 - 32 - 18; // 256-word Thread, 16 frames

// Template: telephone exact layout matches the 58-word call record ABI.
let r = T.addFromTemplate([], 'telephone', HEAP);
assert.equal(r.error, null);
const tel = r.tuples[0];
assert.equal(T.tupleWords(tel), R.schema.words);
assert.equal(T.tupleWords(tel), 58);
const lay = Object.fromEntries(T.layout(tel).map(f => [f.name, f]));
assert.deepStrictEqual([lay.magic.offset, lay.abiVersion.offset, lay.extent.offset, lay.revision.offset], [0, 1, 2, 3]);
for (const f of R.schema.fields) assert.equal(lay[f.name].offset, f.offset, f.name + ' offset');
assert.deepStrictEqual(['callerName', 'telephoneNumber', 'routingSelection', 'endpoint'].map(n => lay[n].words), [17, 9, 9, 17]);
assert.equal(tel.fields[0].initial, 137);
assert.equal(tel.fields[2].initial, 58);

// Counter placed after telephone by first-fit; Custom after that.
r = T.addFromTemplate(r.tuples, 'counter', HEAP);
assert.equal(r.tuples[1].offset, 58);
assert.equal(T.tupleWords(r.tuples[1]), 3);
r = T.addFromTemplate(r.tuples, 'custom', HEAP);
assert.equal(r.tuples[2].offset, 61);
let tuples = r.tuples;

// Custom create/edit/delete.
r = T.addField(tuples, 2, HEAP); assert.equal(r.error, null); tuples = r.tuples;
r = T.updateField(tuples, 2, 1, {name: 'label', type: 'utf8'}, HEAP); assert.equal(r.error, null); tuples = r.tuples;
r = T.updateField(tuples, 2, 1, {size: 10, initial: 'Zoë'}, HEAP); assert.equal(r.error, null); tuples = r.tuples;
assert.equal(T.tupleWords(tuples[2]), 1 + 1 + 3);
r = T.updateTuple(tuples, 2, {name: 'Mine', offset: 100, policy: 'preserve'}, HEAP); assert.equal(r.error, null); tuples = r.tuples;
assert.equal(tuples[2].name, 'Mine');
r = T.updateField(tuples, 0, 4, {initial: 7}, HEAP);
assert.equal(r.tuples[0].template, 'custom', 'editing a template tuple marks it custom');
r = T.removeField(tuples, 2, 1, HEAP); assert.equal(r.error, null); assert.equal(r.tuples[2].fields.length, 1);
assert.ok(T.removeField(r.tuples, 2, 0, HEAP).error, 'last field cannot be removed');
const del = T.removeTuple(tuples, 1); assert.equal(del.tuples.length, 2); assert.equal(tuples.length, 3, 'input not mutated');

// Bounds, overlap and invalid input are rejected without change.
const bad = [
    T.updateTuple(tuples, 2, {offset: 10}, HEAP),            // overlaps CallRecord
    T.updateTuple(tuples, 2, {offset: HEAP - 2}, HEAP),      // runs off heap end
    T.updateTuple(tuples, 2, {offset: -1}, HEAP),
    T.updateTuple(tuples, 2, {offset: NaN}, HEAP),
    T.updateTuple(tuples, 2, {name: 'CallRecord'}, HEAP),    // duplicate
    T.updateTuple(tuples, 2, {name: '<img src=x>'}, HEAP),
    T.updateTuple(tuples, 2, {policy: 'magic'}, HEAP),
    T.updateField(tuples, 1, 0, {initial: -1}, HEAP),
    T.updateField(tuples, 1, 0, {initial: 4294967296}, HEAP),
    T.updateField(tuples, 1, 0, {name: 'step'}, HEAP),       // duplicate field
    T.updateField(tuples, 2, 0, {type: 'utf8', initial: 'x'.repeat(33)}, HEAP),
    T.updateField(tuples, 2, 0, {type: 'words', size: 5000}, HEAP),
    T.updateField(tuples, 2, 0, {type: 'bogus'}, HEAP),
    T.addFromTemplate(tuples, 'nope', HEAP),
];
for (const b of bad) { assert.ok(b.error, 'expected rejection'); assert.strictEqual(b.tuples, tuples); }
assert.ok(T.addFromTemplate([], 'telephone', 40).error, 'template cannot exceed heap');
assert.ok(T.validate(tuples, 100).length, 'geometry shrink reports out-of-heap');
assert.ok(T.updateField(tuples, 1, 0, {initial: 4294967295}, HEAP).error === null);
assert.ok(T.updateField(tuples, 2, 0, {type: 'int32', initial: -5}, HEAP).error === null);

// Persistence roundtrip: export/import JSON and saved-state JSON.
const json = T.exportJson(tuples, HEAP);
const doc = JSON.parse(json);
assert.equal(doc.schema, T.SCHEMA);
assert.deepStrictEqual(T.importJson(json, HEAP), T.normalize(tuples));
assert.deepStrictEqual(T.normalize(JSON.parse(JSON.stringify(tuples))), T.normalize(tuples));
assert.throws(() => T.importJson(json, 60), /exceed/);
assert.throws(() => T.importJson('{', HEAP), /JSON/);
assert.throws(() => T.importJson(JSON.stringify({schema: 'x', version: 1, tuples: []}), HEAP), /schema/);
const ov = JSON.parse(json); ov.tuples[1].offset = 0;
assert.throws(() => T.importJson(JSON.stringify(ov), HEAP), /overlaps/);
const extra = JSON.parse(json); extra.tuples[0].gt = 123; extra.tuples[0].fields[0].rights = 'RW';
const clean = T.importJson(JSON.stringify(extra), HEAP);
assert.ok(!('gt' in clean[0]) && !('rights' in clean[0].fields[0]), 'unknown keys are dropped');

// Page integration: escaping, scope wording, persistence key, no boot-config leak.
const src = fs.readFileSync(__dirname + '/app-lump-editor.js', 'utf8');
assert.match(src, /renderTuplePanel\(overCapacity \? 0 : heap/);
assert.match(src, /esc\(t\.name\)/);
assert.match(src, /value="' \+ esc\(f\.initial\)/);
assert.match(src, /not<\/strong> included in the boot config/);
const step1 = src.slice(src.indexOf('function _getStep1Payload'), src.indexOf('function _postStep1'));
assert.ok(!/tuple/i.test(step1), 'tuples must not be sent to boot-config');
// Exercise the page esc() on a hostile name to confirm rendered output is inert.
const esc = eval('(' + src.match(/function esc\(s\) \{[\s\S]*?\n    \}/)[0] + ')');
assert.equal(esc('"><script>'), '&quot;&gt;&lt;script&gt;');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
assert.ok(html.indexOf('thread-tuple-design.js') < html.indexOf('app-lump-editor.js'));
assert.ok(html.indexOf('thread-heap-record.js') < html.indexOf('thread-tuple-design.js'));

// Focus/selection and draft preservation across innerHTML redraw.
const fnSrc = name => src.match(new RegExp('function ' + name + '\\(doc(, snap)?\\) \\{[\\s\\S]*?\n    \\}'))[0];
const capture = eval('(' + fnSrc('_captureUi') + ')'), restore = eval('(' + fnSrc('_restoreUi') + ')');
function fakeDoc(els, activeId) {
    const doc = {els, activeElement: null, getElementById: id => els[id] || null};
    for (const e of Object.values(els)) e.focus = () => { doc.activeElement = e; };
    doc.activeElement = els[activeId] || null; return doc;
}
const mkInput = (id, value, a, b) => ({id, value, selectionStart: a, selectionEnd: b,
    setSelectionRange(x, y) { this.selectionStart = x; this.selectionEnd = y; }});
let d1 = fakeDoc({'le-tu-0-name': mkInput('le-tu-0-name', 'CallRecord', 2, 5),
    'le-tu-io': {id: 'le-tu-io', open: true}, 'le-tu-json': mkInput('le-tu-json', '{"draft":1}', 0, 0)}, 'le-tu-0-name');
const snap = capture(d1);
let d2 = fakeDoc({'le-tu-0-name': mkInput('le-tu-0-name', 'Call', 0, 0),
    'le-tu-io': {id: 'le-tu-io', open: false}, 'le-tu-json': mkInput('le-tu-json', '', 0, 0)}, null);
restore(d2, snap);
assert.equal(d2.activeElement.id, 'le-tu-0-name');
assert.deepStrictEqual([d2.els['le-tu-0-name'].selectionStart, d2.els['le-tu-0-name'].selectionEnd], [2, 4], 'selection clamped');
assert.equal(d2.els['le-tu-io'].open, true);
assert.equal(d2.els['le-tu-json'].value, '{"draft":1}');
// Freshly rendered non-empty JSON (e.g. import failure echo) is not overwritten.
let d3 = fakeDoc({'le-tu-json': mkInput('le-tu-json', 'new', 0, 0)}, null);
restore(d3, {id: 'gone', start: null, end: null, ioOpen: null, json: 'old'});
assert.equal(d3.els['le-tu-json'].value, 'new'); assert.equal(d3.activeElement, null);
const renderSrc = src.slice(src.indexOf('    function render() {'), src.indexOf('// ── public handlers'));
assert.ok(renderSrc.indexOf('_captureUi(document)') < renderSrc.indexOf('innerHTML') &&
    renderSrc.lastIndexOf('_restoreUi(document, snap)') > renderSrc.lastIndexOf('innerHTML'));

// Save failure: saveState reports false; no success message, edit kept in memory.
assert.match(src, /localStorage\.setItem\('lump_editor_state'[^\n]*\n\s*return true;\n\s*\} catch \(e\) \{ return false; \}/);
const applySrc = src.slice(src.indexOf('function _tupleApply'), src.indexOf('function _num'));
assert.match(applySrc, /state\.tuples = res\.tuples;\s*\n\s*if \(saveState\(\)\)/);
assert.match(applySrc, /NOT saved/);
console.log('PASS thread tuple design: templates, CRUD, bounds/overlap, roundtrip, escaping');
