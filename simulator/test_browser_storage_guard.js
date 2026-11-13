'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/browser-storage-guard.js', 'utf8');
for (const blocked of [null, 'localStorage', 'sessionStorage']) {
    let notice;
    const nodes = {'#storage-open-ide': {}, '#storage-allow': {addEventListener() {}},
        '#storage-access-status': {}};
    const window = {location: {href: 'https://example.test/simulator/#lumps'}};
    for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, {get() {
            if (blocked === name) throw new Error('Storage denied');
            return {length: 0}; // No write/remove API: guard must never mutate storage.
        }});
    }
    const document = {readyState: 'complete', body: {appendChild(el) {notice = el;}},
        createElement() {return {style: {}, setAttribute() {}, querySelector(key) {return nodes[key];}};}};
    vm.runInNewContext(source, {window, document});
    assert.equal(window.churchBrowserStorageBlocked, !!blocked);
    assert.equal(!!notice, !!blocked);
    if (blocked) {
        assert.match(notice.innerHTML, /not replaced or cleared/);
        assert.equal(nodes['#storage-open-ide'].href, window.location.href);
    }
}
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
assert(html.indexOf('browser-storage-guard.js') < html.indexOf('app-misc.js'));
assert.match(fs.readFileSync(__dirname + '/app-misc.js', 'utf8'),
    /if \(window\.churchBrowserStorageBlocked\) return/);
console.log('PASS storage-blocked startup notice, no storage mutations, standalone link and normal startup');
