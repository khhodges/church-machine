'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./app-shell.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, end < 0 ? undefined : end);
}
const list = {innerHTML: ''};
const search = {value: 'ide.Mint'};
const context = vm.createContext({
    _openFileLoading: null, _openFileCache: null, _catalogActiveIdentity: null,
    window: {}, userTabs: [], _CATALOG_BUILTIN_NAMES: {},
    document: {getElementById: id => id === 'openFileList' ? list : search},
    _escHtml: value => String(value),
    _actionableJsonResponse: response => response.json(),
    fetch: async url => ({json: async () => url === '/api/source-files' ? {
        files: [{name: 'mint', abstraction: 'ide.Mint', dir: 'cloomc',
            path: 'simulator/cloomc/mint.cloomc'}]
    } : []})
});
vm.runInContext(extract('_loadOpenFileCatalog') + '\n' +
    extract('_groupOpenFileEntries') + '\n' + extract('_catalogDateText') + '\n' +
    extract('_renderOpenFileList'), context);
(async () => {
    await context._loadOpenFileCatalog();
    for (const query of ['ide.Mint', 'IDE.MINT', 'mint', 'mint.cloomc']) {
        context._renderOpenFileList(query);
        assert.ok(list.innerHTML.includes('openCatalogFile'), query);
        assert.ok(list.innerHTML.includes('ide.Mint'), query);
        assert.ok(list.innerHTML.includes('simulator%2Fcloomc%2Fmint.cloomc'), query);
    }
    context._renderOpenFileList('unrelated-source');
    assert.ok(list.innerHTML.includes('No files match'));
    console.log('PASS: declared name and filename locate the editable source');
})().catch(error => { console.error(error); process.exitCode = 1; });
