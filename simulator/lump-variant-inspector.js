(function(root) {
    'use strict';
    const profiles = [['full', 'Full · Editable'], ['compact', 'Compact · Sharing'], ['api', 'API · Build & Test']];
    const hex = n => (n >>> 0).toString(16).padStart(8, '0');
    function byteCounts(words, frame) {
        const {cw, cc} = frame.header;
        const frameHeader = words[1 + cw] >>> 0;
        const apiPayload = frameHeader & 0xffff;
        const api = Math.ceil(apiPayload / 4) * 4;
        const hasSource = ((frameHeader >>> 16) & 1) !== 0;
        const sourceOffset = 2 + cw + api / 4;
        if (hasSource && sourceOffset >= words.length - cc)
            throw new Error('Source length lies outside the content area');
        const sourcePayload = hasSource ? words[sourceOffset] >>> 0 : 0;
        const source = Math.ceil(sourcePayload / 4) * 4;
        const headers = hasSource ? 12 : 8;
        const code = cw * 4;
        const clist = cc * 4;
        const total = words.length * 4;
        const free = total - code - clist - api - source - headers;
        if (free < 0) throw new Error('Content sizes exceed the LUMP allocation');
        return {code, clist, api, source, headers, free, total, apiPayload, sourcePayload,
            compressed: hasSource && ((frameHeader >>> 16) & 4) !== 0};
    }
    async function inspect(bundleId, profile, record) {
        if (!/^[0-9a-f]{64}$/.test(bundleId) || !profiles.some(p => p[0] === profile) ||
            !record || !/^[0-9a-f]{64}$/.test(record.sha256)) throw new Error('Exact revision identity unavailable');
        const response = await fetch(`/api/lump-variants/${bundleId}/${profile}`, {cache: 'no-store'});
        if (!response.ok) throw new Error(`Variant download failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash !== record.sha256 || bytes.byteLength !== record.bytes || bytes.byteLength % 4)
            throw new Error('Variant bytes do not match this revision');
        const view = new DataView(bytes);
        const words = Array.from({length: bytes.byteLength / 4}, (_, i) => view.getUint32(i * 4, false));
        const frame = await root.LumpContentFrame.lumpInspectContentFrame(words);
        if (!frame.headerValid || !frame.contentFrameValid || frame.header.lumpSize !== words.length ||
            frame.profile !== profile)
            throw new Error(frame.error || 'Invalid variant header or content frame');
        const source = await root.LumpContentFrame.lumpInspectContentFrameSource(words);
        if (source.status === 'error') throw new Error(source.error);
        return {words, hash, frame, source: source.source};
    }
    function select(panel, index) {
        panel._profileIndex = index;
        panel.querySelectorAll('[data-profile-index]').forEach(button =>
            button.setAttribute('aria-pressed', String(Number(button.dataset.profileIndex) === index)));
        panel.querySelectorAll('.lvi-pane').forEach((pane, i) => {
            pane.classList.toggle('lvi-focused', i === index);
            pane.style.borderColor = i === index ? '#4ec9b0' : '#444';
        });
    }
    function open(lump, panel, opener) {
        if (!panel) return;
        if (opener) panel._returnFocus = opener;
        const revisionKey = JSON.stringify([lump.variant_bundle_id, lump.lump_version, lump.token]);
        if (panel._opened && panel._revisionKey === revisionKey) {
            panel.hidden = false;
            select(panel, (panel._profileIndex + 1) % 3);
            return;
        }
        panel._opened = true;
        panel._revisionKey = revisionKey;
        panel.hidden = false;
        const snapshot = {bundleId: lump.variant_bundle_id, name: lump.abstraction || lump.name || lump.token,
            revision: lump.lump_version, token: lump.token, filename: lump.filename,
            binary_hash: lump.variant_primary_hash || lump.binary_hash};
        panel.innerHTML = `<style>
            .lvi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
            .lvi-pane{padding:10px;border:2px solid #444;min-width:0}
            .lvi-pane pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-size:.75rem}
            .lvi-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
            .lvi-toolbar button[aria-pressed=true]{outline:2px solid #4ec9b0}
            @media(max-width:900px){.lvi-grid{grid-template-columns:1fr}.lvi-pane:not(.lvi-focused){display:none}}
            </style><h3 class="lvi-title"></h3>
            <p>One revision, three linked forms. Read-only inspection; no selection, save, approval or activation changes.
            Full is the canonical editing source. Compact and API are derived copies.</p>
            <div class="lvi-toolbar"></div><div class="lvi-grid"></div>`;
        panel.querySelector('.lvi-title').textContent = `${snapshot.name} · v${snapshot.revision} — three forms`;
        const toolbar = panel.querySelector('.lvi-toolbar');
        const grid = panel.querySelector('.lvi-grid');
        profiles.forEach(([profile, title], index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'lump-hs-btn';
            button.dataset.profileIndex = index;
            button.textContent = title;
            button.addEventListener('click', () => select(panel, index));
            toolbar.appendChild(button);
            const pane = document.createElement('section');
            pane.className = 'lvi-pane';
            const heading = document.createElement('h4');
            heading.textContent = title;
            pane.appendChild(heading);
            const content = document.createElement('div');
            content.textContent = 'Loading exact revision…';
            pane.appendChild(content);
            grid.appendChild(pane);
            pane._content = content;
        });
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'lump-hs-btn';
        close.textContent = 'Close inspector';
        close.addEventListener('click', () => {
            panel.hidden = true;
            panel._opened = false;
            const opener = panel._returnFocus;
            if (opener && opener.isConnected) {
                opener.style.scrollMarginTop = '90px';
                opener.focus({preventScroll: true});
                if (typeof opener.scrollIntoView === 'function')
                    opener.scrollIntoView({block: 'center', behavior: 'instant'});
            }
        });
        toolbar.appendChild(close);
        select(panel, 0);
        async function load() {
            if (!/^[0-9a-f]{64}$/.test(snapshot.bundleId || ''))
                throw new Error('No exact three-form bundle is recorded for this revision. No newer revision was substituted.');
            const response = await fetch('/api/lump-variants/' + snapshot.bundleId, {cache: 'no-store'});
            if (!response.ok) throw new Error(`Exact revision bundle unavailable (${response.status})`);
            const bundle = await response.json();
            await Promise.all(profiles.map(async ([profile], index) => {
                const content = grid.children[index]._content;
                try {
                    const result = await inspect(snapshot.bundleId, profile, bundle.variants[profile]);
                    if (!panel.isConnected) return;
                    content.textContent = '';
                    const {words, hash, frame, source} = result;
                    const sizes = byteCounts(words, frame);
                    const summary = document.createElement('pre');
                    summary.textContent = `${words.length.toLocaleString()} words · ${(words.length * 4).toLocaleString()} bytes\n` +
                        `Header 0x${hex(words[0])}\nCW ${frame.header.cw} · CC ${frame.header.cc}\nSHA-256 ${hash}`;
                    content.appendChild(summary);
                    const sections = [
                        ['Code words', words.slice(1, 1 + frame.header.cw).map((w,i) => `${i}: ${hex(w)}`).join('\n'), sizes.code],
                        ['C-list words', (frame.header.cc ? words.slice(-frame.header.cc) : []).map((w,i) => `${i}: ${hex(w)}`).join('\n'), sizes.clist],
                        ['Embedded API', `${sizes.apiPayload} stored JSON bytes + ${sizes.api - sizes.apiPayload} alignment bytes.\n\n` + JSON.stringify(frame.canonicalApiDefinition || frame.apiDefinition, null, 2), sizes.api],
                        ['Embedded source', `${sizes.sourcePayload} stored ${sizes.compressed ? 'compressed ' : ''}bytes + ${sizes.source - sizes.sourcePayload} alignment bytes.\n\n` + (source == null ? 'No source embedded in this form.' : source), sizes.source],
                        ['Headers', 'LUMP header: 4 bytes\nContent frame header: 4 bytes\nSource length: ' + (sizes.headers - 8) + ' bytes', sizes.headers],
                        ['Free space', 'Unoccupied allocation between the content frame and C-list. Alignment bytes are counted with API/source, not here.', sizes.free],
                    ];
                    sections.forEach(([title, text, count]) => {
                        const details = document.createElement('details');
                        const label = document.createElement('summary');
                        label.textContent = title + (count === undefined ? '' : ` (${count.toLocaleString()} bytes)`);
                        if (count !== undefined) details.dataset.storageBytes = String(count);
                        const pre = document.createElement('pre');
                        pre.textContent = text;
                        details.append(label, pre);
                        content.appendChild(details);
                    });
                    const total = document.createElement('p');
                    total.className = 'lvi-storage-total';
                    total.textContent = `Total (${sizes.total.toLocaleString()} bytes) — includes headers and alignment; source counted as stored.`;
                    content.appendChild(total);
                    // Reuse the existing exact-revision editor entry point, only
                    // while the originally selected record is still unchanged.
                    if (profile === 'full' && !lump._historicalReadOnly && !lump.archived && !lump.read_only &&
                        /^[0-9a-f]{8}$/i.test(snapshot.token || '') && snapshot.filename &&
                        /^[0-9a-f]{64}$/.test(snapshot.binary_hash || '') &&
                        typeof openLumpInEditor === 'function') {
                        const edit = document.createElement('button');
                        edit.type = 'button';
                        edit.className = 'lump-hs-btn';
                        edit.textContent = 'Open Full in editor';
                        edit.addEventListener('click', async () => {
                            if (lump.variant_bundle_id !== snapshot.bundleId || lump.lump_version !== snapshot.revision) {
                                edit.textContent = 'Selection changed — reopen this revision';
                                edit.disabled = true;
                                return;
                            }
                            try {
                                await openLumpInEditor(snapshot.token, {exactSavedArtifact: {
                                    token: snapshot.token, filename: snapshot.filename,
                                    binary_hash: snapshot.binary_hash, lump_version: snapshot.revision,
                                    abstraction: snapshot.name, variant_bundle_id: snapshot.bundleId
                                }});
                            } catch (error) {
                                edit.textContent = 'Open failed: ' + error.message;
                            }
                        });
                        content.appendChild(edit);
                    }
                } catch (error) {
                    if (panel.isConnected) content.textContent = `Inspection unavailable: ${error.message} No data changed. Close and reopen to retry.`;
                }
            }));
        }
        load().catch(error => {
            if (panel.isConnected) grid.querySelectorAll('.lvi-pane').forEach(pane => {
                pane._content.textContent = error.message + ' No data changed.';
            });
        });
    }
    root.LumpVariantInspector = {open, inspect, select, byteCounts};
})(typeof globalThis !== 'undefined' ? globalThis : this);
