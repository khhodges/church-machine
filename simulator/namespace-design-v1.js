/* The ascending profile of the Namespace editor. Drafts never write sim or ns-state. */
(function(root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hex = n => n == null ? 'Unresolved' : '0x' + n.toString(16).toUpperCase().padStart(8,'0');
    const state = {active:true, loading:false, saving:false, document:null, fingerprint:null,
        projection:null, persisted:null, error:'', dirty:false};
    const endpoint = '/api/namespace/design-v1';
    state.profile = 'ascending';
    const profileKey = 'church_namespace_design_profile';
    try {
        const saved = root.localStorage.getItem(profileKey);
        if (['ascending','phase1','legacy'].includes(saved)) {
            state.active = saved !== 'legacy';
            if (state.active) state.profile = saved;
        }
    } catch (_) { /* Storage may be unavailable; keep the default view usable. */ }
    // A shared link must name its profile; a bare #namespace otherwise depends
    // on this browser origin's remembered choice (or the ascending default).
    if(root.location && root.location.search) {
        const linkedProfile=new URLSearchParams(root.location.search).get('namespaceProfile');
        if(['ascending','phase1','legacy'].includes(linkedProfile)) {
            state.active=linkedProfile!=='legacy';
            if(state.active) state.profile=linkedProfile;
        }
    }
    const drafts = {};
    const slotCount = () => state.document.slotCount || 64;
    const metadata = () => [(0xf8800100 | (slotCount() << 10)) >>> 0, 0, state.document.rows.length - 1, 0];
    async function request(method, body) {
        const response = await fetch(endpoint + (state.profile === 'phase1' ? '?profile=phase1' : ''), {method, cache:'no-store',
            headers:{'Content-Type':'application/json','X-Requested-With':'NamespaceDesign'},
            ...(body ? {body:JSON.stringify(body)} : {})});
        const data = await response.json();
        if (!response.ok || !data.ok) throw Error(data.error || 'Namespace design request failed');
        return data;
    }
    function accept(data) {
        state.document = clone(data.document);
        state.fingerprint = data.fingerprint;
        state.projection = data.projection;
        state.persisted = typeof data.persisted === 'boolean' ? data.persisted : null;
        state.dirty = false;
        state.error = '';
    }
    async function load() {
        if (state.loading) return;
        state.loading = true;
        try { accept(await request('GET')); }
        catch (e) { state.error = e.message; }
        finally { state.loading = false; render(); }
    }
    function setProfile(value) {
        if(root.DesignSimulation) root.DesignSimulation.stop();
        if(typeof root.stopSim==='function') root.stopSim();
        if (!['ascending','phase1','legacy'].includes(value)) return;
        if (state.loading || state.saving) {
            const select = document.getElementById('namespaceDesignProfile');
            if (select) select.value = state.active ? state.profile : 'legacy';
            return;
        }
        if(root.DesignSimulation) root.DesignSimulation.invalidate();
        ++sourceRequest;
        const placement = document.getElementById('namespaceDesignDialog');
        if (placement) placement.remove();
        drafts[state.profile] = {...state};
        state.active = value !== 'legacy';
        if (state.active && value !== state.profile) {
            Object.assign(state, drafts[value] || {document:null, fingerprint:null,
                projection:null, persisted:null, error:'', dirty:false, loading:false, saving:false},
                {profile:value, active:true});
        }
        try { root.localStorage.setItem(profileKey, value); }
        catch (_) { /* Storage restrictions must not prevent loading the selected design. */ }
        if(root.location && root.location.search && root.history &&
                new URLSearchParams(root.location.search).has('namespaceProfile')) {
            const url=new URL(root.location.href);
            url.searchParams.set('namespaceProfile',value);
            root.history.replaceState(null,'',url.href);
        }
        const legacy = document.getElementById('bootCapacityPanel');
        if (legacy) legacy.hidden = state.active;
        root.updateNamespace();
    }
    function changed() {
        if(root.DesignSimulation) root.DesignSimulation.stop();
        ++sourceRequest; state.dirty=true; state.error=''; render();
    }
    function render() {
        if (typeof root._renderTraceExecutionIdentity === 'function') root._renderTraceExecutionIdentity();
        const selector = document.getElementById('namespaceDesignProfile');
        if (selector) selector.value = state.active ? state.profile : 'legacy';
        if (!state.active) return;
        const host = document.getElementById('namespaceTable');
        if (!host) return;
        const capacity = document.getElementById('bootCapacityPanel');
        if (capacity) capacity.hidden = true;
        if (!state.document) {
            host.innerHTML = state.error ? `<p role="alert">${esc(state.error)}</p><button onclick="NamespaceDesignV1.load()">Retry</button>` :
                `<p>Loading ${esc(profileLabel())} Namespace design…</p>`;
            if (!state.loading && !state.error) load();
            return;
        }
        // The original table owns its toolbar, statistics, columns and styles.
        // Supply design rows without projecting them into the live simulator.
        root.updateNamespace(true);
    }
    function snapshot() {
        const rows=state.document.rows;
        return {counts:{max:slotCount(),assigned:rows.length,resident:rows.filter(r=>r.policy!=='Lazy').length,
            lazy:rows.filter(r=>r.policy==='Lazy').length,garbage:0,free:slotCount()-1-rows.length}};
    }
    function profileLabel() {
        return state.profile === 'phase1' ? 'Phase 1' : 'Ascending layout';
    }
    function designStatus() {
        const origin = state.persisted === true
            ? 'Loaded from a saved design in this environment.'
            : state.persisted === false
                ? 'No saved design file was found for this profile in this environment. These are generated defaults, not recovered user work.'
                : 'Saved-state evidence is unavailable; this design is not confirmed saved.';
        const label = state.dirty ? 'Unsaved local draft'
            : state.persisted === true ? 'Saved design'
            : state.persisted === false ? 'Generated defaults — not saved' : 'Saved status unknown';
        return `<div id="namespaceDesignStatus" role="status" style="margin:0 0 10px;padding:10px;border:1px solid #6b5320;border-radius:4px">
            <strong>${esc(profileLabel())} · ${label}</strong>
            <div>${origin}${state.dirty ? ' Local changes have not been saved.' : ''}
            ${state.dirty || state.persisted === false ? 'Use Bind Namespace Design to save explicitly; nothing is saved automatically.' : ''}
            </div></div>`;
    }
    function renderRows(html, host) {
        const d=state.document, p=state.projection;
        // Keep the original 11-column table and its compact controls.
        html+=`<tr id="ns-row-0" class="ns-row"><td class="ns-idx-cell">0</td><td class="ns-saved-version-col">—</td><td class="ns-label ns-label-clickable" onclick="NamespaceDesignV1.inspect(0)">Namespace header</td><td>${hex(metadata()[0])}</td><td colspan="5">W1 base ${hex(0)} · W2 members ${d.rows.length-1} · W3 ${hex(0)}</td><td>—</td><td><button class="btn btn-xs ns-inspect-btn" onclick="NamespaceDesignV1.inspect(0)">Inspect</button></td></tr>`;
        const displayCount=Math.min(slotCount(),Math.max(...d.rows.map(row=>row.slot))+1);
        for(let slot=1;slot<displayCount;slot++) {
            const r=d.rows.find(r=>r.slot===slot);
            if(!r) {
                html+=`<tr id="ns-row-${slot}" class="ns-row" style="opacity:0.45"><td class="ns-idx-cell">${slot}</td><td class="ns-saved-version-cell ns-saved-version-unavailable">NA</td><td colspan="8" style="color:#555;font-style:italic;font-size:0.8rem">(no entry installed)</td><td class="ns-entry-actions"></td></tr>`;
                continue;
            }
            const projection=p.rows.find(v=>v.slot===slot);
            const current=!state.dirty && projection && projection.policy===r.policy && projection.name===r.name;
            const location=r.kind==='namespace'?0:r.kind==='mmio'?r.address:current?projection.location:null;
            const limit=r.kind==='namespace'?slotCount()*4-1:r.kind==='mmio'?r.limit:current?projection.limit:null;
            const select=r.kind==='lump'?(state.profile==='phase1'?'<span class="ns-fixed-policy">Resident</span>':`<select aria-label="Load policy for slot ${slot}" onchange="NamespaceDesignV1.policy(${slot},this.value)" style="margin-left:5px;background:#0d0d1a;color:#d0d0e8;border:1px solid #6b5320;border-radius:3px;font-size:0.68rem;padding:1px 3px;"><option ${r.policy==='Resident'?'selected':''}>Resident</option><option ${r.policy==='Lazy'?'selected':''}>Lazy</option></select>`):
                `<span class="ns-fixed-policy">${r.kind==='mmio'?'Resident I/O register':r.kind==='thread'?'Resident · Thread':'Bootstrap'}</span>`;
            const clear=r.kind==='lump'&&!r.boot?`<button class="btn btn-xs" onclick="NamespaceDesignV1.clear(${slot})" style="background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,0.35);margin-right:4px;font-size:0.65rem;padding:1px 5px;">Clear</button>`:'';
            const selection=r.selection||{};
            const versionCell=root._nsRenderSavedVersionCell({slot,name:r.name,
                lump_version:selection.revision,filename:selection.filename,
                token:selection.token,binary_hash:selection.binaryHash},null,slot);
            html+=`<tr id="ns-row-${slot}" class="ns-row" data-ns-slot="${slot}">
            <td class="ns-idx-cell" style="white-space:nowrap">${clear}<span class="ns-boot-btn${r.boot?' boot-entry-active':''}" onclick="NamespaceDesignV1.boot(${slot})">${r.boot?'⚡':slot}</span></td>
            ${versionCell}
            <td class="ns-label ns-label-clickable" style="cursor:pointer;text-decoration:underline dotted" onclick="NamespaceDesignV1.source(${slot})">${esc(r.name)}</td>
            <td style="cursor:pointer;text-decoration:underline dotted;color:#4ec9b0" onclick="NamespaceDesignV1.inspect(${slot})">${hex(location)}</td>
            <td>Inform</td><td class="ns-flag">0</td><td class="ns-flag">0</td><td>${limit==null?'Unallocated':'0x'+limit.toString(16).toUpperCase().padStart(5,'0')}</td><td>${r.sequence}</td>
            <td title="Not finalized until the new image is bound">Unbound</td>
            <td class="ns-entry-actions"><button class="btn btn-xs ns-inspect-btn" onclick="NamespaceDesignV1.inspect(${slot})">Inspect and resolve</button>${r.kind==='lump'?`<button class="btn btn-xs" style="background:#2d4a3e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35)" onclick="NamespaceDesignV1.assigned(${slot})">Open assigned LUMP</button>`:''}${select}${r.kind==='lump'?`<button class="btn btn-xs ns-identity-btn" style="background:#27233b;color:#c4a7ff;border:1px solid rgba(196,167,255,0.35);margin-left:5px;font-size:0.65rem;padding:1px 5px" onclick="NamespaceDesignV1.identity(${slot})">Identity</button>`:''}</td></tr>`;
        }
        html+='</tbody></table><p id="nsSaveLayoutNote" role="status"></p>';
        if(state.profile==='phase1') html+=`<p>Phase 1: slot 0 metadata · 1 self · 2 entry Thread · 8 UART · 9 ide.Mint (requested E) · 14 nstab (requested RW) · 15 pkverify (requested E). Requested rights are design intent, not granted capabilities.</p><label>Total slots (including metadata) <input type="number" min="16" max="4096" value="${slotCount()}" onchange="NamespaceDesignV1.capacity(this.value)" ${state.saving?'disabled':''}></label><p>${slotCount()*4} table words / ${slotCount()*16} bytes · CR15 table-only limit ${slotCount()*4-1}. Unfinished placements remain non-executable.</p>`;
        host.innerHTML=designStatus()+html;
        const saveButton=host.querySelector('#nsSaveBtn');
        saveButton.onclick=save;
        saveButton.textContent=state.saving?'Binding…':'Bind Namespace Design';
        saveButton.title='Save this design and show fresh C-list binding results. Does not activate or change a running image.';
        saveButton.disabled=state.saving;
        if(state.dirty) saveButton.textContent+=' *';
        host.querySelector('#nsSaveLayoutNote').textContent=state.saving?'Binding selected Namespace…':state.error ||
            (state.profile==='phase1'?'Phase 1':'Ascending layout')+' · API-only allocations · design only, not installed. '+(state.dirty?'Unsaved changes. ':'')+
            p.warnings.join('; ');
        const bolt=host.querySelector('#nsBoltDrag');
        bolt.ondragstart=e=>e.dataTransfer.setData('text/plain','ascending-boot');
        host.querySelectorAll('[data-ns-slot]').forEach(row=>{
            row.ondragover=e=>e.preventDefault();
            row.ondrop=e=>{e.preventDefault();if(e.dataTransfer.getData('text/plain')==='ascending-boot')boot(Number(row.dataset.nsSlot));};
        });
    }
    function policy(slot,value) {
        if(state.saving) return;
        if(state.profile==='phase1' && value!=='Resident') return;
        const row=state.document.rows.find(r=>r.slot===slot);
        if(row && row.kind==='lump' && ['Lazy','Resident'].includes(value)) {row.policy=value;changed();}
    }
    async function addFromOriginal() {
        if(state.saving) return;
        const name=document.getElementById('_nsPlacementName').value.trim();
        const slotText=document.getElementById('_nsPlacementSlot').value;
        const slot=slotText?Number(slotText):Array.from({length:slotCount()-3},(_,i)=>i+3).find(i=>!state.document.rows.some(r=>r.slot===i));
        const error=document.getElementById('_nsAddError');
        if(!name || name.length>128 || /[\x00-\x1f\x7f]/.test(name) || !Number.isInteger(slot) || slot<3 || slot>=slotCount() || state.document.rows.some(r=>r.slot===slot||r.name===name)) {
            error.textContent=`Choose a unique name and a free slot from 3 to ${slotCount()-1}.`;return;
        }
        const picker=document.getElementById('_nsAddSelect');
        const record=picker && (root._nsAddAvailableList||[])[picker.selectedIndex-1];
        const row={slot,name,kind:'lump',policy:state.profile==='phase1'?'Resident':'Lazy',sequence:0};
        if(record) row.selection={token:record.token,filename:record.filename,
            binaryHash:record.binary_hash,revision:record.lump_version};
        state.document.rows.push(row);changed();
        document.getElementById('_nsAddModalOverlay').remove();
    }
    function boot(slot) {
        if(state.saving) return;
        const row=state.document.rows.find(r=>r.slot===slot);
        if(!row || row.kind!=='lump') return;
        state.document.rows.forEach(r=>{r.boot=r===row;});changed();
    }
    function identity(slot) {
        root._nsShowIdentity(slot,state.document.rows.find(r=>r.slot===slot));
    }
    function dialog(title, content) {
        const old=document.getElementById('namespaceDesignDialog');
        if(old) old.remove();
        const overlay=document.createElement('div');
        overlay.id='namespaceDesignDialog';
        overlay.style.cssText='position:fixed;inset:0;background:#000b;z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
        overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-label="${esc(title)}" style="background:#12121f;color:#ddd;padding:24px;max-width:620px;width:100%;max-height:85vh;overflow:auto;border:1px solid #777;border-radius:6px"><h3>${esc(title)}</h3>${content}<button class="btn" id="nsDraftClose">Close</button></section>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#nsDraftClose').onclick=()=>overlay.remove();
        return overlay;
    }
    function inspect(slot) {
        ++sourceRequest;
        const row = slot===0 ? {slot:0, entryWord:0,
            metadataWords:metadata(), executable:false} :
            {...state.document.rows.find(r=>r.slot===slot), entryWord:slot*4,
                ...(!state.dirty ? {proposedDescriptor:state.projection.rows.find(r=>r.slot===slot)} : {})};
        dialog(`Namespace slot ${slot} — design inspection`,
            `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(row,null,2))}</pre><p>Design evidence only; not runtime memory or executable approval.</p>${slot?`<button class="btn" onclick="NamespaceDesignV1.authoring(${slot})">Edit authoring target</button>`:''}${row.kind==='lump'?`<button class="btn" onclick="NamespaceDesignV1.edit(${slot})">Edit placement</button><button class="btn" onclick="NamespaceDesignV1.assigned(${slot})">Open assigned LUMP</button>`:''}`);
    }
    let sourceRequest = 0;
    function thread(slot) {
        const row=state.document.rows.find(r=>r.slot===slot);
        if(!row || row.kind!=='thread' || slot===2 || state.saving) return;
        const options=selected=>state.document.rows.filter(r=>r.kind==='lump' && r.policy==='Resident' && r.selection)
            .map(r=>`<option value="${r.slot}" ${r.slot===selected?'selected':''}>${esc(r.name)} · NS[${r.slot}]</option>`).join('');
        dialog(`${row.name} — prepared continuation`,
            `<p>Choose the driver resumed in CR0 and the actor E capability placed in CR1. This changes only the draft; Save design before preparing simulation.</p>
            <label>Driver <select id="preparedThreadDriver">${options(row.preparedThread?.entrySlot)}</select></label>
            <label>Actor <select id="preparedThreadActor">${options(row.preparedThread?.actorSlot)}</select></label>
            <button class="btn" onclick="NamespaceDesignV1.setThread(${slot})">Use these bindings</button>`);
    }
    function setThread(slot) {
        const row=state.document.rows.find(r=>r.slot===slot);
        if(!row || row.kind!=='thread' || slot===2 || state.saving) return;
        const entrySlot=Number(document.getElementById('preparedThreadDriver').value);
        const actorSlot=Number(document.getElementById('preparedThreadActor').value);
        if(!entrySlot || !actorSlot) return;
        row.preparedThread={entrySlot,actorSlot};
        document.getElementById('namespaceDesignDialog').remove();
        changed();
    }
    const sourcePathValid = path => typeof path==='string' && path.length<=512 &&
        /^simulator\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.cloomc$/.test(path);
    function definitionTarget(row) {
        const status=state.dirty?'Current unsaved design':'Current Namespace design';
        let content=`<p>${esc(status)} · NS[${row.slot}] · ${esc(row.kind)}</p>`;
        if(row.kind==='mmio') {
            content+=`<h4>MMIO target</h4><dl><dt>Address</dt><dd>${hex(row.address)}</dd>
                <dt>Limit (word offset)</dt><dd>${esc(row.limit)}</dd>
                <dt>Sequence</dt><dd>${esc(row.sequence)}</dd><dt>Policy</dt><dd>${esc(row.policy)}</dd></dl>
                <p>This label targets the hardware mapping, not a compiled LUMP.
                Opening it does not read or write the device.</p>`;
        } else if(row.authoring?.kind==='namespace-table' || row.kind==='namespace') {
            content+=`<h4>Namespace table target</h4><p>${slotCount()} slots; four words per
                entry. Metadata: ${metadata().map(hex).join(' · ')}.</p>
                <table><thead><tr><th>Slot</th><th>Target</th><th>Kind</th><th>Policy</th></tr></thead><tbody>${
                    state.document.rows.map(r=>`<tr><td>${r.slot}</td><td><button class="btn btn-xs"
                        onclick="document.getElementById('namespaceDesignDialog').remove();NamespaceDesignV1.source(${r.slot})">${esc(r.name)}</button></td>
                        <td>${esc(r.kind)}</td><td>${esc(r.policy)}</td></tr>`).join('')}</tbody></table>
                <p>This is the current design table, not a substituted manifest or a live-memory claim.</p>`;
        } else if(row.kind==='thread') {
            content+=`<h4>Thread target</h4><p>Allocation: ${esc(row.words)} words.
                Sequence: ${esc(row.sequence)}. Policy: ${esc(row.policy)}.</p>
                <p>This is a configured Thread object, not an executable abstraction's source.</p>
                ${row.preparedThread?`<p>Driver: NS[${row.preparedThread.entrySlot}] · Actor E in CR1: NS[${row.preparedThread.actorSlot}]</p>`:''}
                ${row.slot!==2?`<button class="btn" onclick="NamespaceDesignV1.thread(${row.slot})">Prepare driver and actor</button>`:''}`;
        } else {
            content+=`<h4>Namespace entry definition</h4><pre>${esc(JSON.stringify(row,null,2))}</pre>
                <p>This entry definition is not executable source.</p>`;
        }
        dialog(`${row.name} — Namespace target`,content+
            `<button class="btn" onclick="NamespaceDesignV1.authoring(${row.slot})">Edit authoring target</button>`);
    }
    function missingTarget(row, detail) {
        dialog(`${row.name} — authoring target unresolved`,
            `<p>${esc(detail)} No catalog or name-based replacement was selected. The editor and assigned artifact are unchanged.</p>
            <button class="btn" onclick="NamespaceDesignV1.authoring(${row.slot})">Choose authoring target</button>
            ${row.kind==='lump'?`<button class="btn" onclick="NamespaceDesignV1.assigned(${row.slot})">Open assigned LUMP</button>`:''}`);
    }
    async function source(slot, assignedArtifact=false) {
        const row=state.document.rows.find(r=>r.slot===slot);
        if (!row) return;
        state.focusedSlot=slot;
        root._lumpRepositoryFollowsExecution=true;
        state.focusedExecutionKey=typeof root._namespaceExecutionKey==='function'
            ? root._namespaceExecutionKey(typeof root._getLiveLumpState==='function'
                ? root._getLiveLumpState() : null) : '';
        const requestId=++sourceRequest;
        const profile=state.profile, documentAtStart=state.document;
        const rowAtStart=JSON.stringify(row);
        const target=assignedArtifact?{kind:'assigned-artifact'}:row.authoring;
        if(!target) return missingTarget(row,'This Namespace entry has no authoring association.');
        if(target.kind==='entry' || target.kind==='namespace-table')
            return definitionTarget(row);
        if(row.kind!=='lump' || !['source','assigned-artifact'].includes(target.kind))
            return missingTarget(row,'The Namespace authoring association is invalid.');
        root._explicitEditorNavigationClaimed=true;
        const guard=root._captureEditorWriteGuard('open Namespace target: '+row.name);
        const accepts=()=>requestId===sourceRequest && state.active && state.profile===profile &&
            state.document===documentAtStart && state.document.rows.includes(row) &&
            JSON.stringify(row)===rowAtStart && guard.accepts();
        try {
            if(target.kind==='source') {
                if(!sourcePathValid(target.path)) throw Error('Invalid local .cloomc source path.');
                if(typeof root.openSourceFile!=='function') throw Error('Source editor is unavailable.');
                return await root.openSourceFile(target.path,
                    {accepts,writeGuard:guard,showEditor:true,propagateError:true,
                        savedBinary:row.selection && row.selection.filename ? {
                            token:row.selection.token,filename:row.selection.filename,
                            binary_hash:row.selection.binaryHash,lump_version:row.selection.revision,
                            abstraction:row.name,authoring_source_path:target.path,
                        } : null,
                        reason:`NS[${slot}] ${row.name} explicitly targets ${target.path}. Review the source before replacing the editor; the label and source declaration may differ. The assigned Namespace LUMP is unchanged.`});
            }
            const selected=row.selection || {};
            if(!/^[0-9a-f]{8}$/i.test(selected.token || '') ||
                !/^[^/\\]+\.lump$/.test(selected.filename || '') || selected.filename.includes('..') ||
                !/^[0-9a-f]{64}$/i.test(selected.binaryHash || ''))
                return missingTarget(row,'The assigned artifact lacks a complete filename, token and SHA-256 identity. Use Edit placement to select an exact artifact.');
            return await root._nsOpenDesignSelection(clone(row),slot,
                {accepts,writeGuard:guard,confirmReplacement:true});
        } catch(error) {
            if(!accepts()) return;
            state.error='Open Namespace target failed: '+error.message+
                ' Editor and Namespace placement were not replaced. Check the entry’s authoring target and retry.';
            render();
        }
    }
    function assigned(slot) { return source(slot,true); }
    function authoring(slot) {
        if(state.saving) return;
        ++sourceRequest;
        const row=state.document.rows.find(r=>r.slot===slot);
        if(!row) return;
        const documentAtStart=state.document, profile=state.profile, before=JSON.stringify(row);
        const overlay=dialog(`${row.name} — edit authoring target`,
            `<p>Choose what this Namespace label opens. This does not change its assigned LUMP, placement or running image.</p>
            <label>Target <select id="nsAuthoringKind"><option value="">Unresolved (no association)</option>
            ${row.kind==='lump'?'<option value="source">Editable source file (may be unfinished)</option><option value="assigned-artifact">Exact assigned LUMP</option>':''}
            ${['lump','namespace'].includes(row.kind)?'<option value="namespace-table">This Namespace table</option>':''}
            <option value="entry">This entry definition (MMIO / Thread / design)</option></select></label>
            <p><label>Source path <input id="nsAuthoringPath" maxlength="512" style="width:100%" placeholder="simulator/examples/my_source.cloomc" value="${esc(row.authoring?.path || '')}"></label></p>
            <p>Apply updates the draft only. Use Bind Namespace Design to review and persist it. Source files need not compile or have a saved LUMP.</p>
            <p id="nsAuthoringError" role="alert"></p><button class="btn" id="nsAuthoringApply">Apply to draft</button>`);
        const kind=overlay.querySelector('#nsAuthoringKind'), path=overlay.querySelector('#nsAuthoringPath');
        kind.value=row.authoring?.kind || '';
        kind.onchange=()=>{path.disabled=kind.value!=='source';};
        kind.onchange();
        overlay.querySelector('#nsAuthoringApply').onclick=()=>{
            const error=overlay.querySelector('#nsAuthoringError');
            if(state.saving || !state.active || state.profile!==profile || state.document!==documentAtStart ||
                    !state.document.rows.includes(row) || JSON.stringify(row)!==before) {
                error.textContent='The Namespace entry changed. Close and reopen this dialog before applying.';return;
            }
            if(kind.value==='source' && !sourcePathValid(path.value.trim())) {
                error.textContent='Use a local simulator/*.cloomc path without traversal, URL parameters or fragments.';return;
            }
            if(kind.value) row.authoring={kind:kind.value,...(kind.value==='source'?{path:path.value.trim()}:{})};
            else delete row.authoring;
            overlay.remove();changed();
        };
    }
    function clear(slot) {
        if(state.saving) return;
        const row=state.document.rows.find(r=>r.slot===slot);
        if(!row || row.kind!=='lump' || row.boot) return;
        if(!root.confirm(`Remove ${row.name} from this design? Its saved LUMP and installed image will not be deleted.`)) return;
        state.document.rows=state.document.rows.filter(r=>r.slot!==slot);
        changed();
    }
    async function edit(slot, preferred) {
        if(state.saving) return;
        ++sourceRequest;
        const original=state.document.rows.find(r=>r.slot===slot);
        if(original && original.kind!=='lump') return;
        const free=Array.from({length:slotCount()-3},(_,i)=>i+3).find(s=>!state.document.rows.some(r=>r.slot===s));
        const overlay=dialog(original?'Edit Namespace member':'Add LUMP to Namespace',
            `<label>Saved LUMP (optional)<select id="nsDraftLump" style="width:100%"><option value="">Unfinished / name only</option></select></label>
            <p><label>Pet name <input id="nsDraftName" maxlength="128" value="${esc(original?original.name:'')}" style="width:100%"></label></p>
            <p><label>Slot <input id="nsDraftSlot" type="number" min="3" max="${slotCount()-1}" value="${original?original.slot:preferred||free||''}"></label></p>
            <p><label>Policy <select id="nsDraftPolicy" ${state.profile==='phase1'?'disabled':''}>${state.profile==='phase1'?'':'<option>Lazy</option>'}<option>Resident</option></select></label></p>
            <p><label><input id="nsDraftBoot" type="checkbox" ${original&&original.boot?'checked':''}> Boot target in this design</label></p>
            <p>Unfinished entries are allowed. Placement does not grant execution authority.</p>
            <p id="nsDraftError" role="alert"></p><button class="btn" id="nsDraftApply">${original?'Apply changes':'Add to Namespace (design)'}</button> `);
        const name=overlay.querySelector('#nsDraftName'), slotEl=overlay.querySelector('#nsDraftSlot');
        const policy=overlay.querySelector('#nsDraftPolicy'), picker=overlay.querySelector('#nsDraftLump');
        policy.value=state.profile==='phase1'?'Resident':original?original.policy:'Lazy';
        let selected=original && original.selection;
        // A catalog refresh must never disguise or replace the exact placement.
        if(selected) {
            const option=document.createElement('option');
            option.value='retained';
            option.textContent='Keep selected revision '+selected.revision+' — '+selected.filename;
            picker.appendChild(option);
            picker.value='retained';
        }
        let records=[];
        picker.onchange=()=>{
            if(picker.value==='retained') { selected=original.selection; return; }
            const record=records[Number(picker.value)];
            selected=picker.value===''?null:record ? {
                filename:record.filename, binaryHash:record.binary_hash || record.binaryHash,
                token:record.token, revision:record.lump_version || record.revision,
            }:null;
            if(record && picker.value!=='') name.value=record.abstraction || record.name || '';
        };
        overlay.querySelector('#nsDraftApply').onclick=()=>{
            const value=name.value.trim(), next=Number(slotEl.value);
            const error=overlay.querySelector('#nsDraftError');
            if(!value || /[\x00-\x1f\x7f]/.test(value) || !Number.isInteger(next) || next<3 || next>=slotCount() ||
                state.document.rows.some(r=>r!==original && (r.slot===next || r.name===value))) {
                error.textContent=`Choose a unique pet name and a free slot from 3 to ${slotCount()-1}.`; return;
            }
            if(original && next!==original.slot) {
                error.textContent='Clear and add a separate design placement to change its slot; existing bindings are not rewritten.'; return;
            }
            const row={slot:next,name:value,kind:'lump',policy:state.profile==='phase1'?'Resident':policy.value,sequence:original?original.sequence:0};
            if(original?.authoring) row.authoring=clone(original.authoring);
            if(selected) row.selection=clone(selected);
            const boot=overlay.querySelector('#nsDraftBoot').checked;
            if(original && original.boot && !boot) {
                error.textContent='Select another member as boot target first.'; return;
            }
            if(boot) {
                row.boot=true;
                state.document.rows.forEach(r=>{if(r.boot) r.boot=false;});
            }
            state.document.rows=state.document.rows.filter(r=>r!==original).concat([row]).sort((a,b)=>a.slot-b.slot);
            overlay.remove(); changed();
        };
        name.focus();
        try {
            const response=await fetch('/api/lumps/list');
            if(!response.ok) throw Error('Saved LUMP list unavailable; name-only placement remains available');
            const data=await response.json();
            records=Array.isArray(data)?data:(data.lumps || []);
            records.forEach((r,i)=>{
                const option=document.createElement('option');
                option.value=String(i); option.textContent=(r.abstraction || r.name || r.filename)+' — '+r.filename;
                picker.appendChild(option);
            });
        } catch(e) { overlay.querySelector('#nsDraftError').textContent=e.message; }
    }
    function showBindingFailure(message) {
        state.error=message;
        if (root.NamespaceBindingWindows) {
            const rows=state.document && state.document.rows || [];
            root.NamespaceBindingWindows.show({
                fingerprint:state.fingerprint, status:'blocked', installed:false,
                lists:rows.filter(row=>row.kind==='lump').map(row=>({
                    slot:row.slot, name:row.name, filename:row.selection && row.selection.filename,
                    status:'blocked', rows:[], reason:message
                }))
            });
        }
    }
    function acceptSavedResult(result) {
        accept(result);
        if (result.bindingReport && root.NamespaceBindingWindows) {
            root.NamespaceBindingWindows.show(result.bindingReport);
            const st=result.bindingReport.status;
            if (st==='partial' || st==='unresolved') {
                state.error='Design saved. Some references remain unresolved; they fault only if executed. See the C-list windows. No running session was changed.';
            } else if (st !== 'complete') {
                state.error='Design saved. Binding is blocked; see the C-list windows for the exact reasons. No runtime image was changed.';
            }
        } else {
            showBindingFailure('Design saved, but binding results are unavailable. Reload the IDE and bind again. No runtime image was changed.');
        }
    }
    async function save() {
        if(state.saving || !state.document) return;
        state.saving=true; state.error=''; render();
        try {
            if (!root.NamespaceIdeNode) throw Error('IDE node setting is unavailable. Reload the page before saving.');
            if (!await root.NamespaceIdeNode.savePending()) {
                showBindingFailure('IDE node was not saved. Binding did not run; your Namespace edits are retained. Resolve the IDE node setting, then bind again.');
                return;
            }
            const result = await request('PUT',{fingerprint:state.fingerprint,document:clone(state.document)});
            acceptSavedResult(result);
        }
        catch(e) { showBindingFailure(e.message+
            ' Check the IDE node status above: its save is separate and may already have completed. '+
            'No executable image was changed. Your Namespace draft is retained.'); }
        finally { state.saving=false; render(); }
    }
    function capacity(value) {
        if(state.saving || state.profile!=='phase1') return;
        const n=Number(value);
        if(!Number.isInteger(n) || n<16 || n>4096 || state.document.rows.some(r=>r.slot>=n)) {
            state.error='Choose 16–4096 slots, including every occupied slot. No rows were removed.';
            render(); return;
        }
        state.document.slotCount=n; changed();
    }
    async function advanceSavedRevision(rows) {
        if(state.saving || state.dirty) throw Error('Namespace design has unsaved edits; preserve and save them before realignment.');
        const result = await request('PUT',{fingerprint:state.fingerprint,
            document:{...clone(state.document),rows:clone(rows)}});
        acceptSavedResult(result);
        render();
    }
    async function newSelfTestRevision() {
        const profile=state.profile, documentAtStart=state.document;
        if(!state.active || !documentAtStart) return;
        try {
            await root.openSourceFile('api/namespace/selftest-source', {
                accepts:()=>state.active && state.profile===profile && state.document===documentAtStart,
                showEditor:true,propagateError:true,
                reason:'Create a new ide.SelfTest revision from the canonical SelfTest body with explicit callable identity. Review before replacing the editor. Compile and approve Save LUMP separately; no historical binary or Namespace selection is changed by opening this source.'
            });
        } catch(error) {
            state.error='Could not open corrected SelfTest source: '+error.message+'. Nothing was saved; retry.';
            render();
        }
    }
    root.NamespaceDesignV1={state,render,load,save,edit,inspect,source,assigned,authoring,thread,setThread,clear,setProfile,snapshot,renderRows,policy,boot,addFromOriginal,identity,capacity,advanceSavedRevision,newSelfTestRevision};
    if(typeof document!=='undefined') {
        const initialize = () => {
            const capacity = document.getElementById('bootCapacityPanel');
            if (capacity) capacity.hidden = state.active;
            render();
        };
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initialize);
        else initialize();
    }
})(typeof window!=='undefined'?window:globalThis);
