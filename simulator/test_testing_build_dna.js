'use strict';
const assert = require('assert');
const m = require('./testing-build-dna.js');
assert.deepStrictEqual(m.objectWordTotal([
  {slot:1,sizeWords:256}, {slot:2,sizeWords:64}, {slot:2,sizeWords:64},
  {slot:3,sizeWords:5,kind:'Hardware'}, {slot:4,sizeWords:999,availability:'not-in-image'},
  {slot:5}
]), {total:325,ram:320,mmio:5,missing:1});
assert.equal(m.nodeLabel({slot: 1, kind: 'Namespace', name: 'NS[1]'}).name, 'Namespace.Boot');
assert.equal(m.nodeLabel({slot: 6, name: 'NS[6]', dotName: 'ide.SelfTest'}).name, 'ide.SelfTest');
assert.equal(m.nodeLabel({slot: 9, name: 'NS[9]'}).name, null);
assert.ok(m.wrapName('example.ALongObjectNameWithMoreThanTwentyFourCharacters', 24, 2).length <= 2);
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
const nsNodes = [{ id: 'slot-0', slot: 0, kind: 'Abstraction' }, { id: 'slot-1', slot: 1, kind: 'Namespace' },
  { id: 'slot-2', slot: 2, kind: 'Thread' }, { id: 'slot-5', slot: 5, kind: 'Abstraction' }];
const C = m.containerLayout(nsNodes, 'default', 1000, 600);
assert.strictEqual(C.enclosing.id, 'slot-1');
assert.deepStrictEqual(C.header.map(h => h.node && h.node.id), ['slot-0', 'slot-1']);
assert.deepStrictEqual(C.order.map(n => n.id), ['slot-2', 'slot-5']);
['slot-2', 'slot-5'].forEach(id => { const p = C.pos[id];
  assert.ok(p.x >= 0 && p.y >= C.container.headerHeight && p.x + p.w <= C.container.w && p.y + p.h <= C.container.h); });
assert.ok(C.pos['slot-0'].y + C.pos['slot-0'].h <= C.container.headerHeight);
assert.ok(C.pos['slot-1'].y > C.pos['slot-0'].y);
assert.ok(Math.abs(C.container.w / C.container.h - 952 / 552) < 0.01);
const C2 = m.containerLayout(nsNodes.slice(1), 'organized', 400, 800);
assert.strictEqual(C2.header[0].node, null); assert.ok(!('slot-0' in C2.pos));
assert.strictEqual(m.containerLayout([{ id: 'x', slot: 2 }], 'default', 500, 500), null);
console.log('test_testing_build_dna: ok');
const ug = m.unresolvedGroups([
  { id: 'n', kind: 'NULL', target: null }, { id: 'r', kind: 'Inform', target: 'slot-2' },
  { id: 'u1', kind: 'Inform', target: null, unresolvedName: null, unresolvedNameReason: 'none', targetSlot: 9 },
  { id: 'u2', kind: 'Outform', target: null },
  { id: 'u3', kind: 'Inform', target: null, unresolvedName: 'Sys.Clock' },
  { id: 'u4', kind: 'Inform', target: null, unresolvedName: 'Sys.Clock' }]);
assert.deepStrictEqual(ug.map(g => [g.name, g.edges.map(e => e.id)]), [['Sys.Clock', ['u3', 'u4']], [null, ['u1', 'u2']]]);
const CU = m.placeUnresolved(m.containerLayout(nsNodes, 'default', 1000, 600), ug);
CU.unresolved.forEach(u => assert.ok(u.box.y > CU.container.headerHeight && u.box.y + u.box.h <= CU.container.h));
console.log('unresolve: ok');
const mi = m.metaItems('bitstream', 'bs1', { namespaceRevisionId: 'rev'.repeat(10), imageHash: 'f'.repeat(64), status: 'available', imageKind: 'lump', installed: null }, { sha256: 'a'.repeat(64) });
assert.deepStrictEqual(mi.map(i => i.k), ['Bitstream', 'SHA-256', 'Namespace revision', 'Evidence status', 'Image hash', 'Image format', 'Installed']);
assert.strictEqual(mi[1].v.length, 64);
const ms = m.metaSummary(mi, ['x', 'y']);
assert.ok(ms.text.length < 120 && /sha aaaaaaaaaaaa…/.test(ms.text) && /UNVERIFIED/.test(ms.text));
assert.strictEqual(ms.warnings, '2 warnings');
assert.strictEqual(m.metaSummary(m.metaItems('namespace', 'n1', {}), []).warnings, '');
assert.ok(C.meta.y + C.meta.h <= C.pos['slot-0'].y && C.pos['slot-1'].y + C.pos['slot-1'].h <= C.container.headerHeight);
console.log('meta header: ok');
