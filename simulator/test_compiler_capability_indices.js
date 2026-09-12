'use strict';

// End-to-end capability-row regression tests.
//
// These tests deliberately use the real compiler and assembler.  The c-list
// row is part of the generated ELOADCALL immediate, so it must be checked
// against the final result.capabilities array rather than against the upload
// array that happened to supply metadata.

const assert = require('assert');
const path = require('path');

global.ChurchAssembler = require(path.join(__dirname, 'assembler.js'));
global.METHOD_REGISTER_CONVENTIONS = {
    Foo: {
        Run: { index: 4 },
    },
    Bar: {
        Other: { index: 2 },
    },
};
global.BOOT_UPLOADS = [];

const CLOOMCCompiler = require(path.join(__dirname, 'cloomc_compiler.js'));

let passed = 0;
let failed = 0;

function check(label, fn) {
    try {
        fn();
        console.log(`PASS ${label}`);
        passed++;
    } catch (error) {
        console.log(`FAIL ${label} — ${error.message}`);
        failed++;
    }
}

function compileOrThrow(compiler, source, uploads, method = 'compile') {
    const result = compiler[method](source, uploads);
    if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors.map(error => error.message).join('; '));
    }
    return result;
}

function capabilityName(capability) {
    if (capability && capability.null_row === true) return 'NULL';
    if (typeof capability === 'string') return capability;
    return capability && (capability.name || capability.target);
}

function capabilityNames(capabilities) {
    return capabilities.map(capabilityName);
}

function eloadcallWords(result) {
    return result.methods
        .flatMap(method => Array.isArray(method.code) ? method.code : [])
        .filter(word => ((word >>> 27) & 0x1F) === 8);
}

function decodeEloadcall(word) {
    const immediate = word & 0x7FFF;
    return {
        row: immediate & 0x1F,
        // ELOADCALL stores a 1-based selector; the public/disassembler form
        // is 0-based, which is what these assertions use.
        selector: ((immediate >>> 5) & 0x7F) - 1,
    };
}

function assertEloadTargets(result, expected) {
    const words = eloadcallWords(result);
    assert.strictEqual(words.length, expected.length,
        `expected ${expected.length} ELOADCALL words, got ${words.length}`);
    expected.forEach((item, index) => {
        const decoded = decodeEloadcall(words[index]);
        assert.strictEqual(capabilityName(result.capabilities[decoded.row]), item.name,
            `ELOADCALL ${index} row ${decoded.row} does not name ${item.name}`);
        assert.strictEqual(decoded.selector, item.selector,
            `ELOADCALL ${index} selector changed`);
    });
}

const SOURCE_ORDER_SOURCE = `abstraction Caller {
    capabilities {
        Foo E,
        Bar E,
        NULL,
        Tail E
    }
    method Run() {
        Foo.Run()
        Bar.Other()
    }
}`;

const EMPTY_CAPABILITY_SOURCE = `abstraction Caller {
    method Run() {
        Foo.Run()
        Bar.Other()
    }
}`;

const FOO_ONLY_SOURCE = `abstraction Caller {
    method Run() {
        Foo.Run()
    }
}`;

// Source declaration order is authoritative.  Upload metadata is intentionally
// reversed here: Bar is first in the upload list, while Foo is first in source.
check('public compile uses source order and enriches matching named/target uploads', () => {
    const uploads = [
        { target: 'Bar', uploadMarker: 'bar', grants: ['E'] },
        { name: 'Foo', uploadMarker: 'foo', grants: ['E'] },
        'UploadOnly',
    ];
    const result = compileOrThrow(new CLOOMCCompiler(), SOURCE_ORDER_SOURCE, uploads);

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['__SELF__', 'Foo', 'Bar', 'NULL', 'Tail', 'UploadOnly']);
    assert.strictEqual(result.capabilities[1].uploadMarker, 'foo');
    assert.strictEqual(result.capabilities[2].uploadMarker, 'bar');
    assert.strictEqual(result.capabilities[5], 'UploadOnly');
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
});

