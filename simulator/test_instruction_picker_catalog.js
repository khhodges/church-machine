'use strict';

const fs = require('fs');
const path = require('path');
const ChurchAssembler = require('./assembler.js');

const root = path.join(__dirname, '..');
const pickerPaths = [
    'simulator/asm-instruction-picker.js',
    'web/asm-instruction-picker.js',
];
const pseudoMnemonics = new Set(['NOP', 'HALT', 'MVN']);
const supported = new Set([
    ...Object.keys(new ChurchAssembler().opcodes),
    ...pseudoMnemonics,
]);
const concreteForms = {
    'LOAD\0CRd CRs #row': 'LOAD CR1, CR6, #1',
    'SAVE\0CRd CRs #row': 'SAVE CR1, CR6, #1',
    'CALL\0CRs': 'CALL CR1',
    'RETURN\0': 'RETURN',
    'CHANGE\0CR12 CR12 #row': 'CHANGE CR12, CR12, #1',
    'SWITCH\0CR15 CR6 #row': 'SWITCH CR15, CR6, #1',
    'TPERM\0CRd preset': 'TPERM CR1, R',
    'LAMBDA\0CRd': 'LAMBDA CR1',
    'ELOADCALL\0CRd CRs #row': 'ELOADCALL CR1, CR6, #1',
    'XLOADLAMBDA\0CRd CRs #row': 'XLOADLAMBDA CR1, CR6, #1',
    'IADD\0DRd DRs DRt': 'IADD DR1, DR2, DR3',
    'IADD\0DRd DRs #imm': 'IADD DR1, DR2, #1',
    'ISUB\0DRd DRs DRt': 'ISUB DR1, DR2, DR3',
    'ISUB\0DRd DRs #imm': 'ISUB DR1, DR2, #1',
    'MCMP\0DRd DRs': 'MCMP DR1, DR2',
    'MVN\0DRd DRs': 'MVN DR1, DR2',
    'IADD\0DRd DR0 #imm': 'IADD DR1, DR0, #1',
    'DREAD\0DRd CRs #offset': 'DREAD DR1, CR1, #1',
    'DWRITE\0DRd CRs #offset': 'DWRITE DR1, CR1, #1',
    'BFEXT\0DRd DRs #pos #width': 'BFEXT DR1, DR2, #0, #8',
    'BFINS\0DRd DRs #pos #width': 'BFINS DR1, DR2, #0, #8',
    'WORD\0value': 'WORD 1',
    'SHL\0DRd DRs #amount': 'SHL DR1, DR2, #1',
    'SHR\0DRd DRs #amount': 'SHR DR1, DR2, #1',
    'SHR\0DRd DRs #amount ASR': 'SHR DR1, DR2, #1, ASR',
    'BRANCH\0AL target': 'BRANCH AL, 0',
    'BRANCH\0EQ target': 'BRANCH EQ, 0',
    'BRANCH\0NE target': 'BRANCH NE, 0',
    'BRANCH\0GT target': 'BRANCH GT, 0',
    'BRANCH\0LT target': 'BRANCH LT, 0',
    'NOP\0': 'NOP',
    'HALT\0': 'HALT',
};
let failures = 0;

function fail(message) {
    console.error('FAIL ' + message);
    failures++;
}

function pickerEntries(source) {
    return [...source.matchAll(/\{\s*label:\s*'([^']+)',\s*instr:\s*'([^']+)',\s*ops:\s*'([^']*)'\s*\}/g)]
        .map((match) => ({ label: match[1], mnemonic: match[2], operands: match[3] }));
}

const pickerCatalogs = pickerPaths.map((relativePath) => ({
    relativePath,
    entries: pickerEntries(fs.readFileSync(path.join(root, relativePath), 'utf8')),
}));

for (const catalog of pickerCatalogs) {
    if (!catalog.entries.length) fail(`${catalog.relativePath} has no static picker entries`);
    for (const entry of catalog.entries) {
        const formKey = `${entry.mnemonic}\0${entry.operands}`;
        if (!supported.has(entry.mnemonic)) {
            fail(`${catalog.relativePath} offers unsupported mnemonic ${entry.mnemonic}`);
        }
        const expectedLabel = [entry.mnemonic, entry.operands].filter(Boolean).join(' ');
        if (!entry.label.startsWith(expectedLabel)) {
            fail(`${catalog.relativePath} label/template mismatch: ${JSON.stringify(entry)}`);
        }
        if (!concreteForms[formKey]) {
            fail(`${catalog.relativePath} has no assembler regression sample for ${expectedLabel}`);
        } else {
            const assembler = new ChurchAssembler();
            const result = assembler.assemble(concreteForms[formKey]);
            if (result.errors.length) {
                fail(`${catalog.relativePath} template ${expectedLabel} does not assemble: ` +
                    result.errors.map((error) => error.message).join('; '));
            }
        }
    }
}

const simulatorStatic = pickerCatalogs[0].entries.map(({ mnemonic, operands }) => `${mnemonic}\0${operands}`).sort();
const webStatic = pickerCatalogs[1].entries.map(({ mnemonic, operands }) => `${mnemonic}\0${operands}`).sort();
if (JSON.stringify(simulatorStatic) !== JSON.stringify(webStatic)) {
    fail('simulator and web picker static catalogs differ');
}

const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const menuEntries = [...html.matchAll(/insertInstruction\('([^']+)',\s*'([^']*)'\)/g)]
    .map((match) => ({ mnemonic: match[1], operands: match[2] }));
for (const entry of menuEntries) {
    if (!supported.has(entry.mnemonic)) {
        fail(`web context menu offers unsupported mnemonic ${entry.mnemonic}`);
    }
}

const menuStatic = menuEntries.map(({ mnemonic, operands }) => `${mnemonic}\0${operands}`).sort();
if (JSON.stringify(menuStatic) !== JSON.stringify(webStatic)) {
    fail('web context menu and web picker static catalogs differ');
}

if (failures) process.exit(1);
console.log(`PASS ${supported.size} assembler/pseudo mnemonics checked across both pickers and the web context menu`);