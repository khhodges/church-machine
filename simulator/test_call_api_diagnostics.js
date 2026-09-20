'use strict';

const assert = require('assert');
global.ChurchAssembler = require('./assembler.js');
const CLOOMCCompiler = require('./cloomc_compiler.js');

function compile(source, authorities) {
    return new CLOOMCCompiler().compileAssembly(source, [], {
        callApiAuthorities: authorities || {},
    });
}

const knownApi = {
    Echo: {
        source: 'embedded-binary',
        embedded: true,
        token: 'new',
        selectedToken: 'new',
        revision: 2,
        selectedRevision: 2,
        api: { methods: [{ name: 'Ping', index: 0 }] },
    },
};

let result = compile('capabilities { SELF E, Echo E }\nCALL CR6[Echo], #0', knownApi);
assert.equal(result.warnings.length, 0, 'known valid CALL must not warn');
assert.equal(result.errors.length, 0, 'known valid CALL must compile');

result = compile('capabilities { SELF E, Echo E }\nCALL CR6[Echo], Ping', knownApi);
assert.equal(result.warnings.length, 0, 'exact API resolves a named method without warning');
assert.equal(result.errors.length, 0, 'exact API method conventions encode the named CALL');

result = compile('capabilities { SELF E, Echo E }\nCALL CR6[Echo], #1', knownApi);
assert(result.errors.some(e => e.code === 'CALL_API_METHOD_INVALID'),
    'known API with a missing method number must be an error');

result = compile('capabilities { SELF E, Future E }\nCALL CR6[Future]', {});
assert(result.warnings.some(w =>
    w.code === 'CALL_API_UNAVAILABLE' && w.line === 2 && w.petname === 'Future'),
    'unavailable API must warn with source line and pet name');
assert.equal(result.errors.length, 0, 'unavailable API warning must not block compile');

result = compile('capabilities { SELF E, Future R }\nWORD 0x1234', {});
assert.equal(result.warnings.length, 0, 'unused data capability rows must not warn');

const staleApi = {
    Echo: Object.assign({}, knownApi.Echo, { selectedToken: 'old' }),
};
result = compile('capabilities { SELF E, Echo E }\nCALL CR6[Echo], #0', staleApi);
assert(result.warnings.some(w => w.code === 'CALL_API_UNAVAILABLE'),
    'wrong-revision API must not be accepted as proof');
assert.equal(result.errors.length, 0, 'wrong-revision authority remains non-blocking');

result = compile('capabilities { SELF E, Echo E }\nCALL CR3, #0', {});
assert.equal(result.warnings.length, 0, 'dynamic register CALL must not be called invalid');

console.log('call API diagnostics tests passed');