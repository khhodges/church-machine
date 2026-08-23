'use strict';
// test_ns_dna_graph.js — Unit tests for Namespace DNA graph data builder
// Run: node simulator/test_ns_dna_graph.js
//
// Coverage:
//   T1 — Empty registry returns no nodes or edges
//   T2 — Missing (undefined) registry returns empty graph without crashing
//   T3 — Abstractions with no capabilities produce isolated nodes and no edges
//   T4 — Edge with numeric slot target is resolved correctly
//   T5 — Edge with string abstraction-name target is resolved via name lookup
//   T6 — Unresolved string target produces no edge but node remains
//   T7 — Null/undefined capability target produces no edge and no crash
//   T8 — Node kind derived from perms (E→executable, L/S→lambda, X→executable, R→resource)
//   T9 — grants as an object (not a string) is converted to a label string

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;

function check(label, cond) {
    if (cond) { console.log('PASS ' + label); pass++; }
    else       { console.log('FAIL ' + label); fail++; }
}

// ── Minimal browser stubs needed by the script ────────────────────────────────
global.window   = {};
global.document = { getElementById: function() { return null; } };

// ── Load the module under test ────────────────────────────────────────────────
const scriptSrc = fs.readFileSync(path.join(__dirname, 'app-ns-dna.js'), 'utf8');
vm.runInThisContext(scriptSrc);

// ── Helper: install a mock registry as a global ───────────────────────────────
function makeRegistry(list) {
    // Expose as a plain global so `typeof abstractionRegistry` resolves in the
    // already-evaluated script closure the same way app-shell.js does at runtime.
    const map = {};
    for (const a of list) map[a.index] = a;
    global.abstractionRegistry = { abstractions: map };
}

function abs(index, name, perms, capabilities) {
    return { index, name, description: name + ' desc', perms: perms || {}, capabilities: capabilities || [] };
}

// ── T1: Empty registry ────────────────────────────────────────────────────────
makeRegistry([]);
let g = buildNSDNAGraph();
check('T1 empty registry → no nodes', g.nodes.length === 0);
check('T1 empty registry → no edges', g.edges.length === 0);

// ── T2: Registry absent ───────────────────────────────────────────────────────
delete global.abstractionRegistry;
g = buildNSDNAGraph();
check('T2 missing registry → empty graph (no crash)', g.nodes.length === 0 && g.edges.length === 0);

// ── T3: No capabilities → isolated nodes only ─────────────────────────────────
makeRegistry([
    abs(1, 'Foo', { E: 1 }, []),
    abs(2, 'Bar', { R: 1 }, []),
]);
g = buildNSDNAGraph();
check('T3 two isolated nodes', g.nodes.length === 2);
check('T3 no edges',           g.edges.length === 0);
check('T3 all isolated',       g.nodes.every(n => n.isolated));

// ── T4: Edge with numeric slot target ─────────────────────────────────────────
makeRegistry([
    abs(1, 'Src', { E: 1 }, [{ name: 'BarCap', target: 2, grants: 'E' }]),
    abs(2, 'Tgt', { R: 1 }, []),
]);
g = buildNSDNAGraph();
check('T4 two nodes',          g.nodes.length === 2);
check('T4 one edge',           g.edges.length === 1);
check('T4 edge source=1',      g.edges[0].source === 1);
check('T4 edge target=2',      g.edges[0].target === 2);
check('T4 edge capName',       g.edges[0].capName === 'BarCap');
check('T4 edge grants label',  g.edges[0].grants === 'E');
check('T4 source not isolated', !g.nodes.find(n => n.slot === 1).isolated);
check('T4 target not isolated', !g.nodes.find(n => n.slot === 2).isolated);

// ── T5: Edge with string name target ──────────────────────────────────────────
makeRegistry([
    abs(3, 'Alpha', { L: 1 }, [{ name: 'BetaCap', target: 'Beta', grants: 'L' }]),
    abs(4, 'Beta',  { R: 1 }, []),
]);
g = buildNSDNAGraph();
check('T5 one edge via name lookup', g.edges.length === 1);
check('T5 edge source=3',            g.edges[0].source === 3);
check('T5 edge target=4',            g.edges[0].target === 4);

// ── T6: Unresolved string target → no edge ────────────────────────────────────
makeRegistry([
    abs(5, 'Solo', { E: 1 }, [{ name: 'Ghost', target: 'Nonexistent', grants: 'E' }]),
]);
g = buildNSDNAGraph();
check('T6 unresolved target → no edge',    g.edges.length === 0);
check('T6 node still present',             g.nodes.length === 1);
check('T6 unresolved cap → node isolated', g.nodes[0].isolated);

// ── T7: Null/undefined target → no edge, no crash ────────────────────────────
makeRegistry([
    abs(6, 'Nil', { R: 1 }, [
        { name: 'NullCap',  target: null,      grants: 'R' },
        { name: 'UndefCap', target: undefined,  grants: 'W' },
        { name: 'NoTarget', grants: 'R' },
    ]),
]);
g = buildNSDNAGraph();
check('T7 null/undef targets → no edge',  g.edges.length === 0);
check('T7 no crash',                       true);

// ── T8: Node kind from perms ──────────────────────────────────────────────────
makeRegistry([
    abs(10, 'ExecE', { E: 1 }),
    abs(11, 'LambL', { L: 1 }),
    abs(12, 'LambS', { S: 1 }),
    abs(13, 'ExecX', { X: 1 }),
    abs(14, 'ResR',  { R: 1 }),
    abs(15, 'Empty', {}),
]);
g = buildNSDNAGraph();
const bySlot = {};
for (const n of g.nodes) bySlot[n.slot] = n;
check('T8 E-perm → executable', bySlot[10].kind === 'executable');
check('T8 L-perm → lambda',     bySlot[11].kind === 'lambda');
check('T8 S-perm → lambda',     bySlot[12].kind === 'lambda');
check('T8 X-perm → executable', bySlot[13].kind === 'executable');
check('T8 R-perm → resource',   bySlot[14].kind === 'resource');
check('T8 empty-perm → resource', bySlot[15].kind === 'resource');

// ── T9: grants as object → string label ──────────────────────────────────────
makeRegistry([
    abs(20, 'ObjSrc', { E: 1 }, [{ name: 'ObjGrants', target: 21, grants: { R: 1, W: 1 } }]),
    abs(21, 'ObjTgt', { R: 1 }, []),
]);
g = buildNSDNAGraph();
check('T9 one edge produced',              g.edges.length === 1);
check('T9 object grants → string label',   typeof g.edges[0].grants === 'string');
check('T9 grants label non-empty',         g.edges[0].grants.length > 0);
check('T9 grants contains R',              g.edges[0].grants.includes('R'));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + pass + ' passed, ' + fail + ' failed.');
if (fail > 0) process.exit(1);
