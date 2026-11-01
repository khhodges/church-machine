'use strict';
const assert = require('assert');
const m = require('./testing-build-dna.js');
assert.strictEqual(m.hex32(0xdeadbeef), '0xDEADBEEF');
assert.strictEqual(m.hex32(0), '0x00000000');
assert.strictEqual(m.buildUrl('bitstream', 'a b'), '/api/testing/build-dna?bitstream=a%20b');
assert.strictEqual(m.buildUrl(), '/api/testing/build-dna');
const L = m.layoutGraph([{ id: 'b', slot: 2 }, { id: 'a', slot: 1 }, { id: 'c', slot: null }]);
assert.deepStrictEqual(L.order.map(n => n.id), ['a', 'b', 'c']);
assert.ok(L.pos.a && L.pos.c && L.width > 0);
const edges = [
  { id: 'e1', source: 'a', target: 'b', raw: 1, register: 'CR0', status: 'resolved' },
  { id: 'e2', source: 'a', target: null, raw: 0xffffffff, register: 'CR1', status: 'unresolved' },
  { id: 'e3', source: 'b', target: 'a', raw: 2, register: 'CR2', status: 'resolved' },
];
let f = m.filterDetail({ id: 'a' }, edges, '');
assert.strictEqual(f.outgoing.length, 2); assert.strictEqual(f.incoming.length, 1);
f = m.filterDetail({ id: 'a' }, edges, 'unresolved');
assert.deepStrictEqual(f.outgoing.map(e => e.id), ['e2']);
f = m.filterDetail({ id: 'a' }, edges, 'ffffffff');
assert.deepStrictEqual(f.outgoing.map(e => e.id), ['e2']);
assert.strictEqual(m.clampZoom(100), 4); assert.strictEqual(m.clampZoom(0), 0.15);
const g = m.makeRequestGate(); const t1 = g.next(); const t2 = g.next();
assert.ok(!g.isCurrent(t1) && g.isCurrent(t2));
console.log('test_testing_build_dna: ok');
