'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = source.indexOf('async function _fetchAndShowLumpTimeline(');
const end = source.indexOf('\nfunction ', start + 1);
const dom = new JSDOM('<div id="lumpHistoryBody_4a00000a"></div>');
const body = dom.window.document.getElementById('lumpHistoryBody_4a00000a');
const context = vm.createContext({
    document:dom.window.document, console,
    _lumpTokenIdentity:x => x,
    _escHtml:x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    _lumpBinaryInspection:x => x,
    _historyActivationEligibility:x => x?.activation_eligibility || {status:'unknown', reasons:[]},
    _lumpsCache:[{token:'4a000002', lump_version:35, abstraction:'CapabilityTest'}],
});
vm.runInContext(source.slice(start, end), context);
const telemetry = [{lump_version:35, lump_token:'4a000002', device_count:1, stable_status:'stable'}];
const head = {version:36, current:true, binary_available:true,
    activation_eligibility:{status:'current', reasons:[]}};
async function render(history, versions = telemetry, detail = {}, ok = true) {
    context.fetch = async (url, options) => {
        assert.equal(options, undefined, 'History must remain read-only');
        return {ok, status:503, json:async () => url.includes('version-telemetry')
            ? {versions} : {history}};
    };
    await context._fetchAndShowLumpTimeline('4a00000a', {
        token:'4a00000a', abstraction:'CapabilityTest', lump_version:35, ...detail});
}
const checked = () => body.querySelectorAll('input:checked').length;
(async () => {
    await render([head]);
    assert.equal(checked(), 1, 'telemetry cache and displayed version cannot check another row');
    assert(body.querySelector('tr[data-version="36"] input:checked'));
    assert.match(body.querySelector('tr[data-version="35"]').textContent, /Telemetry record/);
    assert.match(body.querySelector('tr[data-version="35"]').innerHTML,
        /_lumpHistoryPreview\('4a000002',35,[^)]*'4a000002','',true\)/,
        'exact active-token preview route is preserved');
    await render([{...head, bootstrap_identity:{applies:true, valid:false}}]);
    assert.equal(checked(), 1);
    assert.match(body.textContent, /Current saved — identity invalid/);
    assert.doesNotMatch(body.innerHTML, /This is the current live LUMP/);
    await render([head], telemetry, {archived:true});
    assert.equal(checked(), 0);
    await render([], telemetry);
    assert.equal(checked(), 0, 'neither detail version nor telemetry establishes a saved head');
    assert.match(body.textContent, /No current saved revision/);
    await render([head, {...head, version:37}, {version:34, binary_available:true,
        activation_eligibility:{status:'eligible', reasons:[]}}]);
    assert.equal(checked(), 0);
    assert.equal(body.querySelectorAll('input:not(:disabled)').length, 0);
    assert.match(body.textContent, /Conflicting current records/);
    await render([head], telemetry, {}, false);
    assert.equal(checked(), 0);
    assert.match(body.textContent, /History could not be verified/);
    console.log('PASS single saved authority, telemetry preview, invalid identity, archived viewing, unknown/conflicting current and HTTP failure');
})().catch(error => {console.error(error); process.exitCode = 1;});