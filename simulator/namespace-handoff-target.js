(function(root) {
    'use strict';
    // Frozen review inputs: the approved layout and the two privately compiled
    // Full-source candidates. This projection is not an image or an admission.
    const inputs = {
        capacityWords: 16384, slotCount: 64,
        residents: [
            {slot: 2, name: 'Boot.Thread', words: 256, source: 'Fresh entry Thread · version 0'},
            {slot: 7, name: 'WukongCallHome', words: 4096, source: 'Prepared Full-source candidate',
                hash: '971a41bc744fc40c73a09430b486cda47019f5d300042255586ba96271d78631'},
            {slot: 10, name: 'CapabilityTest', words: 2048, source: 'Prepared Full-source candidate · boot target',
                hash: 'e07e1c39608fc8e87265db192a417b6fc894279ed1aa738d58cf0046beee4e8b'},
            {slot: 6, name: 'SelfTest', words: 2048, source: 'Preserved selected artifact',
                hash: '65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de'},
            {slot: 11, name: 'Thread.2', words: 256, source: 'Fresh Thread · local alias kjhh1.Thread2'},
            {slot: 12, name: 'Thread.3', words: 256, source: 'Fresh Thread · local alias kjhh1.Thread3'}
        ],
        devices: [
            {slot: 3, name: 'LED_DEV', location: 0x40000000, limit: 4, sequence: 0},
            {slot: 4, name: 'BTN_DEV', location: 0x40000028, limit: 0, sequence: 0},
            {slot: 5, name: 'TIMER_DEV', location: 0x4000002c, limit: 4, sequence: 0},
            {slot: 8, name: 'UART_DEV', location: 0x40000014, limit: 2, sequence: 1},
            {slot: 13, name: 'M_BIT_DEV', location: 0xffffff1c, limit: 0, sequence: 0}
        ]
    };
    function build() {
        const {capacityWords, slotCount} = inputs;
        let cursor = slotCount * 4;
        const rows = [{slot: 1, name: 'Boot.NS — self', location: 0,
            limit: cursor - 1, sequence: 0, source: 'CR15 covers the NST only'}];
        for (const resident of inputs.residents) {
            rows.push({...resident, location: cursor, sequence: 0});
            cursor += resident.words;
        }
        rows.push(...inputs.devices.map(device => ({...device, source: 'I/O descriptor'})));
        if (cursor > capacityWords || new Set(rows.map(row => row.slot)).size !== rows.length ||
            rows.some(row => row.slot < 1 || row.slot >= slotCount)) {
            throw new Error('Approved target layout has overlapping slots or exceeds capacity');
        }
        const memberCount = rows.length - 1;
        const header = ((31 << 27) | ((Math.log2(capacityWords) - 13) << 23) |
            (slotCount << 10) | (1 << 8)) >>> 0;
        return {capacityWords, slotCount, tableWords: slotCount * 4,
            metadataWords: [header, 0, memberCount, 0], memberCount,
            end: cursor, rows: rows.sort((a, b) => a.slot - b.slot)};
    }
    function render() {
        const host = document.getElementById('namespaceHandoffTarget');
        if (!host) return;
        const hex = word => '0x' + word.toString(16).toUpperCase().padStart(8, '0');
        try {
            const p = build();
            host.innerHTML = `<div style="padding:12px;border:1px solid #4ec9b0;line-height:1.6">
                <strong>Approved target — Boot Namespace</strong>
                <div>${p.slotCount} slots · ${p.capacityWords.toLocaleString()} words · ascending NST at word 0 ·
                CR15 limit ${hex(p.tableWords - 1)} · entry Thread slot 2, version 0</div>
                <div>Layout check: fits. NST + allocated bodies: ${p.end.toLocaleString()} words;
                ${(p.capacityWords - p.end).toLocaleString()} words remain. Three resident code LUMPs preserved.</div>
                <div style="color:#f0d79c">Target design for inspection, not the installed image.
                Candidate binding, fresh Thread images and executable-image validation remain pending.</div>
                </div>
                <table class="ns-table"><thead><tr><th>Slot</th><th>NST word address</th><th>Object</th>
                <th>Base / device address</th><th>Allocation</th><th>Version</th><th>Evidence</th></tr></thead><tbody>
                <tr><td>0</td><td>${hex(0)}</td><td><strong>Metadata / physical header</strong></td>
                <td colspan="4">W0 ${hex(p.metadataWords[0])} · W1 base ${hex(0)} ·
                W2 members ${p.memberCount} · W3 reserved ${hex(0)}</td></tr>
                ${p.rows.map(row => `<tr><td>${row.slot}</td><td>${hex(row.slot * 4)}</td><td>${row.name}</td>
                <td>${hex(row.location)}</td><td>${row.words ? row.words.toLocaleString() + ' words' :
                    'limit ' + hex(row.limit)}</td><td>${row.sequence}</td>
                <td>${row.source}${row.hash ? `<details><summary>Exact artifact hash</summary><code style="overflow-wrap:anywhere">${row.hash}</code></details>` : ''}</td></tr>`).join('')}
                </tbody></table>
                <p style="padding:8px;color:#aab">Addresses are word addresses. Slot 0 is metadata, not a capability.
                UART moves from slot 2 to slot 8 with retained version 1. Resident addresses include the
                prepared Full-source sizes, not the old 1,024-word allocations. Integrity values are not
                shown as finalized before image binding.</p>`;
        } catch (error) {
            host.textContent = 'Target layout unavailable: ' + error.message + '. No saved state was changed.';
        }
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = {build};
    else {
        root.NamespaceHandoffTarget = {build, render};
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
        else render();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
