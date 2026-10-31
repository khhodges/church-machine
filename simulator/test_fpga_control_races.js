'use strict';
// Run the actual control functions with fake DOM/HTTP. Never contact hardware.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync('server/fpga_status.html', 'utf8');
const source = html.slice(html.indexOf('  var ctlBusy = false;'),
    html.indexOf('  function awaitFirstStepRetirement()'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
    const elements = new Map(), requests = [], notes = [];
    let timer = 0;
    const context = {
        Date, JSON, console,
        setInterval: () => ++timer, clearInterval() {},
        document: {getElementById(id) {
            if (!elements.has(id)) elements.set(id, {
                disabled: false, classList: {toggle() {}}
            });
            return elements.get(id);
        }},
        fetch(url, options) {
            return new Promise(resolve => requests.push({url, options, resolve}));
        },
        note: message => notes.push(message),
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    context.bindControlRequest = body => body; // explicit fake target
    context.controlHeaders = () => ({});
    context.runUnlocked = true;
    function respond(request, data, status = 200) {
        request.resolve({
            ok: status === 200, status,
            json: async () => data,
            text: async () => JSON.stringify(data)
        });
    }
    return {c:context, elements, requests, notes, respond};
}
(async () => {
    // Queued Run retains its lock; a second Run cannot be sent. Stop remains enabled.
    let h = harness(), result;
    h.c.sendCmd({cmd:'r'}, 'RUN', ok => {
        result = ok; h.c.boardRunning = ok; h.c.updateRunButton();
    });
    h.respond(h.requests[0], {ok:true,id:1});
    await tick();
    assert.equal(h.c.ctlBusy, true);
    assert.equal(h.c.pendingExecutionCmd, 'r');
    assert.equal(h.elements.get('btnRun').disabled, true);
    assert.equal(h.elements.get('btnStop').disabled, false);
    h.c.sendCmd({cmd:'r'}, 'RUN');
    assert.equal(h.requests.length, 1);
    assert.equal(result, undefined);
    h.c.cmdWatchTick();
    h.respond(h.requests[1], {command_delivery:{id:1,cmd:'r',write_ts:1,write_ok:true}});
    await tick();
    assert.equal(result, true);
    assert.equal(h.c.ctlBusy, false);
    assert.equal(h.elements.get('btnStop').disabled, false);

    // A stale Run status must not finish or unlock the replacement Stop watcher.
    h = harness();
    h.c.sendCmd({cmd:'r'}, 'RUN', () => assert.fail('superseded callback'));
    h.respond(h.requests[0], {ok:true,id:1}); await tick();
    h.c.cmdWatchTick();
    h.c.sendCmd({cmd:'h'}, 'STOP', ok => {result=ok;}, true);
    h.respond(h.requests[2], {ok:true,id:2}); await tick();
    h.respond(h.requests[1], {command_delivery:{id:1,cmd:'r',write_ts:1,write_ok:true}});
    await tick();
    assert.equal(h.c.cmdWatch.id, 2);
    assert.equal(h.c.ctlBusy, true);
    h.c.cmdWatchTick();
    h.respond(h.requests[3], {bridge_connected:true, command_delivery:{
        id:2,cmd:'h',write_ts:1,write_ok:true,board_halt_confirmed:false}});
    await tick();
    assert.equal(h.c.cmdWatch.id, 2, 'write alone is not halt confirmation');
    h.c.cmdWatchTick();
    h.respond(h.requests[4], {bridge_connected:true, command_delivery:{
        id:2,cmd:'h',write_ts:1,write_ok:true,board_halt_confirmed:true}});
    await tick();
    assert.equal(h.c.cmdWatch, null);
    assert(h.notes.some(n => n.startsWith('STOP confirmed')));

    // Stop conflicting with an in-progress serial write restores the Run watch.
    for (const failure of ['http', 'network']) {
        h = harness();
        h.c.sendCmd({cmd:'r'}, 'RUN', ok => { h.c.boardRunning=ok; });
        h.respond(h.requests[0], {ok:true,id:1}); await tick();
        h.c.sendCmd({cmd:'h'}, 'STOP', () => {}, true);
        if (failure === 'http') h.respond(h.requests[1], {error:'bridge write in progress'}, 409);
        else h.requests[1].resolve({text:async()=>{throw Error('network unavailable');}});
        await tick();
        assert.equal(h.c.cmdWatch.id, 1);
        assert.equal(h.c.pendingExecutionCmd, 'r');
        assert.equal(h.c.ctlBusy, true);
        assert.equal(h.elements.get('btnStop').disabled, false);
        h.c.cmdWatchTick();
        h.respond(h.requests[2], {command_delivery:{id:1,cmd:'r',write_ts:1,write_ok:true}});
        await tick();
        assert.equal(h.c.boardRunning, true);
    }
    // Step also remains serialized while queued.
    h = harness();
    h.c.sendCmd({cmd:'s'}, 'STEP');
    h.respond(h.requests[0], {ok:true,id:7}); await tick();
    assert.equal(h.c.pendingExecutionCmd, 's');
    assert.equal(h.elements.get('btnStep').disabled, true);
    assert.equal(h.elements.get('btnStop').disabled, false);
    console.log('PASS: Run/Step locking, priority Stop, stale responses, halt evidence and rejected-Stop recovery');
})().catch(error => {console.error(error); process.exitCode=1;});
