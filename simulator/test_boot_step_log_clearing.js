'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const manualStart = source.indexOf('function stepSim()');
const manualEnd = source.indexOf('function runSim', manualStart);
const animatedStart = source.indexOf('function slowBoot()');
const animatedEnd = source.indexOf('function resetSim', animatedStart);

assert(manualStart >= 0 && manualEnd > manualStart,
    'manual Step implementation is present');
assert(animatedStart >= 0 && animatedEnd > animatedStart,
    'animated Boot implementation is present');
assert(source.slice(manualStart, manualEnd)
    .includes('_bootAuditAccum = sim.auditLog.slice();'),
    'manual Step replaces stale audit cards with the current step log');
assert(source.slice(animatedStart, animatedEnd)
    .includes('_bootAuditAccum = sim.auditLog.slice();'),
    'animated Boot replaces stale audit cards with the current step log');
assert(!source.slice(manualStart, manualEnd)
    .includes('_bootAuditAccum.push(...sim.auditLog)'),
    'manual Step never appends prior-step audit cards');
assert(!source.slice(animatedStart, animatedEnd)
    .includes('_bootAuditAccum.push(...sim.auditLog)'),
    'animated Boot never appends prior-step audit cards');

console.log('PASS boot step log clearing');