check('public compile marks the inserted row zero as compiler-owned SELF', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), SOURCE_ORDER_SOURCE, []);
    const self = result.capabilities[0];

    assert.strictEqual(self.name, '__SELF__');
    assert.deepStrictEqual(self.rights, ['E']);
    assert.deepStrictEqual(self.grants, ['E']);
    assert.strictEqual(self.compiler_owned_self, true);
    assert.strictEqual(self.compiler_assisted_self, true);
    assert.strictEqual(self.placeholder, true);
});

check('direct compileJS retains no-implicit-SELF behavior and source rows', () => {
    const uploads = [
        { target: 'Bar', uploadMarker: 'bar', grants: ['E'] },
        { name: 'Foo', uploadMarker: 'foo', grants: ['E'] },
        'UploadOnly',
    ];
    const result = compileOrThrow(
        new CLOOMCCompiler(),
        SOURCE_ORDER_SOURCE,
        uploads,
        'compileJS',
    );

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['Foo', 'Bar', 'NULL', 'Tail', 'UploadOnly']);
    assert.strictEqual(result.capabilities.some(capability =>
        capability && capability.compiler_owned_self === true), false);
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 0);
});

check('upload ordering does not change the independent method selector', () => {
    const forward = compileOrThrow(new CLOOMCCompiler(), SOURCE_ORDER_SOURCE, [
        { name: 'Foo', uploadMarker: 'foo' },
        { target: 'Bar', uploadMarker: 'bar' },
    ]);
    const reverse = compileOrThrow(new CLOOMCCompiler(), SOURCE_ORDER_SOURCE, [
        { target: 'Bar', uploadMarker: 'bar' },
        { name: 'Foo', uploadMarker: 'foo' },
    ]);

    const forwardDecoded = eloadcallWords(forward).map(decodeEloadcall);
    const reverseDecoded = eloadcallWords(reverse).map(decodeEloadcall);
    assert.deepStrictEqual(forwardDecoded.map(item => item.row), [1, 2]);
    assert.deepStrictEqual(reverseDecoded.map(item => item.row), [1, 2]);
    assert.deepStrictEqual(forwardDecoded.map(item => item.selector), [4, 2]);
    assert.deepStrictEqual(reverseDecoded.map(item => item.selector), [4, 2]);
});

check('empty source capability list follows named, target, null, and string upload order', () => {
    const uploads = [
        null,
        { target: 'Foo', grants: ['E'] },
        { name: 'Bar', grants: ['E'] },
        'UploadOnly',
    ];
    const result = compileOrThrow(new CLOOMCCompiler(), EMPTY_CAPABILITY_SOURCE, uploads);

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['__SELF__', 'NULL', 'Foo', 'Bar', 'UploadOnly']);
    assert.strictEqual(result.capabilities[1].null_row, true);
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.deepStrictEqual(eloadcallWords(result).map(decodeEloadcall).map(item => item.row), [2, 3]);
});

check('direct compileJS keeps empty upload order without adding SELF', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), EMPTY_CAPABILITY_SOURCE, [
        null,
        { target: 'Foo', grants: ['E'] },
        { name: 'Bar', grants: ['E'] },
        'UploadOnly',
    ], 'compileJS');

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['NULL', 'Foo', 'Bar', 'UploadOnly']);
    assert.strictEqual(result.capabilities[0].null_row, true);
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.deepStrictEqual(eloadcallWords(result).map(decodeEloadcall).map(item => item.row), [1, 2]);
});

check('exact Foo-call repro with uploaded SELF then Foo resolves Foo to row one', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), FOO_ONLY_SOURCE, [
        { name: 'SELF', rights: ['E'] },
        { name: 'Foo', rights: ['E'] },
    ]);

    assert.deepStrictEqual(capabilityNames(result.capabilities), ['__SELF__', 'Foo']);
    assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 1);
});

for (const selfUpload of [
    'SELF',
    'self',
    '__SELF__',
    { name: 'SymbolicOwner', symbolic_self: true, rights: ['E'] },
]) {
    const spelling = typeof selfUpload === 'string' ? selfUpload : 'symbolic_self';
    check(`public compile normalizes uploaded SELF spelling: ${spelling}`, () => {
        const result = compileOrThrow(new CLOOMCCompiler(), FOO_ONLY_SOURCE, [
            selfUpload,
            { name: 'Foo', rights: ['E'] },
        ]);

        assert.deepStrictEqual(capabilityNames(result.capabilities), ['__SELF__', 'Foo']);
        assert.strictEqual(result.capabilities[0].compiler_owned_self, true);
        assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
        assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 1);
    });
}

