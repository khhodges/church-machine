'use strict';
// Isolated DOM/event harness: no server, repository writes or generated artifacts.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const manifest = fs.readFileSync(__dirname + '/index.html', 'utf8');
const served = Array.from(manifest.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"/g), m => m[1]);
assert(served.indexOf('app-compile.js') >= 0 &&
    served.indexOf('app-compile.js') < served.indexOf('asm-method-popup.js'));
assert(served.indexOf('app-run.js') < served.indexOf('asm-method-popup.js'));
class Element {
    constructor() {
        this.children = []; this.style = {}; this.events = {};
        this.classList = { toggle() {} }; this.value = '';
        this.selectionStart = this.selectionEnd = 0;
        this.offsetLeft = this.offsetTop = this.scrollLeft = this.scrollTop = 0;
    }
    set innerHTML(_) { this.children = []; }
    appendChild(el) { this.children.push(el); }
    removeChild(el) { this.children.splice(this.children.indexOf(el), 1); }
    setAttribute() {}
    addEventListener(name, fn, capture) {
        if (name === 'keydown') this.keydownCapture = capture;
        (this.events[name] ||= []).push(fn);
    }
    dispatchEvent(e) { (this.events[e.type] || []).forEach(fn => fn(e)); }
    scrollIntoView() {}
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    contains(el) { return this === el || this.children.some(c => c.contains(el)); }
    setRangeText(text, start, end) {
        this.value = this.value.slice(0, start) + text + this.value.slice(end);
        this.selectionStart = this.selectionEnd = start + text.length;
    }
}
const body = new Element(), document = new Element(), el = new Element();
Object.assign(document, { body, readyState: 'loading', activeElement: el,
    createElement: () => new Element(), getElementById: () => null });
const pending = [], requests = [];
const sandbox = { document, window: { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ lineHeight: '16px' }) },
    _currentEditorOwner: () => ({ id: sandbox.ownerId || 'first' }),
    Event: class { constructor(type) { this.type = type; } },
    fetch(url, options) {
        assert.equal(url, '/api/compile/call-methods');
        requests.push(JSON.parse(options.body));
        return new Promise(resolve => pending.push(resolve));
    }
};
vm.createContext(sandbox);
const compile = fs.readFileSync(__dirname + '/app-compile.js', 'utf8');
vm.runInContext(compile.slice(compile.indexOf('function _sourceCallApiBindings('),
    compile.indexOf('// Auto-fill rights for capabilities')), sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/asm-method-popup.js', 'utf8'), sandbox);
sandbox.window.AsmMethodPopup.attach(el);
assert.equal(el.keydownCapture, true, 'completion must precede ordinary Tab indentation');
function input(value, pos = value.length) {
    el.value = value; el.selectionStart = el.selectionEnd = pos;
    el.dispatchEvent({ type: 'input' });
}
function key(key) {
    let prevented = false;
    el.dispatchEvent({ type: 'keydown', key, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
    return prevented;
}
function popup() { return body.children[0]; }
function rows() { return popup().children[1].children; }
async function answer(methods, target = 'Echo', extra = {}) {
    pending.shift()({ ok: true, json: async () => ({ call_api_authorities:
        methods === null ? {} : { [target]: { embedded: true, api: { methods: methods.map(name => ({ name })) }, ...extra } } }) });
    await new Promise(resolve => setImmediate(resolve));
}
(async function () {
    input('CALL Echo.');
    await answer(['Open', 'Close']);
    assert.deepEqual(rows().map(r => r.textContent), ['Open', 'Close']);
    assert(key('ArrowDown')); assert(key('ArrowUp')); assert(key('ArrowDown'));
    assert(key('Tab')); assert.equal(el.value, 'CALL Echo.Close');
    await answer(['Open', 'Close']); // selection's input event is deliberately invalidated
    assert.equal(popup().style.display, 'none');

    input('CALL org.example.echo.opRest, CR3 ; keep', 24);
    await answer(['Open', 'Close'], 'org.example.echo');
    assert.equal(rows()[0].textContent, 'Open');
    rows()[0].dispatchEvent({ type: 'mousedown', preventDefault() {} });
    assert.equal(el.value, 'CALL org.example.echo.Open, CR3 ; keep');
    await answer(['Open'], 'org.example.echo');

    input('CALL SelfTest.'); await answer([], 'SelfTest');
    assert.match(rows()[0].textContent, /declares no methods/);
    assert.equal(key('Enter'), false);
    input('CALL WukongCallHome.'); await answer(null);
    assert.match(rows()[0].textContent, /unavailable/);
    input('CALL Echo.Z'); await answer(['Open']);
    assert.match(rows()[0].textContent, /No matching/);
    key('Escape');
    assert.equal(popup().style.display, 'none');

    for (const source of ['; CALL Echo.', '// CALL Echo.', '"CALL Echo.', '/* CALL Echo.', 'CALL CR6.']) {
        input(source);
        assert.equal(pending.length, 0, source);
    }
    input('CALL Echo.'); input('CALL New.');
    await answer(['Stale']); assert.match(rows()[0].textContent, /Loading/);
    await answer(['Fresh'], 'New'); assert.equal(rows()[0].textContent, 'Fresh');
    input('CALL Echo.'); key('Escape'); await answer(['Stale']);
    assert.equal(popup().style.display, 'none');
    input('CALL Echo.'); el.value = 'other tab'; await answer(['Stale']);
    assert(!key('Enter')); assert.equal(el.value, 'other tab');
    input('CALL Echo.'); el.selectionStart = el.selectionEnd = 0;
    document.dispatchEvent({ type: 'selectionchange' }); await answer(['Stale']);
    assert.equal(popup().style.display, 'none');
    input('CALL Echo.'); sandbox.ownerId = 'second'; await answer(['Stale']);
    assert(!key('Enter')); assert.equal(el.value, 'CALL Echo.');

    input('capabilities { alias T=ABCD binary_hash=FFFF E }\nCALL alias.');
    assert.deepEqual(requests.at(-1).call_api_bindings, [{ petname: 'alias', token: 'abcd', binary_hash: 'ffff' }]);
    await answer(['Actual'], 'alias');
    assert(key('Enter')); assert.match(el.value, /CALL alias.Actual$/);
    await answer(['Actual'], 'alias');
    input('capabilities { Echo.Open E }\nCALL Echo.Open');
    assert.equal(pending.length, 0);
    input('capabilities { Echo T=aa E, echo T=bb E }\nCALL Echo.');
    assert.equal(pending.length, 0); assert.match(rows()[0].textContent, /Ambiguous/);
    input('CALL Echo.'); await answer(['Wrong'], 'Echo', { token: 'a', selectedToken: 'b' });
    assert.match(rows()[0].textContent, /unavailable/);
    input('CALL Echo.'); await answer(['Wrong'], 'Echo', { revision: 'a', selectedRevision: 'b' });
    assert.match(rows()[0].textContent, /unavailable/);
    console.log('asm method popup: dot, filtering, keyboard/click, empty/unavailable, stale, aliases/collisions passed');
})().catch(err => { console.error(err); process.exitCode = 1; });