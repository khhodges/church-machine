'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('simulator/app-build-approval.js', 'utf8');
const persistent = new Map(), session = new Map([['ba_build_token', 'test-only-token']]);
function storage(map) { return { getItem: k => map.has(k) ? map.get(k) : null, setItem: (k,v) => map.set(k,v) }; }
const context = vm.createContext({localStorage:storage(persistent), sessionStorage:storage(session)});
for (const name of ['_getBuildToken', '_setBuildToken']) {
  const start = source.indexOf('    ' + name + '(');
  const end = source.indexOf('\n    },', start);
  vm.runInContext('var ' + name + ' = function' + source.slice(start + 4 + name.length, end + 6), context);
}
assert.equal(context._getBuildToken(), 'test-only-token'); // migrate existing session
session.clear();
assert.equal(context._getBuildToken(), 'test-only-token'); // reopened tab
context._setBuildToken(' replacement ');
assert.equal(context._getBuildToken(), 'replacement');
context._setBuildToken('');
session.set('ba_build_token', 'old-tab-copy');
assert.equal(context._getBuildToken(), ''); // forget wins over stale sessions
console.log('PASS migration, persistence, replacement and forget across tabs');
