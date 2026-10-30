'use strict';

// Descriptor-only candidate for the unchanged Amoeba retry BIT. This module
// neither compiles a full Mint service nor reads/writes catalogs or images.
const BIT_SHA256 = 'a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e';

function replaceOnce(text, anchor, replacement) {
    if (text.split(anchor).length !== 2)
        throw new Error('Mint demo source contract changed: expected one exact anchor');
    return text.replace(anchor, replacement);
}

function descriptorProgram(source) {
    const begin = '; BEGIN NATIVE SLOT PACKAGE';
    const end = '; END NATIVE SLOT PACKAGE';
    if (source.split(begin).length !== 2 || source.split(end).length !== 2)
        throw new Error('Mint demo source contract changed: package markers');
    const start = source.indexOf('create_descriptor_prepare:', source.indexOf(begin));
    const stop = source.indexOf(end);
    if (start < 0 || stop <= start)
        throw new Error('Mint demo source contract changed: package ordering');
    let body = source.slice(start, stop);
    // Check byte alignment before shifting; never round an invalid address down.
    // DR13 is scratch; DR12 stays zero (not ready), including fault/retirement.
    // Keep DR8 in bytes until successful sequence preparation.
    body = replaceOnce(body,
        '    BFEXT DR4, DR7, #16, #16',
        `    ; Unchanged-BIT demo: resident allocation must fit 16384 RAM words.
    SHR DR13, DR8, #2
    IADD DR4, DR0, #1
    SHL DR4, DR4, #14
    MCMP DR13, DR4
    BRANCHHS TODO_CREATE_DESCRIPTOR_INPUT_INVALID
    ISUB DR4, DR4, DR13
    MCMP DR6, DR4
    BRANCHHI TODO_CREATE_DESCRIPTOR_INPUT_INVALID
    BFEXT DR4, DR7, #16, #16`);
    body = replaceOnce(body,
        '    BRANCH create_descriptor_integrity',
        `    ; Only descriptor W0 changes units; integrity covers encoded bytes.
    SHR DR8, DR8, #2
    BRANCH create_descriptor_integrity`);
    const failures = [...source.matchAll(
        /^TODO_CREATE_DESCRIPTOR_INPUT_INVALID:\n\s*(HARDFAULT "[^"]+")/gm)];
    if (failures.length !== 1)
        throw new Error('Mint demo source contract changed: fault target');
    return `; Descriptor-only software check for BIT ${BIT_SHA256}
; Input DR8: physical bytes. Successful output DR8: resident word address.
; DR6/DR7/DR5 and CRs preserved; DR1 remains zero, not CREATE success.
; No allocator, publication, result issuance, DESTROY, or board execution.
${body}
create_data_descriptor_ready:
    HALT
TODO_CREATE_DESCRIPTOR_INPUT_INVALID:
    ${failures[0][1]}
`;
}

module.exports = {BIT_SHA256, descriptorProgram};
