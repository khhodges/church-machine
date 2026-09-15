'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('simulator/browser_diagnostics.js', 'utf8');
const html = fs.readFileSync('simulator/index.html', 'utf8');
assert(html.indexOf('browser_diagnostics.js') < html.indexOf('function describeNonError'));
const handlers = {};
const sent = [];
const warnings = [];
let now = 1750000000000;
class Clock extends Date {
    static now() { return now; }
}
const window = {
    innerWidth: 1280, innerHeight: 720,
    addEventListener(name, fn, opts) {
        (handlers[name] ||= []).push(fn);
        if (['error', 'unhandledrejection'].includes(name)) assert.equal(opts, true);
    },
};
const context = {
    window, Date: Clock, URL, Map,
    console: {warn: (...args) => warnings.push(args)},
    location: {origin: 'https://ide.example', href: 'https://ide.example/simulator/~/abc12345?secret=PRIVATE',
        pathname: '/simulator/~/abc12345'},
    navigator: {userAgent: 'Chrome/123'},
    document: {getElementById: () => ({classList: {contains: name => name === 'active'}})},
    fetch: (url, options) => {
        assert.equal(url, '/api/browser-diagnostics');
        assert.equal(options.credentials, 'omit');
        assert.equal(options.keepalive, true);
        sent.push(JSON.parse(options.body));
        return Promise.resolve({ok: true});
    },
};
vm.createContext(context);
vm.runInContext(code, context);
const dispatch = (name, event = {}) => handlers[name].forEach(fn => fn(event));
dispatch('scroll');
const error = new Error('PRIVATE source and credential');
error.name = 'TypeError';
error.stack = 'TypeError: PRIVATE\n at PRIVATE (https://ide.example/simulator/app-run.js?secret=PRIVATE:123:4)\n at x (https://external.example/PRIVATE.js:2:4)';
dispatch('error', {target: window, error, filename: 'https://ide.example/simulator/app-run.js?secret=PRIVATE', lineno: 123, colno: 4});
assert.equal(sent.length, 1);
assert.equal(sent[0].interaction, 'scroll');
assert.equal(sent[0].page, 'editor');
assert.equal(sent[0].version, 'abc12345');
assert.deepEqual(sent[0].frames, [{file:'app-run.js',line:123,column:4}]);
assert(!JSON.stringify(sent).includes('PRIVATE'));
dispatch('error', {target: window, error, filename: 'https://ide.example/simulator/app-run.js', lineno:123,colno:4});
assert.equal(sent.length, 1, 'duplicates suppressed');
let prevented = 0;
let stopped = 0;
dispatch('error', {
    target: window, error: 'PRIVATE non-Error throw',
    preventDefault: () => { prevented++; },
    stopImmediatePropagation: () => { stopped++; },
});
assert.equal(prevented, 1, 'non-Error window errors are contained early');
assert.equal(stopped, 1, 'non-Error window errors stop later listeners');
assert.equal(warnings.length, 1, 'contained non-Error errors remain locally visible');
assert(!JSON.stringify(warnings).includes('PRIVATE'),
    'local containment warning does not include thrown contents');
const realError = new Error('real error remains observable');
prevented = 0;
stopped = 0;
dispatch('error', {
    target: window, error: realError,
    filename: 'https://ide.example/simulator/app-shell.js', lineno: 7, colno: 2,
    preventDefault: () => { prevented++; },
    stopImmediatePropagation: () => { stopped++; },
});
assert.equal(prevented, 0, 'real Error events are not suppressed');
assert.equal(stopped, 0, 'real Error events reach the monitor');
prevented = 0;
stopped = 0;
dispatch('unhandledrejection', {
    reason: 'PRIVATE',
    preventDefault: () => { prevented++; },
    stopImmediatePropagation: () => { stopped++; },
});
assert.equal(sent.at(-1).error_type, 'NonError');
assert.equal(prevented, 1, 'non-Error rejections are contained early');
assert.equal(stopped, 1, 'non-Error rejections stop later listeners');
assert.equal(warnings.length, 2, 'contained non-Error rejections remain locally visible');
assert(!JSON.stringify(warnings).includes('PRIVATE'),
    'rejection warning does not include thrown contents');
prevented = 0;
stopped = 0;
dispatch('error', {
    target: {tagName:'LINK', href:'https://ide.example/simulator/styles-lumps.css?key=PRIVATE'},
    preventDefault: () => { prevented++; },
    stopImmediatePropagation: () => { stopped++; },
});
assert.equal(sent.at(-1).resource, 'styles-lumps.css');
assert.equal(prevented, 0, 'resource failures remain observable');
assert.equal(stopped, 0, 'resource failures reach later listeners');
dispatch('error', {target: window, message:'ResizeObserver loop completed with undelivered notifications.'});
assert.equal(sent.at(-1).kind, 'resize_observer');
for (let i=0;i<20;i++) dispatch('error', {filename: 'https://ide.example/simulator/app-run.js', lineno:i});
assert.equal(sent.length, 10, 'minute cap');
now += 61000;
dispatch('error', {filename: 'https://ide.example/simulator/app-shell.js', lineno:2});
assert.equal(sent.length, 11);
assert.equal(sent.at(-1).interaction, 'none');
context.fetch = () => Promise.reject(new Error('offline'));
dispatch('error', {filename: 'https://ide.example/simulator/app-shell.js', lineno:3});
context.fetch = () => { throw new Error('transport unavailable'); };
assert.doesNotThrow(() => dispatch('error', {filename: 'https://ide.example/simulator/app-shell.js', lineno:4}));
if (process.argv.includes('--emit')) console.log(JSON.stringify(sent[0]));
else console.log('PASS privacy, frames, resource errors, rejection, observer errors, dedup, rate limit, transport failure and early order');