'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const labels = require('./namespace-profile-names');
const html = fs.readFileSync(__dirname+'/index.html','utf8');
const dropdown = html.match(/<select id="namespaceDesignProfile"[\s\S]*?<\/select>/)[0];
const actual = Object.fromEntries([...dropdown.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
    .map(m=>[m[1],m[2]]));
assert.deepEqual(actual, labels.names, 'all public names must exactly match the dropdown');
const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map(m=>m[1]);
for (const consumer of ['app-memory.js','breakpoint-inspector.js','design-simulation.js','namespace-design-v1.js'])
    assert(scripts.indexOf('namespace-profile-names.js') < scripts.indexOf(consumer));
const code = fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8');
const fn = code.slice(code.indexOf('function profileLabel()'),code.indexOf('function designStatus()'));
for (const profile of Object.keys(labels.names)) {
    const ctx={state:{profile},root:{NamespaceProfileNames:labels}};
    vm.runInNewContext(fn,ctx);
    assert.equal(ctx.profileLabel(),labels.label(profile));
}
console.log('PASS exact dropdown names and shared script load order');
