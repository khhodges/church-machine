'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {build} = require('./namespace-handoff-target');
const p = build();
assert.equal(p.slotCount, 64);
assert.deepEqual(p.metadataWords, [0xf8800100 + (64 << 10), 0, 11, 0]);
assert.equal(p.tableWords - 1, 255);
assert.equal(p.rows.find(r => r.slot === 2).location, 256);
assert.equal(p.rows.find(r => r.slot === 8).sequence, 1);
assert.equal(p.rows.find(r => r.slot === 7).words, 4096);
assert.equal(p.rows.find(r => r.slot === 10).words, 2048);
// These are now reviewed saved artifacts, not hashes of ephemeral candidates.
for (const [slot, filename] of [
    [7, 'WukongCallHome.1.7084172e.lump'],
    [10, 'CapabilityTest.1.1feaf30b.lump'],
]) {
    const row = p.rows.find(r => r.slot === slot);
    const raw = fs.readFileSync(__dirname + '/../server/lumps/' + filename);
    assert.equal(raw.length, row.words * 4);
    assert.equal(require('crypto').createHash('sha256').update(raw).digest('hex'), row.hash);
    assert.match(row.source, /Saved Full-source.*not installed/);
}
assert.equal(p.end, 9216);
assert.equal(p.rows.filter(r => r.hash).length, 3);
let end = p.tableWords;
for (const r of p.rows.filter(r => r.words).sort((a,b) => a.location - b.location)) {
    assert.equal(r.location, end, 'allocation follows the previous body without overlap');
    end += r.words;
}
const memory = new Uint32Array(p.capacityWords);
memory.set(p.metadataWords);
const view = require('./namespace-runtime-view');
assert.equal(view.geometry(memory, {word0: 0x02000001, word1: 0, word2: 255}).count, 64);
const host = {};
const context = vm.createContext({document: {readyState: 'complete',
    getElementById: id => id === 'namespaceHandoffTarget' ? host : null}});
vm.runInContext(fs.readFileSync(__dirname + '/namespace-handoff-target.js', 'utf8'), context);
assert.match(host.innerHTML, /Metadata \/ physical header/);
assert.match(host.innerHTML, /Historical reference/);
assert.match(host.innerHTML, /0x00002400|9,216/);
assert.match(host.innerHTML, /not the installed image/);
assert.match(host.innerHTML, /slot 2, version 0/);
const page = fs.readFileSync(__dirname + '/index.html', 'utf8');
const markup = page.slice(page.indexOf('<div id="namespace"'), page.indexOf('<!-- Hello Mum'));
assert(markup.indexOf('id="namespaceTable"') < markup.indexOf('<details'),
    'the editable Namespace and its ADD/Save controls must not be hidden by build references');
assert(markup.indexOf('id="namespaceTable"') < markup.indexOf('id="namespaceHandoffTarget"'));
assert.match(markup, /Historical handoff layout reference/);
assert.match(markup, /must not be used as the API-only bitstream memory map/);
assert.match(markup, /Add unfinished LUMPs such as ide.Mint as design placements/);
assert.equal((markup.match(/id="namespaceTable"/g) || []).length, 1,
    'all build options reuse the existing Namespace editor');
assert.doesNotMatch(markup, /Approved Handoff Target|Saved legacy design and committed-image controls/);
console.log('PASS Namespace workspace stays primary; historical reference retains geometry and evidence');
