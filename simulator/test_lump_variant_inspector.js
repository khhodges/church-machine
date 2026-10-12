'use strict';
const assert = require('assert');
const fs = require('fs');
const {JSDOM} = require('jsdom');
const crypto = require('crypto');
const {embedSelfDefinition} = require('./lump_builder');
const frames = require('./lump-content-frame');

(async () => {
    const dom = new JSDOM('<section id="panel" hidden></section>', {runScripts: 'outside-only'});
    const w = dom.window;
    Object.defineProperty(w, 'crypto', {value: crypto.webcrypto});
    w.LumpContentFrame = frames;
    w.LumpPublicApi = require('./lump-public-api');
    const id = 'a'.repeat(64);
    const base = Array(64).fill(0);
    base[0] = ((31 << 27) | (1 << 10) | 1) >>> 0;
    base[63] = 0x82000006;
    const records = {}, binaries = {};
    for (const [profile, tier] of [['api',0], ['compact',1], ['full',2]]) {
        const words = embedSelfDefinition(base, {name:'InspectorFixture', methods:[]},
            '// A retained comment\nconst answer = 42;\n', tier, 'javascript');
        const raw = Buffer.alloc(words.length * 4);
        words.forEach((word, i) => raw.writeUInt32BE(word >>> 0, i * 4));
        binaries[profile] = raw;
        records[profile] = {bytes:raw.length, sha256:crypto.createHash('sha256').update(raw).digest('hex')};
    }
    const requests = [];
    w.fetch = async (url, options) => {
        requests.push({url, options});
        assert(!options.method || options.method === 'GET', 'inspection cannot write');
        assert(url.startsWith('/api/lump-variants/' + id), 'never look up latest by name or primary hash');
        const profile = url.split('/')[4];
        return profile ? new Response(binaries[profile]) : new Response(JSON.stringify({variants:records}));
    };
    let editorSelection;
    w.openLumpInEditor = async (token, options) => { editorSelection = {token, options}; };
    w.eval(fs.readFileSync(__dirname + '/lump-variant-inspector.js', 'utf8'));
    const panel = w.document.getElementById('panel');
    const lump = {token:'12345678', filename:'InspectorFixture.1.12345678.lump',
        abstraction:'<unsafe>', lump_version:99, variant_bundle_id:id, variant_primary_hash:records.api.sha256};
    w.LumpVariantInspector.open(lump, panel);
    for (let n=0; n<100 && panel.textContent.includes('Loading exact revision'); n++)
        await new Promise(resolve => setTimeout(resolve, 10));
    assert(!panel.textContent.includes('Inspection unavailable'), panel.textContent);
    assert(!panel.textContent.includes('Loading exact revision'));
    assert.equal(panel.querySelectorAll('.lvi-pane').length, 3);
    assert.equal(panel.querySelector('unsafe'), null, 'names are escaped with textContent');
    assert.equal(panel._profileIndex, 0);
    w.LumpVariantInspector.open(lump, panel);
    assert.equal(panel._profileIndex, 1);
    w.LumpVariantInspector.open(lump, panel);
    assert.equal(panel._profileIndex, 2);
    w.LumpVariantInspector.open(lump, panel);
    assert.equal(panel._profileIndex, 0);
    assert.equal(requests.length, 4, 'cycling reuses only the already-loaded exact snapshot');
    const panes = panel.querySelectorAll('.lvi-pane');
    for (const [index, profile] of ['full', 'compact', 'api'].entries()) {
        const parts = [...panes[index].querySelectorAll('[data-storage-bytes]')];
        assert.equal(parts.length, 6, 'six disjoint storage categories');
        assert.equal(parts.reduce((sum, part) => sum + Number(part.dataset.storageBytes), 0),
            binaries[profile].length, 'displayed byte counts must sum to the exact binary length');
        const raw = binaries[profile];
        const header = raw.readUInt32BE(0);
        const cw = (header >>> 10) & 0x1fff;
        const apiHeader = raw.readUInt32BE((cw + 1) * 4);
        const apiLength = apiHeader & 0xffff;
        const paddedApi = Math.ceil(apiLength / 4) * 4;
        assert.equal(Number(parts[0].dataset.storageBytes), cw * 4);
        assert.equal(Number(parts[1].dataset.storageBytes), (header & 255) * 4);
        assert.equal(Number(parts[2].dataset.storageBytes), paddedApi);
        const sourceLength = profile === 'api' ? 0 : raw.readUInt32BE((cw + 2) * 4 + paddedApi);
        assert.equal(Number(parts[3].dataset.storageBytes), Math.ceil(sourceLength / 4) * 4);
        assert.equal(Number(parts[4].dataset.storageBytes), profile === 'api' ? 8 : 12);
        assert(panes[index].querySelector('.lvi-storage-total').textContent.includes(raw.length.toLocaleString()));
        assert(parts.every(part => /\([\d,]+ bytes\)/.test(part.querySelector('summary').textContent)));
    }
    assert.throws(() => w.LumpVariantInspector.byteCounts(
        [0, 0xab010001, 0, 0xffffffff], {header:{cw:0,cc:0}}), /exceed/);
    assert(panes[0].textContent.includes('// A retained comment'));
    assert(!panes[1].textContent.includes('// A retained comment'));
    assert(panes[2].textContent.includes('No source embedded'));
    assert.equal(panel.querySelectorAll('.lvi-pane button').length, 1, 'only Full can open the editor');
    panes[0].querySelector('button').click();
    assert.equal(editorSelection.options.exactSavedArtifact.binary_hash, records.api.sha256);
    assert.equal(editorSelection.options.exactSavedArtifact.lump_version, 99);
    await assert.rejects(w.LumpVariantInspector.inspect(id, 'full', {...records.full, sha256:'b'.repeat(64)}),
        /do not match/);
    const missing = w.document.createElement('section');
    w.document.body.appendChild(missing);
    const before = requests.length;
    w.LumpVariantInspector.open({abstraction:'Historical',lump_version:1}, missing);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(missing.textContent.includes('No exact three-form bundle'));
    assert.equal(requests.length, before, 'missing bundle never falls back to another revision');
    const app = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
    assert.match(app, /<button type="button" class="lump-hs-chip lump-version-badge"/);
    assert.match(app, /LumpVariantInspector\.open\(lump,/);
    // Exercise the actual click handler while its Binary ancestor is hidden.
    const binary = w.document.createElement('div');
    binary.id = 'lumpWsPanel-binary';
    binary.style.display = 'none';
    w.document.body.appendChild(binary);
    binary.appendChild(panel);
    const logic = w.document.createElement('div');
    logic.id = 'lumpWsPanel-logic';
    logic.style.display = 'block';
    w.document.body.appendChild(logic);
    const content = w.document.createElement('div');
    content.innerHTML = '<button class="lump-version-badge">v99</button><button class="lump-compare-forms">Compare 3 forms</button>';
    binary.appendChild(content);
    panel.id = 'lumpVariantInspector_12345678';
    w.contentEl = content; w.lump = lump; w._tk = '12345678';
    let scrolled = false;
    panel.scrollIntoView = () => { scrolled = true; };
    const tabStart = app.indexOf('function switchLumpWsTab(tab)');
    w.eval('let _lumpWsActiveTab = "logic"; let _selectedLumpToken = "12345678";' +
        app.slice(tabStart, app.indexOf('\nfunction _runSelectedLumpInSim', tabStart)));
    const handlerStart = app.indexOf("    contentEl.querySelectorAll('.lump-version-badge, .lump-compare-forms')");
    w.eval(app.slice(handlerStart, app.indexOf('    // Asynchronously patch', handlerStart)));
    content.querySelector('.lump-compare-forms').click();
    assert.equal(binary.style.display, 'block');
    assert.equal(logic.style.display, 'none');
    assert.equal(w.document.activeElement, panel);
    assert(scrolled, 'comparison must be brought into view, not merely unhidden');
    const priorIndex = panel._profileIndex;
    panel.id = 'lumpVariantInspector_12345678';
    const badge = w.document.createElement('button');
    badge.id = 'lumpVersionBadge_12345678';
    badge.addEventListener('click', () => w.LumpVariantInspector.open(lump, panel));
    w.document.body.appendChild(badge);
    w.eval(app.slice(0, app.indexOf('function showLumpDetail(')));
    w._openLumpVariantInspector('12345678');
    assert.equal(panel._profileIndex, (priorIndex + 1) % 3, 'repository/catalog entry point cycles existing inspector');
    const compare = content.querySelector('.lump-compare-forms');
    let returnScrolls = 0;
    compare.scrollIntoView = () => { returnScrolls++; };
    for (let cycle = 0; cycle < 3; cycle++) {
        [...panel.querySelectorAll('button')].find(b => b.textContent === 'Close inspector').click();
        assert(panel.hidden);
        assert.equal(w.document.activeElement, compare, 'close restores focus to permanent opener');
        assert.equal(returnScrolls, cycle + 1, 'close restores the button to the visible viewport');
        assert(compare.isConnected && !compare.hidden);
        assert(content.querySelector('.lump-version-badge').isConnected);
        compare.click();
        assert(!panel.hidden, 'comparison reopens without refreshing the page');
    }
    const repository = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');
    assert.match(repository, /_openLumpVariantInspector\(btn.dataset.variantToken\)/);
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    assert(html.indexOf('src="lump-variant-inspector.js') < html.indexOf('src="app-lumps.js'));
    dom.window.close();
    console.log('PASS clickable revision inspector: three exact forms, cycling, source, hash rejection, missing bundle, editor identity');
})().catch(error => { console.error(error); process.exitCode = 1; });
