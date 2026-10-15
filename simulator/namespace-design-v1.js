/* The ascending profile of the Namespace editor. Drafts never write sim or ns-state. */
(function(root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hex = n => n == null ? 'Unresolved' : '0x' + n.toString(16).toUpperCase().padStart(8,'0');
    const state = {active:true, loading:false, saving:false, document:null, fingerprint:null,
        projection:null, error:'', dirty:false};
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
        if (!['ascending','phase1','legacy'].includes(value)) return;
        if (state.loading || state.saving) {
            const select = document.getElementById('namespaceDesignProfile');
            if (select) select.value = state.active ? state.profile : 'legacy';
            return;
        }
        drafts[state.profile] = {...state};
        state.active = value !== 'legacy';
        if (state.active && value !== state.profile) {
            Object.assign(state, drafts[value] || {document:null, fingerprint:null,
                projection:null, error:'', dirty:false, loading:false, saving:false},
                {profile:value, active:true});
        }
        try { root.localStorage.setItem(profileKey, value); }
        catch (_) { state.error = 'Browser storage is unavailable; this layout choice cannot survive a restart.'; }
        const legacy = document.getElementById('bootCapacityPanel');
        if (legacy) legacy.hidden = state.active;
        root.updateNamespace();
    }
    function changed() { state.dirty=true; state.error=''; render(); }
    function render() {
        const selector = document.getElementById('namespaceDesignProfile');
        if (selector) selector.value = state.active ? state.profile : 'legacy';
        if (!state.active) return;
        const host = document.getElementById('namespaceTable');
        if (!host) return;
        const capacity = document.getElementById('bootCapacityPanel');
        if (capacity) capacity.hidden = true;
        if (!state.document) {
            host.innerHTML = state.error ? `<p role="alert">${esc(state.error)}</p><button onclick="NamespaceDesignV1.load()">Retry</button>` :
                '<p>Loading new-format Namespace design…</p>';
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
            <td class="ns-entry-actions"><button class="btn btn-xs ns-inspect-btn" onclick="NamespaceDesignV1.inspect(${slot})">Inspect and resolve</button>${r.kind==='lump'?`<button class="btn btn-xs" style="background:#2d4a3e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35)" onclick="NamespaceDesignV1.source(${slot})">Open LUMP</button>`:''}${select}${r.kind==='lump'?`<button class="btn btn-xs ns-identity-btn" style="background:#27233b;color:#c4a7ff;border:1px solid rgba(196,167,255,0.35);margin-left:5px;font-size:0.65rem;padding:1px 5px" onclick="NamespaceDesignV1.identity(${slot})">Identity</button>`:''}</td></tr>`;
        }
        html+='</tbody></table><p id="nsSaveLayoutNote" role="status"></p>';
        if(state.profile==='phase1') html+=`<p>Phase 1: slot 0 metadata · 1 self · 2 entry Thread · 8 UART · 9 ide.Mint (requested E) · 14 nstab (requested RW) · 15 pkverify (requested E). Requested rights are design intent, not granted capabilities.</p><label>Total slots (including metadata) <input type="number" min="16" max="4096" value="${slotCount()}" onchange="NamespaceDesignV1.capacity(this.value)" ${state.saving?'disabled':''}></label><p>${slotCount()*4} table words / ${slotCount()*16} bytes · CR15 table-only limit ${slotCount()*4-1}. Unfinished placements remain non-executable.</p>`;
        host.innerHTML=html;
        const saveButton=host.querySelector('#nsSaveBtn');
        saveButton.onclick=save;
        saveButton.textContent='Bind Namespace Design';
        saveButton.title='Save this design and show fresh C-list binding results. Does not activate or change a running image.';
        saveButton.disabled=state.saving;
        if(state.dirty) saveButton.textContent+=' *';
        host.querySelector('#nsSaveLayoutNote').textContent=state.error ||
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
        const row = slot===0 ? {slot:0, entryWord:0,
            metadataWords:metadata(), executable:false} :
            {...state.document.rows.find(r=>r.slot===slot), entryWord:slot*4,
                ...(!state.dirty ? {proposedDescriptor:state.projection.rows.find(r=>r.slot===slot)} : {})};
        dialog(`Namespace slot ${slot} — design inspection`,
            `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(row,null,2))}</pre><p>Design evidence only; not runtime memory or executable approval.</p>${row.kind==='lump'?`<button class="btn" onclick="NamespaceDesignV1.edit(${slot})">Edit placement</button>`:''}`);
    }
    let sourceRequest = 0;
    async function source(slot) {
        const row=state.document.rows.find(r=>r.slot===slot);
        if (!row) return;
        if (row.kind!=='lump') return inspect(slot);
        const requestId=++sourceRequest;
        root._explicitEditorNavigationClaimed=true;
        const guard=root._captureEditorWriteGuard('open latest Namespace source: '+row.name);
        try {
            const response=await fetch('/api/lumps/list?abstraction='+encodeURIComponent(row.name)+
                '&include_archived=1',{cache:'no-store'});
            const catalog=await response.json();
            if (!response.ok || !Array.isArray(catalog)) throw Error(catalog.error || 'Saved LUMP catalog could not be read.');
            if(requestId!==sourceRequest || !guard.accepts()) return;
            const time=r=>{
                if (r.compiled_at == null || r.compiled_at==='') return 0;
                const n=Number(r.compiled_at);
                return Number.isFinite(n)?n:Date.parse(r.compiled_at)/1000 || 0;
            };
            const candidates=catalog.filter(r=>r.abstraction===row.name).sort((a,b)=>
                time(b)-time(a) || Number(b.lump_version || 0)-Number(a.lump_version || 0));
            const latest=candidates[0];
            if (!latest) throw Error('No saved revision exists for '+row.name+'.');
            if (candidates[1] && time(latest)===time(candidates[1]) &&
                    Number(latest.lump_version)===Number(candidates[1].lump_version))
                throw Error('The latest saved revision is ambiguous; inspect the repository before opening.');
            // Never substitute an older valid revision for invalid newest bytes.
            if (latest.binary_valid===false) throw Error(
                'Latest '+row.name+' v'+latest.lump_version+' failed validation: '+
                (latest.validation_errors || []).join('; '));
            if(!/^[0-9a-f]{8}$/i.test(latest.token || '') ||
                !/^[^/\\]+\.lump$/.test(latest.filename || '') ||
                !/^[0-9a-f]{64}$/i.test(latest.binary_hash || ''))
                throw Error('Latest saved revision lacks a complete exact binary identity.');
            return await root._nsOpenDesignSelection({name:row.name, selection:{
                token:latest.token, filename:latest.filename, binaryHash:latest.binary_hash,
                revision:latest.lump_version
            }},slot);
        } catch(error) {
            if(requestId!==sourceRequest || !guard.accepts()) return;
            state.error='Open latest LUMP failed: '+error.message+
                ' Editor and Namespace placement were not replaced. Inspect the repository and retry.';
            render();
        }
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
        let records=[];
        picker.onchange=()=>{
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
    async function save() {
        if(state.saving || !state.document) return;
        state.saving=true; render();
        try {
            if (!root.NamespaceIdeNode) throw Error('IDE node setting is unavailable. Reload the page before saving.');
            if (!await root.NamespaceIdeNode.savePending()) {
                state.error='IDE node was not saved. Namespace design save stopped; your edits are retained.';
                return;
            }
            const result = await request('PUT',{fingerprint:state.fingerprint,document:clone(state.document)});
            accept(result);
            if (result.bindingReport && root.NamespaceBindingWindows) {
                root.NamespaceBindingWindows.show(result.bindingReport);
                if (result.bindingReport.status !== 'complete') {
                    state.error='Design saved. Binding is blocked; see the C-list windows for the exact reasons. No runtime image was changed.';
                }
            } else {
                state.error='Design saved, but binding results are unavailable. Reload the IDE and bind again. No runtime image was changed.';
            }
        }
        catch(e) { state.error=e.message+
            ' Check the IDE node status above: its save is separate and may already have completed. '+
            'No executable image was changed. Your Namespace draft is retained.'; }
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
    root.NamespaceDesignV1={state,render,load,save,edit,inspect,source,clear,setProfile,snapshot,renderRows,policy,boot,addFromOriginal,identity,capacity};
    if(typeof document!=='undefined') {
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',render);
        else render();
    }
})(typeof window!=='undefined'?window:globalThis);
