'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {compileActorPrograms} = require('./compile_actor_programs');
const {lumpAudit, lumpAuditHasErrors} = require('./lump-audit');
const words = compileActorPrograms()['ide.Mallory'];
const before = words.slice();
const result = lumpAudit(words, {capabilities:[
    {name:'SELF', rights:['E']}, {name:'ide.Mallory', rights:['R','W']},
]}, []);
assert.equal(lumpAuditHasErrors(result), false, JSON.stringify(result));
assert.match(result.find(r => r.ruleId === 'CAP_RANGE').detail, /BOUNDS/);
assert.deepEqual(words, before, 'audit must not rewrite instructions or extend the C-list');
assert.equal(words[0] & 255, 2);
assert.equal(words[2], 0x070b0020);
const invalid = words.slice(); invalid[0] = 0;
assert(lumpAuditHasErrors(lumpAudit(invalid)), 'malformed header is still rejected');
const html = fs.readFileSync(__dirname + '/index.html','utf8');
for (const file of ['lump-audit.js','app-compile.js']) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(__dirname+'/'+file)).digest('hex').slice(0,12);
    assert(html.includes(file+'?v=sha256-'+hash), file+' served cache key must match');
}
console.log('PASS Mallory compilation audit: missing row advisory, malformed binary blocked, bytes unchanged');