const SELF_ALIAS_SOURCE = `abstraction Caller {
    capabilities {
        Foo E,
        SELF E,
        self E,
        __SELF__ E,
        Bar E
    }
    method Run() {
        Foo.Run()
    }
}`;

check('public compile collapses SELF aliases to one compiler-owned row zero', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), SELF_ALIAS_SOURCE, []);

    assert.deepStrictEqual(capabilityNames(result.capabilities), ['__SELF__', 'Foo', 'Bar']);
    assert.strictEqual(result.capabilities[0].compiler_owned_self, true);
    assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 1);
});

check('direct compileJS preserves source SELF aliases instead of normalizing them', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), SELF_ALIAS_SOURCE, [], 'compileJS');

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['Foo', 'SELF', 'self', '__SELF__', 'Bar']);
    assert.strictEqual(result.capabilities[0].compiler_owned_self, undefined);
    assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 0);
});

check('public compile normalizes an uploaded symbolic_self alias', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), EMPTY_CAPABILITY_SOURCE, [
        { name: 'OwnerAlias', symbolic_self: true, rights: ['E'] },
        { name: 'Foo', rights: ['E'] },
        { name: 'Bar', rights: ['E'] },
        'Tail',
    ]);

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['__SELF__', 'Foo', 'Bar', 'Tail']);
    assert.strictEqual(result.capabilities[0].symbolic_self, undefined);
    assert.strictEqual(result.capabilities[0].compiler_owned_self, true);
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 1);
});

check('direct compileJS leaves an uploaded symbolic_self alias untouched', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), EMPTY_CAPABILITY_SOURCE, [
        { name: 'OwnerAlias', symbolic_self: true, rights: ['E'] },
        { name: 'Foo', rights: ['E'] },
        { name: 'Bar', rights: ['E'] },
        'Tail',
    ], 'compileJS');

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['OwnerAlias', 'Foo', 'Bar', 'Tail']);
    assert.strictEqual(result.capabilities[0].symbolic_self, true);
    assert.strictEqual(result.capabilities[0].compiler_owned_self, undefined);
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 1);
});

check('a concrete upload at source row zero suppresses implicit SELF insertion', () => {
    const source = `abstraction Caller {
        capabilities { Foo E }
        method Run() {
            Foo.Run()
        }
    }`;
    const result = compileOrThrow(new CLOOMCCompiler(), source, [
        { name: 'Foo', token: 0, grants: ['E'] },
    ]);

    assert.deepStrictEqual(capabilityNames(result.capabilities), ['Foo']);
    assert.strictEqual(result.capabilities[0].token, 0);
    assert.strictEqual(result.capabilities[0].compiler_owned_self, undefined);
    assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 0);
});

check('concrete upload skeleton is a fixed layout, including its NULL hole', () => {
    const source = `abstraction Caller {
        capabilities {
            Foo E,
            Bar E
        }
        method Run() {
            Foo.Run()
            Bar.Other()
        }
    }`;
    const uploads = [
        { name: 'Pinned', token: 0xCAFE, grants: ['E'] },
        { name: 'Foo', rights: ['E'] },
        null,
        { name: 'Bar', rights: ['E'] },
    ];
    const before = JSON.parse(JSON.stringify(uploads));
    const result = compileOrThrow(new CLOOMCCompiler(), source, uploads);

    assert.deepStrictEqual(capabilityNames(result.capabilities),
        ['Pinned', 'Foo', 'NULL', 'Bar']);
    assert.strictEqual(result.capabilities[0].token, 0xCAFE);
    assert.strictEqual(result.capabilities.some(capability =>
        capability && capability.compiler_owned_self === true), false);
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.deepStrictEqual(eloadcallWords(result).map(decodeEloadcall).map(item => item.row), [1, 3]);
    assert.deepStrictEqual(uploads, before);
});

