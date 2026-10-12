'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Use the served ordering, not CommonJS or a separate hand-written load order.
const dependencies = new Set(['abstract_gt_manager.js', 'thread_design.js',
    'architecture_contracts.js', 'idx1-runtime.js', 'simulator.js',
    'namespace-runtime-view.js', 'namespace-runtime-core.js']);
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"/g)]
    .map(match => match[1]).filter(name => dependencies.has(name));
for (const name of dependencies) assert(scripts.includes(name), `${name} missing from served manifest`);
const context = vm.createContext({console});
vm.runInContext('window = globalThis', context);
for (const name of scripts) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), context, {filename: name});
}
vm.runInContext(`
    const memory = new Uint32Array(8192);
    memory[0] = ((31 << 27) | (64 << 10) | (1 << 8)) >>> 0;
    const runtime = ChurchSimulator.fromNamespaceImage(memory,
        {word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 0});
    if (runtime.namespaceGeometry().count !== 64 || runtime.mElevation) {
        throw new Error('Browser Namespace factory or privilege initialization failed');
    }
    if (runtime.readNSEntry(0) !== null) throw new Error('Metadata exposed as capability');
`, context);
console.log('Namespace runtime loads in served browser order without CommonJS.');
