#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const inputPath = path.join(root, 'shared', 'architecture_contracts.json');
const outputPath = path.join(root, 'simulator', 'architecture_contracts.js');
const check = process.argv.includes('--check');
const contract = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const rendered = `// Generated from shared/architecture_contracts.json.
// Run: node scripts/gen-architecture-contracts.js
(function (root, factory) {
    const value = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = value;
    root.ChurchArchitectureContracts = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    return Object.freeze(${JSON.stringify(contract, null, 2)});
});
`;

if (check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== rendered) {
        console.error('simulator/architecture_contracts.js is stale; run node scripts/gen-architecture-contracts.js');
        process.exit(1);
    }
    console.log('Architecture contract browser projection is current.');
} else {
    fs.writeFileSync(outputPath, rendered);
    console.log(path.relative(root, outputPath));
}