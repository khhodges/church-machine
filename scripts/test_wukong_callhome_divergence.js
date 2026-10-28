'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

// Change only the checker's in-memory source input, never repository artifacts.
for (const [label, before, after, diagnostic] of [
    ['row', 'CALL CR6[WukongCallHome.hw]', 'CALL CR6[UART_TX]', /word\[72\]/],
    ['selector', 'CALL CR6[WukongCallHome.hw]', 'CALL CR6[WukongCallHome.hw], #0', /word\[72\]/],
    ['loop', 'BRANCH loop_top', 'BRANCH -69', /word\[73\]/],
    ['shared body', 'IADD  DR1, DR0, #1', 'IADD  DR1, DR0, #2', /word\[2\]/],
    ['length', 'BRANCH loop_top', 'NOP\nBRANCH loop_top', /expected 74/],
]) {
    const result = spawnSync(process.execPath, ['-e', `
        const fs = require('fs');
        const source = require('path').resolve('simulator/examples/wukong_callhome.cloomc');
        const read = fs.readFileSync;
        fs.readFileSync = function(file, ...args) {
            const value = read.call(this, file, ...args);
            if (file !== source) return value;
            if (!value.includes(${JSON.stringify(before)})) throw Error('missing mutation anchor');
            return value.replace(${JSON.stringify(before)}, ${JSON.stringify(after)});
        };
        require('./scripts/check_wukong_callhome_divergence');
    `], {cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000});
    assert.equal(result.status, 1, `${label}: ${result.stderr}`);
    assert.match(result.stderr, diagnostic, label);
}
console.log('PASS Wukong divergence guard rejects wrong row, selector, loop, shared body and length');
