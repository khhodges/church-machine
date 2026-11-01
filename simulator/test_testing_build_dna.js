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
const nodes = [
  { id: 'mmio', slot: 1, kind: 'Hardware' },
  { id: 'code', slot: 2, kind: 'Abstraction' },
  { id: 'thread', slot: 3, kind: 'Thread' },
  { id: 'namespace', slot: 4, kind: 'Namespace' },
  { id: 'other', slot: 5, kind: 'Selection' },
];
const original = JSON.stringify(nodes);
const organized = m.layoutGraph(nodes, 1, 'organized');
assert.deepStrictEqual(organized.order.map(n => n.id), ['thread', 'namespace', 'code', 'other', 'mmio']);
assert.ok(organized.pos.namespace.y < organized.pos.code.y);
assert.ok(organized.pos.other.y < organized.pos.mmio.y);
assert.strictEqual(JSON.stringify(nodes), original);
assert.deepStrictEqual(m.layoutGraph(nodes, 2, 'default'), m.layoutGraph(nodes, 2));
const wrapped = m.layoutGraph(nodes, 2, 'organized');
assert.strictEqual(wrapped.pos.thread.y, wrapped.pos.namespace.y);
assert.ok(wrapped.pos.code.y > wrapped.pos.thread.y);
assert.ok(wrapped.pos.mmio.y > wrapped.pos.other.y);
assert.deepStrictEqual(m.layoutGraph([], null, 'organized').order, []);
assert.strictEqual(m.layoutGraph([{ id: 'only', kind: 'MMIO' }], null, 'organized').pos.only.y, 0);
const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), slot: i, kind: 'Abstraction' }));
const wide = m.viewportLayout(many, 'default', 1400, 350);
const tall = m.viewportLayout(many, 'default', 350, 1400);
assert.ok(wide.width > tall.width);
assert.ok(wide.height < tall.height);
assert.deepStrictEqual(m.viewportLayout([], 'organized', 0, 0).order, []);
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
