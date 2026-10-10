'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');
const master = read('docs/instruction-set.md');
const history = read('docs/instruction-set-history.md');
const inventory = JSON.parse(read('docs/instruction-set-history-inventory.json'));
const baseline = history.split('## Preserved first baseline\n\n')[1].split('\n## Earlier RETURN variant\n')[0]
    .replace(/\n<a id="[a-zA-Z0-9_-]+"><\/a>(?:<a id="[a-zA-Z0-9_-]+"><\/a>)*\n/g, '');
const earlier = history.slice(history.lastIndexOf('### RETURN (opcode 3)'));
const start = baseline.indexOf('### RETURN (opcode 3)');
const end = baseline.indexOf('### CHANGE (opcode 4)');
const repeated = '\n' + baseline.slice(0, start) + earlier + baseline.slice(end);
const reconstructed = inventory.originalPreamble + baseline
    + ('# Church Machine Instruction Set\n' + repeated).repeat(31);
assert.equal(crypto.createHash('sha256').update(reconstructed).digest('hex'), inventory.historicalSha256,
    'Every original historical byte must remain reconstructible, including both RETURN variants');
assert.equal((master.match(/^# Church Machine Instruction Set$/gm) || []).length, 1);
assert(!master.includes('**v1.0'));
assert.equal(inventory.baselineCopies, 32);
const source = read('simulator/app-misc.js');
const context = vm.createContext({
    escapeHtml: s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
});
vm.runInContext(source.slice(source.indexOf('function _mdSlug('), source.indexOf('\nfunction ', source.indexOf('function renderMarkdown(') + 10)), context);
const dom = new JSDOM(context.renderMarkdown(master));
const archived = new JSDOM(context.renderMarkdown(history));
for (const h of inventory.headings) {
    // The existing viewer includes inline-code tag text in heading slugs.
    const renderedSlug = context._mdSlug(h.title.replace(/`([^`]+)`/g, '<code>$1</code>'));
    assert(dom.window.document.getElementById(renderedSlug), h.title);
    assert(archived.window.document.getElementById(renderedSlug), h.title);
    for (let i = 1; i < 32; i++) assert(dom.window.document.getElementById(h.id + '-' + i));
}
for (const a of dom.window.document.querySelectorAll('a[href^="instruction-set-history.md#"]')) {
    assert(archived.window.document.getElementById(a.getAttribute('href').split('#')[1]), a.outerHTML);
}
assert(!context.renderMarkdown('<script>alert(1)</script>').includes('<script>'));
assert(!context.renderMarkdown('<a id="x" onclick="bad()"></a>').includes('onclick="bad()"'));
console.log('PASS ISA history: exact reconstruction, unique master, historical links, duplicate anchors, safe rendering');

(async () => {
    const browser = new JSDOM('<div id="docsContentTitle"></div><div id="docsContentBody"></div>');
    const requests = [];
    Object.assign(context, {
        document: browser.window.document,
        window: { innerWidth: 1200 },
        CSS: { escape: s => s },
        fetch: async url => {
            requests.push(url);
            return { content: url.endsWith('instruction-set-history.md') ? history : master };
        },
        _actionableJsonResponse: async response => response,
    });
    browser.window.HTMLElement.prototype.scrollIntoView = function () {};
    vm.runInContext(source.slice(source.indexOf('async function loadDoc('), source.indexOf('async function openDocAnchor(')), context);
    await context.loadDoc('instruction-set.md', '#return-opcode-3-31');
    const link = context.document.querySelector('a[href="instruction-set-history.md#return-opcode-3"]');
    link.dispatchEvent(new browser.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.at(-1), '/api/docs/read/instruction-set-history.md');
    assert.equal(context.document.getElementById('docsContentTitle').textContent, 'instruction-set-history.md');
    assert(context.document.getElementById('return-opcode-3'));
    console.log('PASS Reference navigation: legacy anchor to historical document and target section');
})().catch(error => { console.error(error); process.exitCode = 1; });
