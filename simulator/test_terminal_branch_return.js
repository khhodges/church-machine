'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
function compile(body) {
    const source = `abstraction test.TerminalBranch {\ncapabilities { SELF E }\nmethod Start {\n${body}\n}\n}`;
    const process = spawnSync(global.process.execPath,
        [path.join(__dirname, '../server/compile_worker.js')], {
            input:JSON.stringify({source,language:'assembly',tier:2}), encoding:'utf8'
        });
    assert.equal(process.status,0,process.stderr);
    const result = JSON.parse(process.stdout);
    assert.equal(result.ok,true,JSON.stringify(result));
    const cw = (result.words[0] >>> 10) & 8191;
    return result.words.slice(2,1+cw); // omit header and single dispatch entry
}
const loop = compile('Init:\nIADD DR1, DR0, #0\nBRANCH Init');
assert.equal(loop.length,2);
assert.equal(loop.at(-1) >>> 27,23);
const self = compile('Init:\nBRANCH Init');
assert.equal(self.length,1);
for (const body of [
    'Init:\nIADD DR1, DR0, #0\nBRANCHEQ Init',
    'BRANCH End\nEnd:',
    'BRANCHEQ End\nInit:\nIADD DR1, DR0, #0\nBRANCH Init\nEnd:',
    'IADD DR1, DR0, #0',
    'RETURN',
]) {
    assert.equal(compile(body).at(-1) >>> 27,3,
        'fallthrough/end-label/explicit return remains executable: '+body);
}
console.log('PASS real compiler: no extra RETURN after closed unconditional branch; fallthrough and end labels retain RETURN');
