'use strict';

const {
    _lumpLeaseInfo,
    _lumpLeaseIsWaiting,
    _lumpLeaseWaitingMessage,
    _lumpLeaseSafeIdentity,
    _lumpLeaseStage,
    _lumpLeaseMessagePayload,
    _lumpLeaseCancelPayload,
    _lumpLeaseCopyDotName,
    _lumpLeaseRenewPayload,
    _lumpLeaseRenewUrl,
    _lumpLeaseWaitUrl,
    _lumpLeaseStartHeartbeat,
} = require('./lump_lease_ui.js');
const {_lumpSaveRequest} = require('./lump_save_handler.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
function check(label, value) {
    console.log((value ? 'PASS ' : 'FAIL ') + label);
    if (value) pass++;
}

const response = {
    status: 423,
    lease_waiting: true,
    dot_name: 'SelfTest',
    lease: {
        holder: { display_name: 'Alex' },
        canonical_dot_name: 'SelfTest',
        operation_label: 'SelfTest',
        started_at: '2026-09-18T10:42:00Z',
        current_stage: 'compiling_and_verifying',
        operation_id: 'op-safe-123',
        canonical_dot_name: 'SelfTest',
        links: { message: '/server-provided-message-url', cancel: '/server-provided-cancel-url' },
        renew_url: '/server-provided-renew-url',
        wait_url: '/server-provided-wait-url',
    },
};
const info = _lumpLeaseInfo(response);
check('canonical dot-name and safe holder are retained', info.dotName === 'SelfTest' && info.holder === 'Alex');
check('lease stage is normalized for programmer wording', _lumpLeaseStage('compiling_and_verifying') === 'compiling and verifying');
check('waiting response is recognized without a browser tab identity', _lumpLeaseIsWaiting(response, 423));
const message = _lumpLeaseWaitingMessage(response, () => '10:42 AM');
check('waiting message says draft is safe and names current work',
    /Alex is compiling and verifying SelfTest/.test(message) &&
    !/SelfTest SelfTest/.test(message) &&
    /Your draft is safe/.test(message) && /10:42 AM/.test(message));
check('private account-like values are never displayed as identity',
    _lumpLeaseSafeIdentity({ email: 'secret@example.test', account_id: 'acct-123' }) ===
    'Another IDE session');
check('operation-scoped message URL is accepted from server links',
    info.messageUrl === '/server-provided-message-url');
const serverActions = {...response, lease: {...response.lease, links: undefined},
    actions: {message:'/message', cancel:'/cancel', wait:'/wait', renew:'/renew'}};
check('server action URLs drive every lease action',
    _lumpLeaseInfo(serverActions).messageUrl === '/message' &&
    _lumpLeaseInfo(serverActions).cancelUrl === '/cancel');
check('default message endpoint is the lease API',
    _lumpLeaseInfo({...response, lease: {...response.lease, links: undefined}}).messageUrl ===
    '/api/lumps/lease/message');
check('message payload carries only dot-name, operation, and text',
    JSON.stringify(_lumpLeaseMessagePayload(info, 'Please share progress')) ===
    '{"dot_name":"SelfTest","operation_id":"op-safe-123","text":"Please share progress"}');
check('cancel payload is JSON scoped to the same operation',
    JSON.stringify(_lumpLeaseCancelPayload(info)) ===
    '{"dot_name":"SelfTest","operation_id":"op-safe-123"}');
check('copy name is canonical and distinct without display punctuation',
    _lumpLeaseCopyDotName('SelfTest') === 'SelfTest.Copy' &&
    !/[ ()]/.test(_lumpLeaseCopyDotName('SelfTest')));
check('real server canonical identity and action URLs are honored',
    info.dotName === 'SelfTest' && _lumpLeaseRenewUrl(response) === '/server-provided-renew-url' &&
    _lumpLeaseWaitUrl(response) === '/server-provided-wait-url');
check('renew heartbeat payload stays operation-scoped',
    JSON.stringify(_lumpLeaseRenewPayload(info)) ===
    '{"dot_name":"SelfTest","operation_id":"op-safe-123"}');

const browser = {
    window: {},
    console,
    setInterval: function(fn) { browser.heartbeatTick = fn; return 1; },
    clearInterval: function() {},
    crypto: { randomUUID: () => 'browser-op' },
    sessionStorage: {getItem:()=>null,setItem:()=>{},removeItem:()=>{},length:0,key:()=>null},
};
browser.window = browser;
vm.createContext(browser);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'lump_lease_ui.js'), 'utf8'), browser);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'lump_save_handler.js'), 'utf8'), browser);
const browserClassification = vm.runInContext(
    `_lumpSaveFailureClassification(423, ${JSON.stringify(response)})`, browser);
check('browser global classifies a 423 as lease waiting without require',
    browserClassification.kind === 'lease-wait');

(async () => {
    let renewal;
    let heartbeatTick;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    global.setInterval = function(fn) { heartbeatTick = fn; return 1; };
    global.clearInterval = function() {};
    const stopHeartbeat = _lumpLeaseStartHeartbeat(async (url, options) => {
        renewal = {url, body: JSON.parse(options.body)};
        return {ok:true};
    }, response, 1);
    await heartbeatTick();
    stopHeartbeat();
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    check('heartbeat renews the server-issued canonical lease',
        renewal && renewal.url === '/server-provided-renew-url' &&
        renewal.body.dot_name === 'SelfTest' &&
        renewal.body.operation_id === 'op-safe-123');

    let caught;
    try {
        await _lumpSaveRequest(async () => ({
            ok: false, status: 423,
            text: async () => JSON.stringify(response),
        }), '/api/lumps/save', {binary:[1], metadata:{}});
    } catch (error) { caught = error; }
    check('lease wait errors reach callers with kind and response',
        caught && caught.kind === 'lease-wait' && caught.response &&
        caught.response.lease_waiting === true && caught.response.dot_name === 'SelfTest');
    console.log(`\n${pass} tests: ${pass} passed, 0 failed`);
    if (pass !== 16) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });