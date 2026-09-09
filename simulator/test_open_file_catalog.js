'use strict';

/* Focused contract test for the unified Open File catalog.  This is
 * intentionally source-level: the catalog is browser code, while this test
 * must remain runnable with the repository's cheapest node checks. */
const fs = require('fs');
const assert = require('assert');
const shell = fs.readFileSync(__dirname + '/app-shell.js', 'utf8');
const compile = fs.readFileSync(__dirname + '/app-compile.js', 'utf8');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

assert(shell.includes("fetch('/api/source-files')"));
assert(shell.includes("fetch('/api/lumps/list')"));
assert(shell.includes("function openCatalogBuiltin"));
assert(shell.includes("function openCatalogFile"));
assert(shell.includes("function openCatalogLump"));
assert(shell.includes("function openCatalogPersonal"));
assert(shell.includes('function renameUserTab'));
assert(shell.includes('function deleteCatalogPersonal'));
assert(shell.includes('+ New Program'));
assert(shell.includes('class="of-item-open"'));
assert(shell.includes("closeOpenFileDialog();\n    const dialog = document.getElementById('newTabDialog')"));
assert(shell.includes("_renderOpenFileList((document.getElementById('openFileSearch') || {}).value || '')"));
// Catalog rows are containers: the open control and Rename/Delete controls are
// siblings, never nested interactive buttons.
assert(shell.includes("html += '<div class=\"of-item'"));
assert(!shell.includes("'<button class=\"of-item'"));
assert(shell.includes("var groups = { 'LUMPs': [], 'Code Examples': [] }"));
assert(shell.includes("f.kind === 'lump' ? 'LUMPs' : 'Code Examples'"));
assert(shell.includes("(Number(b.date) || 0) - (Number(a.date) || 0)"));
assert(shell.includes("date:l.compiled_at || 0"));
assert(shell.includes("date:f.modified_at || 0"));
assert(shell.includes('f.name, f.language, f.path'));
assert(html.includes('class="of-item-date"') || html.includes('.of-item-date'));
assert(run.includes('window._activeBuiltInKey'));
assert(run.includes("return { type: 'example', id: window._activeBuiltInKey }"));
assert(run.includes('Restore Draft') && run.includes('Discard Draft'));

// These are the five names whose display spelling carries product meaning.
[
    "led_control: 'LED Flash ✦'",
    "led_dr_test: 'LED DR Test ✦'",
    "constants_dot: 'Constants Dot ★'",
    "stack_overflow: 'Stack Overflow ✦'",
    "recall_demo: 'recall() ✦'"
].forEach(name => assert(shell.includes(name), `missing catalog name: ${name}`));

// Every registered group remains a source of catalog entries, but the old
// horizontal controls are no longer part of the live document.
const groups = compile.match(/^\s{4}[a-z]+:\s+\[/gm) || [];
assert(groups.length >= 7, 'LANG_EXAMPLE_GROUPS lost a language group');
assert(!html.includes('class="example-tabs-row"'));
assert(!html.includes('id="exampleTabsScroll"'));
assert(!html.includes('id="exampleSearchBox"'));
assert(!html.includes('onclick="scrollExamples('));

console.log('Open File catalog contracts: PASS');