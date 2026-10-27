'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');
const start = source.indexOf('function _namespaceCatalogRows()');
const end = source.indexOf('window.toggleLumpLibrary', start);
const scope = {window: {}};
vm.createContext(scope);
vm.runInContext(source.slice(start, end), scope);
const old = {token:'12345678',filename:'test.Old.lump',binary_hash:'a'.repeat(64),
    archived:true, abstraction:'test.Object', ns_slot:99};
const newer = {...old,token:'87654321',filename:'test.New.lump',binary_hash:'b'.repeat(64),archived:false};
const rows = [{slot:4,name:'test.Object',kind:'lump',
    selection:{token:old.token,filename:old.filename,binaryHash:old.binary_hash}}];
let catalog = scope._namespaceCatalog([old,newer],rows);
assert.equal(catalog.assigned.length,1);
assert.equal(catalog.assigned[0].filename,old.filename);
assert.equal(catalog.assigned[0].ns_slot,4);
assert.equal(catalog.assigned[0].archived,true);
assert.equal(scope._namespaceCatalog([newer],rows).assigned.length,0);
assert.equal(scope._namespaceCatalog([newer],rows).unavailable.length,1);
assert.equal(scope._namespaceCatalog([{...old,binary_hash:newer.binary_hash}],rows).assigned.length,0);
assert.equal(scope._namespaceCatalog([old,old],rows).unavailable.length,1);
assert.equal(scope._namespaceCatalog([old],[]).assigned.length,0);
assert.equal(scope._namespaceCatalog([], [{kind:'lump',slot:9,name:'ide.Mint'}]).unavailable.length,1);
scope.window._nsState = {abstractions:rows};
assert.equal(scope._namespaceCatalogRows(),rows);
scope.window.NamespaceDesignV1 = {state:{active:true,document:{rows:[]}}};
assert.equal(scope._namespaceCatalogRows().length,0,'empty selected Namespace never falls back');
scope.window.NamespaceDesignV1.state.document = null;
assert.equal(scope._namespaceCatalogRows().length,0,'unloaded selected Namespace never falls back');
assert.ok(source.includes('namespaceSnapshot !== JSON.stringify(_namespaceCatalogRows())'));
assert.ok(source.includes('_ptToken && (libraryBrowsing || lumps.some'));
console.log('PASS Namespace catalog: exact historical selection, slot authority, no latest fallback, unavailable and empty states');

(async () => {
    const nodes = {};
    const node = id => nodes[id] ||= {innerHTML:'',textContent:'',value:'',
        querySelectorAll:() => []};
    let current = newer.token, registered;
    Object.assign(scope, {
        document:{getElementById:node}, console,
        fetch:async () => ({ok:true,json:async () => [old,newer]}),
        _pendingLumpAbstractionName:null, _pendingLumpMethodName:null,
        _escHtml:String, _lumpSortOrder:'name', _lumpsSorted:items => items,
        _repositoryPrimaryLumps:items => items.filter(item => !item.archived),
        _setLumpRepositoryCollapsed:() => {}, _updateLumpViewingLabel:() => {},
        updateLiveLumpBanner:() => {}, _updateLumpRepoCount:() => {},
    });
    scope.window.NamespaceDesignV1.state.document = {rows};
    scope.window._lumpRepositoryFollowsExecution = false;
    scope.window.LumpRegistry = {
        registerFromServer:items => {registered = [...(registered || []), ...items];},
        getCurrent:() => current, setCurrent:value => {current = value;},
        consumePending:() => newer.token,
    };
    vm.runInContext(source.slice(source.indexOf('async function renderLumps('),
        source.indexOf('// Called by the lump picker')),scope);
    await scope.renderLumps();
    assert.ok(registered.some(row => row.token === newer.token),'shared lookup retains the full library');
    assert.equal(current,null,'unassigned pending/history tokens cannot select a replacement');
    assert.match(nodes.lumpsListContent.innerHTML,/Selected Namespace/);
    assert.match(nodes.lumpsListContent.innerHTML,/12345678/);
    assert.doesNotMatch(nodes.lumpsListContent.innerHTML,/87654321/);
    assert.match(nodes.lumpsDetailContent.textContent,/No replacement/);
    scope.window.LumpRegistry.consumePending = () => null;
    scope.window._lumpLibraryBrowsing = true;
    await scope.renderLumps();
    assert.match(nodes.lumpsListContent.innerHTML,/browsing does not assign/);
    assert.match(nodes.lumpsListContent.innerHTML,/87654321/);
    scope.window._lumpLibraryBrowsing = false;
    scope.window.NamespaceDesignV1.state.document = {rows:[]};
    await scope.renderLumps();
    assert.doesNotMatch(nodes.lumpsListContent.innerHTML,/12345678|87654321/);
    // Opening detail while the list is in flight must not strand the loader
    // or let the late list response replace the user's detail/History tab.
    scope.window.NamespaceDesignV1.state.document = {rows};
    let release;
    scope.fetch = () => new Promise(resolve => { release = resolve; });
    const loading = scope.renderLumps();
    assert.match(nodes.lumpsListContent.innerHTML, /Loading lumps/);
    const detailSource = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
    scope._lumpEditDirty = false;
    node('liveLumpBanner').style = {};
    vm.runInContext(detailSource.slice(detailSource.indexOf('function showLumpDetail('),
        detailSource.indexOf('    const lump = options && options.assignedLump')) + '\n}', scope);
    scope.showLumpDetail(newer.token);
    nodes.lumpsDetailContent.innerHTML = 'newer History tab';
    release({ok:true,json:async () => [old,newer]});
    await loading;
    assert.doesNotMatch(nodes.lumpsListContent.innerHTML,/Loading lumps/);
    assert.match(nodes.lumpsListContent.innerHTML,/12345678/);
    assert.equal(current,newer.token,'late list cannot replace explicit detail selection');
    assert.equal(nodes.lumpsDetailContent.innerHTML,'newer History tab');
    // A newer list request still supersedes an older request, including errors.
    const first = scope.renderLumps();
    const rejectOld = release;
    scope.fetch = async () => ({ok:true,json:async () => [old,newer]});
    await scope.renderLumps();
    const latestHtml = nodes.lumpsListContent.innerHTML;
    rejectOld({ok:true,json:async () => {throw Error('old response failed');}});
    await first;
    assert.equal(nodes.lumpsListContent.innerHTML,latestHtml);
    scope.fetch = async url => {
        assert.match(url,/exact_filename=test.Old.lump/);
        assert.match(url,/binary_hash=aaaa/);
        return {ok:true,json:async () => ({filename:old.filename,binary_hash:old.binary_hash,words:[0]})};
    };
    let direct = await scope._resolveNamespaceCatalog([], rows);
    assert.equal(direct.assigned.length,1,'missing manifest row cannot veto exact assigned bytes');
    assert.equal(direct.assigned[0].ns_slot,4);
    scope.fetch = async () => ({ok:true,json:async () =>
        ({filename:newer.filename,binary_hash:newer.binary_hash,words:[0]})});
    direct = await scope._resolveNamespaceCatalog([],rows);
    assert.equal(direct.assigned.length,0,'direct resolution rejects substituted bytes');
    assert.equal(direct.unavailable.length,1);
    console.log('PASS catalog rendering: Namespace scope, separate library, empty selection and shared cache');
})().catch(error => {console.error(error); process.exitCode = 1;});
