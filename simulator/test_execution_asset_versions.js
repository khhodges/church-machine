'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
for(const file of ['simulator.js','boot-fault-entry.js','namespace-runtime-core.js','design-simulation.js','namespace-design-v1.js','app-run.js']){
    const hash=crypto.createHash('sha256').update(fs.readFileSync(__dirname+'/'+file)).digest('hex').slice(0,12);
    assert(html.includes(file+'?v=sha256-'+hash),file+' changed without updating the served cache key');
}
console.log('PASS selected-execution asset cache keys match actual served bytes');
