'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<div id="audit"></div>');
const box = dom.window.document.getElementById('audit');
const context = vm.createContext({document:dom.window.document, window:dom.window, console});
vm.runInContext(fs.readFileSync(__dirname + '/lump-audit.js', 'utf8'), context);
const pass = {ruleId:'STRUCTURE', severity:'pass', message:'Structure valid', detail:'Binary check'};
context.lumpAuditRenderPanel(box, [pass]);
assert.match(box.textContent, /Binary checks only/);
assert.doesNotMatch(box.textContent, /All checks passed/);
box.innerHTML = '';
context.lumpAuditRenderPanel(box, []);
assert(box.querySelector('.lump-audit-panel-warn'));
assert.match(box.textContent, /No checks were reported/);
context.lumpAudit = () => [pass];
async function render(data) {
    context.fetch = async () => ({ok:true, json:async () => ({words:[1], ...data})});
    await context.lumpAuditFromServer('token', null, box);
}
(async () => {
    await render({bootstrap_identity:{applies:true, valid:false},
        activation_eligibility:{status:'current'}});
    assert(box.querySelector('.lump-audit-panel-error'));
    assert.match(box.textContent, /Bootstrap identity invalid/);
    assert.doesNotMatch(box.textContent, /Reported checks passed|All checks passed/);
    await render({bootstrap_identity:{applies:true, valid:true},
        activation_eligibility:{status:'eligible'}});
    assert(box.querySelector('.lump-audit-panel-pass'));
    assert.match(box.textContent, /not execution approval/);
    await render({activation_eligibility:{status:'blocked', reasons:[{message:'Approval absent'}]}});
    assert(box.querySelector('.lump-audit-panel-error'));
    assert.match(box.textContent, /Approval absent/);
    await render({});
    assert(box.querySelector('.lump-audit-panel-warn'));
    assert.match(box.textContent, /Activation eligibility not established/);
    console.log('PASS audit scope, invalid identity, blocked/unknown activation and empty results');
})().catch(error => {console.error(error); process.exitCode = 1;});