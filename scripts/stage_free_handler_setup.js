'use strict';
// Read-only discovery, followed by local draft output. Never writes an API,
// creates authority, binds a Namespace, activates simulation or touches hardware.
const fs = require('node:fs');
const path = require('node:path');
const {prepare} = require('./build_free_handler_example');

async function main() {
    const token = process.argv[2];
    if (!/^[a-f0-9]{8}$/.test(token || '')) throw Error('Provide the exact saved FreeHandler token');
    const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    async function get(route) {
        const response = await fetch(origin + route);
        if (!response.ok) throw Error(`Read ${route}: HTTP ${response.status}`);
        return response.json();
    }
    const [state, catalog] = await Promise.all([
        get('/api/namespace/design-v1'), get('/api/lumps/list'),
    ]);
    const matches = catalog.filter(r => r.abstraction === 'ide.FreeHandler' && r.token === token);
    if (matches.length !== 1 || matches[0].cc !== 3 || !matches[0].binary_valid)
        throw Error('Expected one valid saved shared-directory FreeHandler revision');
    const saved = matches[0], prepared = prepare();
    const document = structuredClone(state.document);
    const occupied = new Set(document.rows.map(r => r.slot));
    const placements = [
        {slot: 22, name: 'ide.FreeHandler', role: 'saved-executable'},
        {slot: 23, name: 'ide.FreeHandlerBlocks', role: 'directory', words: 128},
        {slot: 24, name: 'ide.B1.Inventory', role: 'inventory', words: 64},
        {slot: 25, name: 'ide.B1.State', role: 'state', words: 64},
        {slot: 26, name: 'ide.AmoebaStartup', role: 'exact-template-startup-dependency'},
        ...prepared.setup.objects.map(o => ({slot: o.slot, name: o.name, role: o.kind, words: o.words})),
    ];
    for (const item of placements)
        if (occupied.has(item.slot)) throw Error(`Proposed slot ${item.slot} is occupied; no draft written`);
    const selection = {filename: saved.filename, token, revision: saved.lump_version,
        binaryHash: saved.binary_hash};
    if (document.rows.some(r => r.name === 'ide.FreeHandler'))
        throw Error('FreeHandler already assigned; review its existing entry first');
    document.rows.push({slot: 22, name: 'ide.FreeHandler', kind: 'lump', policy: 'Resident',
        sequence: 0, boot: false, selection});
    const draft = {
        name: 'FreeHandler B1', status: 'staged-not-saved-to-builder',
        sourceFingerprint: state.fingerprint, selection, proposedPlacements: placements,
        partialDesign: document, inventoryPreparation: prepared.setup,
        blockers: [
            'Builder copy/save requires its normal review acknowledgement; no approval is bypassed.',
            'Directory, Inventory and initialized data bodies need supported design serialization and binding.',
            'Existing ide.AmoebaStartup is already present; review exact template dependency identity before assigning another same-name row.',
        ],
        installationAllowed: false, activationAllowed: false, hardwareProgrammingAllowed: false,
    };
    const dir = path.join('generated-artifacts', `free-handler-setup-${token}`);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(draft, null, 2) + '\n');
    console.log(`${dir}/draft.json\nPinned revision ${saved.lump_version}; proposed slots checked; no Namespace saved or activated.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