for (const concreteField of ['token', 'gt', 'word0']) {
    check(`concrete zero ${concreteField} keeps symbolic SELF name and row`, () => {
        const self = {
            name: 'ConcreteOwner',
            symbolic_self: true,
            [concreteField]: 0,
        };
        const result = compileOrThrow(new CLOOMCCompiler(), FOO_ONLY_SOURCE, [
            self,
            { name: 'Foo', rights: ['E'] },
        ]);

        assert.strictEqual(result.capabilities[0].name, 'ConcreteOwner');
        assert.strictEqual(result.capabilities[0].symbolic_self, true);
        assert.strictEqual(result.capabilities[0][concreteField], 0);
        assert.strictEqual(result.capabilities[0].compiler_owned_self, undefined);
        assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
        assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 1);
    });
}

check('numeric zero upload is also a fixed row-zero layout', () => {
    const result = compileOrThrow(new CLOOMCCompiler(), EMPTY_CAPABILITY_SOURCE, [
        0,
        { name: 'Foo', rights: ['E'] },
        { name: 'Bar', rights: ['E'] },
    ]);

    assert.strictEqual(result.capabilities[0], 0);
    assert.strictEqual(result.capabilities[1].name, 'Foo');
    assert.strictEqual(result.capabilities[2].name, 'Bar');
    assertEloadTargets(result, [
        { name: 'Foo', selector: 4 },
        { name: 'Bar', selector: 2 },
    ]);
    assert.deepStrictEqual(eloadcallWords(result).map(decodeEloadcall).map(item => item.row), [1, 2]);
});

check('parallel source and uploaded NULL entries deduplicate to one hole', () => {
    const source = `abstraction Caller {
        capabilities {
            NULL,
            Foo E
        }
        method Run() {
            Foo.Run()
        }
    }`;
    const uploads = [null, { name: 'Foo', rights: ['E'] }];
    const before = JSON.parse(JSON.stringify(uploads));
    const result = compileOrThrow(new CLOOMCCompiler(), source, uploads);

    assert.deepStrictEqual(capabilityNames(result.capabilities), ['__SELF__', 'NULL', 'Foo']);
    assert.strictEqual(result.capabilities.filter(capability =>
        capability && capability.null_row === true).length, 1);
    assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 2);
    assert.deepStrictEqual(uploads, before);
});

check('final capability limit is checked after a 32-row merge', () => {
    const names = Array.from({ length: 31 }, (_, index) =>
        `C${String(index).padStart(2, '0')} E`
    ).join(', ');
    const source = `abstraction Capacity {
        capabilities { ${names} }
        method Run() {
            return 0
        }
    }`;

    const exactly32 = compileOrThrow(new CLOOMCCompiler(), source, ['UploadOnly'], 'compileJS');
    assert.strictEqual(exactly32.capabilities.length, 32);

    const thirtyThree = new CLOOMCCompiler().compileJS(source, [
        'UploadOnly',
        'UploadSecond',
    ]);
    assert.strictEqual(thirtyThree.capabilities.length, 33);
    assert.ok(thirtyThree.errors.some(error =>
        /Final capabilities list has 33 entries/.test(error.message)));
});

check('symbolic frontend shares capability-row and ELOADCALL decoding', () => {
    const source = `abstraction Caller {
        capabilities { Foo Bar }
        method Run() {
            let value = Foo.Run()
            return value
        }
    }`;
    const result = compileOrThrow(new CLOOMCCompiler(), source, [
        { target: 'Bar', grants: ['E'] },
        { name: 'Foo', grants: ['E'] },
    ], 'compileSymbolic');

    assert.deepStrictEqual(capabilityNames(result.capabilities), ['Foo', 'Bar']);
    assert.strictEqual(result.capabilities[0].name, 'Foo');
    assertEloadTargets(result, [{ name: 'Foo', selector: 4 }]);
});

