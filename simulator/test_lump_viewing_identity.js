'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-abstractions.js'), 'utf8');
const start = source.indexOf('function _updateLumpViewingLabel(');
const end = source.indexOf('\nfunction ', start + 1);
assert(start >= 0 && end > start, 'Viewing-label function should be extractable');

const label = { style: {}, innerHTML: 'stale identity' };
const records = new Map();
const sandbox = {
    window: {
        LumpRegistry: {
            resolve(token) {
                const server = records.get(token);
                return server ? { sources: { server } } : null;
            },
            getServerList() {
                return Array.from(records.values());
            },
        },
    },
    document: {
        getElementById(id) {
            return id === 'lumpViewingLabel' ? label : null;
        },
    },
    _lumpDateStr() { return ''; },
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);

records.set('token-a', {
    token: 'token-a',
    abstraction: 'Alpha',
    identity_hash: 'seal-a-full',
    filename: 'Alpha.deadbeef.lump',
});
records.set('token-b', {
    token: 'token-b',
    abstraction: 'Beta',
    identity_hash: 'seal-b-full',
});
records.set('legacy', {
    token: 'legacy',
    abstraction: 'Legacy',
});

sandbox._updateLumpViewingLabel('token-a');
assert.match(label.innerHTML, />Seal</);
assert.match(label.innerHTML, />seal-a-full</);
assert.match(label.innerHTML, />Token</);
assert.match(label.innerHTML, />0xtoken-a</);
assert(!label.innerHTML.includes('deadbeef'), 'filename digest must not masquerade as the Seal');

sandbox._updateLumpViewingLabel('token-b');
assert.match(label.innerHTML, />seal-b-full</);
assert.match(label.innerHTML, />0xtoken-b</);
assert(!label.innerHTML.includes('seal-a-full'), 'selection change must replace the previous Seal');
assert(!label.innerHTML.includes('token-a'), 'selection change must replace the previous Token');

records.set('token-b', {
    token: 'token-b-rebuilt',
    abstraction: 'Beta',
    identity_hash: 'seal-b-rebuilt',
});
sandbox._updateLumpViewingLabel('token-b');
assert.match(label.innerHTML, />seal-b-rebuilt</);
assert.match(label.innerHTML, />0xtoken-b-rebuilt</);
assert(!label.innerHTML.includes('seal-b-full'), 'server refresh must replace the pre-rebuild Seal');

sandbox._updateLumpViewingLabel('legacy');
assert.match(label.innerHTML, />unavailable</);
assert.match(label.innerHTML, />0xlegacy</);
assert(!label.innerHTML.includes('seal-b-full'), 'legacy selection must not retain a previous Seal');

sandbox._updateLumpViewingLabel('missing');
assert.strictEqual(label.style.display, 'none');
assert.strictEqual(label.innerHTML, '', 'missing selection must clear stale identity markup');

console.log('LUMP Viewing identity tests passed');