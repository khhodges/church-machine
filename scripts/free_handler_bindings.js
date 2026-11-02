'use strict';
// Pure offline binding of prepared buffers. The caller supplies already-trusted
// destination grants. This does not mint authority, admit an image or install it.
function bindPreparedBlock(prepared, resolveGrant) {
    const p = prepared, setup = p.setup;
    const rightsBits = {R: 1, W: 2, X: 4, L: 1, S: 2, E: 4};
    const resolve = binding => {
        const target = binding.aliasOf || binding.target || binding.name;
        const word = resolveGrant(target, [...binding.rights]);
        if (!Number.isInteger(word) || word <= 0 || word > 0xFFFFFFFF)
            throw Error(`Missing trusted grant for ${target}`);
        const church = binding.rights.some(r => 'LSE'.includes(r));
        const bits = binding.rights.reduce((b, r) => b | rightsBits[r], 0);
        if (((word >>> 25) & 3) !== 1 || ((word >>> 28) & 7) !== bits ||
            ((word >>> 27) & 1) !== Number(church))
            throw Error(`Wrong form or permissions for ${binding.name}`);
        if (binding.slot !== undefined && (word & 0xFFFF) !== binding.slot)
            throw Error(`Wrong destination slot for ${binding.name}`);
        if (((word >>> 16) & 511) !== 0)
            throw Error(`This fresh-origin example requires generation zero: ${binding.name}`);
        return word >>> 0;
    };
    const inventory = p.inventory.slice(), directory = p.directory.slice();
    for (const binding of setup.inventory.bindings)
        inventory[64 - 11 + binding.row] = resolve(binding);
    const identityMask = 0x07FFFFFF;
    if ((inventory[62] & identityMask) !== (inventory[63] & identityMask))
        throw Error('ThreadSetup must share the exact FreeThread slot and generation');
    for (const binding of setup.directory.bindings)
        directory[64 + binding.row] = resolve(binding);
    const clist = p.clist.slice(), thread = p.thread.slice();
    for (const binding of setup.clist.relocations) clist[binding.wordOffset] = resolve(binding);
    let amoeba;
    for (const binding of setup.thread.relocations) {
        const token = resolve(binding);
        if (amoeba !== undefined && amoeba !== token)
            throw Error('Amoeba relocations must share one exact trusted grant');
        thread[binding.wordOffset] = amoeba = token;
    }
    const objectWords = p.objectWords.slice();
    objectWords.splice(setup.objects[6].baseWord - setup.baseWord, clist.length, ...clist);
    objectWords.splice(setup.objects[7].baseWord - setup.baseWord, thread.length, ...thread);
    return {inventory, directory, clist, thread, objectWords,
        status: 'offline-bound-buffers-not-installed'};
}
module.exports = {bindPreparedBlock};