for (const frontend of ['compileHaskell', 'compileLambda']) {
    check(`${frontend} finalizes matching upload metadata in source order`, () => {
        const source = `abstraction Caller {
            capabilities { Foo E, Bar E }
            method Run() = 1
        }`;
        const result = compileOrThrow(new CLOOMCCompiler(), source, [
            { target: 'Bar', uploadMarker: 'bar' },
            { name: 'Foo', uploadMarker: 'foo' },
        ], frontend);

        assert.deepStrictEqual(capabilityNames(result.capabilities), ['Foo', 'Bar']);
        assert.strictEqual(result.capabilities[0].uploadMarker, 'foo');
        assert.strictEqual(result.capabilities[1].uploadMarker, 'bar');
    });
}

check('English frontend compiles a real capability call when conventions are supplied', () => {
    const source = `ENGLISH abstraction Caller {
        capabilities { Foo, Bar }
        Run():
        call Foo.Run()
    }`;
    const englishCompiler = new CLOOMCCompiler({
        Foo: { Run: { index: 4 } },
        Bar: { Other: { index: 2 } },
    });
    const result = compileOrThrow(englishCompiler, source, [], 'compileEnglish');

    assert.deepStrictEqual(capabilityNames(result.capabilities), ['foo', 'bar']);
    assertEloadTargets(result, [{ name: 'foo', selector: 4 }]);
    assert.strictEqual(decodeEloadcall(eloadcallWords(result)[0]).row, 0);
});

function checkAssemblyCase(label, source, expectedNames, expectedRow) {
    check(`${label}: real assembler preserves numeric c-list row`, () => {
        const assembled = new ChurchAssembler().assemble(source);
        assert.deepStrictEqual(assembled.errors, []);
        assert.deepStrictEqual(capabilityNames(assembled.capabilities), expectedNames);
        assert.strictEqual(decodeEloadcall(assembled.words[0]).row, expectedRow);
        assert.strictEqual(decodeEloadcall(assembled.words[0]).selector, 4);
    });

    check(`${label}: compiler assembly frontend returns the same row`, () => {
        const result = compileOrThrow(new CLOOMCCompiler(), source);
        assert.strictEqual(result.language, 'assembly');
        assert.deepStrictEqual(capabilityNames(result.capabilities), expectedNames);
        assertEloadTargets(result, [{ name: expectedNames[expectedRow], selector: 4 }]);
        assert.strictEqual(decodeEloadcall(result.methods[0].code[0]).row, expectedRow);
    });
}

checkAssemblyCase(
    'assembly Foo at row zero',
    `capabilities { Foo E }
ELOADCALL CR0, CR6, #0, 4`,
    ['Foo'],
    0,
);

checkAssemblyCase(
    'assembly SELF/Foo at row one',
    `capabilities { SELF E, Foo E }
ELOADCALL CR0, CR6, #1, 4`,
    ['SELF', 'Foo'],
    1,
);

check('unnamed concrete words do not silently acquire duplicate source rows', () => {
    const uploads = [0x12345678, 0, 0x23456789];
    const before = uploads.slice();
    const result = new CLOOMCCompiler().compile(SOURCE_ORDER_SOURCE, uploads);
    assert.ok(result.errors.some(error => /Cannot bind capability FOO/.test(error.message)));
    assert.deepStrictEqual(result.capabilities.slice(0, 3), before);
    assert.deepStrictEqual(uploads, before);
});

for (const target of [0, 7, '0', '7', '0x07']) {
    check(`numeric Namespace target ${JSON.stringify(target)} is not a symbolic name`, () => {
        const source = FOO_ONLY_SOURCE.replace('abstraction Caller {',
            'abstraction Caller {\n capabilities { Foo E }');
        const result = new CLOOMCCompiler().compile(source, [{ target, token: 123 }]);
        assert.ok(result.errors.some(error => /Cannot bind capability FOO/.test(error.message)));
        assert.deepStrictEqual(result.capabilities, [{ target, token: 123 }]);
    });
}

check('SELF cannot be appended to a fixed concrete layout at a nonzero row', () => {
    const result = new CLOOMCCompiler().compile(SELF_ALIAS_SOURCE, [
        { name: 'Pinned', token: 0 },
        { name: 'Foo', token: 1 },
        { name: 'Bar', token: 2 },
    ]);
    assert.ok(result.errors.some(error => /SELF must be row 0/.test(error.message)));
    assert.deepStrictEqual(capabilityNames(result.capabilities), ['Pinned', 'Foo', 'Bar']);
});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;