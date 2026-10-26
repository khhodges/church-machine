'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('server/fpga_status.html', 'utf8');
function extract(name) {
    const start = html.indexOf('  function ' + name + '(');
    assert(start >= 0);
    const end = html.indexOf('\n  }', start);
    return html.slice(start, end + 4);
}
let token = 'dummy-test-credential';
const context = vm.createContext({
    sessionStorage: {getItem(key) {
        assert.equal(key, 'ba_build_token');
        if (token === null) throw Error('storage blocked');
        return token;
    }},
});
for (const name of ['describeFailure', 'controlHeaders', 'controlFailure']) {
    vm.runInContext(extract(name), context);
}
assert.equal(context.controlHeaders().Authorization, 'Bearer dummy-test-credential');
assert.equal(context.controlHeaders()['Content-Type'], 'application/json');
token = '';
assert.equal(context.controlHeaders().Authorization, undefined);
token = null;
assert.equal(context.controlHeaders().Authorization, undefined);
for (const status of [401, 403]) {
    const message = context.controlFailure('REBOOT', status, {error: 'dummy-test-credential'}, '');
    assert.match(message, /REQUEST DENIED — no command sent/);
    assert.match(message, /same tab/);
    assert(!message.includes('dummy-test-credential'));
    assert(!message.includes('REBOOT FAILED'));
}
assert.match(context.controlFailure('REBOOT', 409, {error: 'busy'}, ''), /FAILED: HTTP 409: busy/);
// All three POST paths use the shared header builder and denial formatter.
assert.equal((html.match(/method: 'POST'/g) || []).length, 3);
assert.equal((html.match(/headers: controlHeaders\(\)/g) || []).length, 3);
assert.equal((html.match(/note\(controlFailure\(/g) || []).length, 3);
console.log('PASS FPGA control authorization and denied-request messages (no network requests)');
