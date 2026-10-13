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
    async function request(method, body) {
        const response = await fetch(endpoint, {method, cache:'no-store',
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
        state.active = value === 'ascending';
        const legacy = document.getElementById('bootCapacityPanel');
        if (legacy) legacy.hidden = state.active;
        root.updateNamespace();
    }
    function changed() { state.dirty=true; state.error=''; render(); }
    function render() {
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
        return {counts:{max:64,assigned:rows.length,resident:rows.filter(r=>r.policy!=='Lazy').length,
            lazy:rows.filter(r=>r.policy==='Lazy').length,garbage:0,free:63-rows.length}};
    }
    function renderRows(html, host) {
        const d=state.document, p=state.projection;
        // Keep the original 11-column table and its compact controls.
        html+=`<tr id="ns-row-0" class="ns-row"><td class="ns-idx-cell">0</td><td class="ns-saved-version-col">—</td><td class="ns-label ns-label-clickable" onclick="NamespaceDesignV1.inspect(0)">Namespace header</td><td>${hex(0xf8810100)}</td><td colspan="5">W1 base ${hex(0)} · W2 members ${d.rows.length-1} · W3 ${hex(0)}</td><td>—</td><td><button class="btn btn-xs ns-inspect-btn" onclick="NamespaceDesignV1.inspect(0)">Inspect</button></td></tr>`;
        const displayCount=Math.min(64,Math.max(...d.rows.map(row=>row.slot))+1);
        for(let slot=1;slot<displayCount;slot++) {
            const r=d.rows.find(r=>r.slot===slot);
            if(!r) {
                html+=`<tr id="ns-row-${slot}" class="ns-row" style="opacity:0.45"><td class="ns-idx-cell">${slot}</td><td class="ns-saved-version-cell ns-saved-version-unavailable">NA</td><td colspan="8" style="color:#555;font-style:italic;font-size:0.8rem">(no entry installed)</td><td class="ns-entry-actions"></td></tr>`;
                continue;
            }
            const projection=p.rows.find(v=>v.slot===slot);
            const current=!state.dirty && projection && projection.policy===r.policy && projection.name===r.name;
            const location=r.kind==='namespace'?0:r.kind==='mmio'?r.address:current?projection.location:null;
            const limit=r.kind==='namespace'?255:r.kind==='mmio'?r.limit:current?projection.limit:null;
            const select=r.kind==='lump'?`<select aria-label="Load policy for slot ${slot}" onchange="NamespaceDesignV1.policy(${slot},this.value)" style="margin-left:5px;background:#0d0d1a;color:#d0d0e8;border:1px solid #6b5320;border-radius:3px;font-size:0.68rem;padding:1px 3px;"><option ${r.policy==='Resident'?'selected':''}>Resident</option><option ${r.policy==='Lazy'?'selected':''}>Lazy</option></select>`:
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
        host.innerHTML=html;
        const saveButton=host.querySelector('#nsSaveBtn');
        saveButton.onclick=save;
        saveButton.textContent='Save Namespace Design';
        saveButton.disabled=state.saving;
        if(state.dirty) saveButton.textContent+=' *';
        host.querySelector('#nsSaveLayoutNote').textContent=state.error ||
            'Ascending layout · API-only allocations · design only, not installed. '+(state.dirty?'Unsaved changes. ':'')+
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
        const row=state.document.rows.find(r=>r.slot===slot);
        if(row && row.kind==='lump' && ['Lazy','Resident'].includes(value)) {row.policy=value;changed();}
    }
    async function addFromOriginal() {
        if(state.saving) return;
        const name=document.getElementById('_nsPlacementName').value.trim();
        const slotText=document.getElementById('_nsPlacementSlot').value;
        const slot=slotText?Number(slotText):Array.from({length:61},(_,i)=>i+3).find(i=>!state.document.rows.some(r=>r.slot===i));
        const error=document.getElementById('_nsAddError');
        if(!name || name.length>128 || /[\x00-\x1f\x7f]/.test(name) || !Number.isInteger(slot) || slot<3 || slot>63 || state.document.rows.some(r=>r.slot===slot||r.name===name)) {
            error.textContent='Choose a unique name and a free slot from 3 to 63.';return;
        }
        const picker=document.getElementById('_nsAddSelect');
        const record=picker && (root._nsAddAvailableList||[])[picker.selectedIndex-1];
        const row={slot,name,kind:'lump',policy:'Lazy',sequence:0};
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
            metadataWords:[0xf8810100,0,state.document.rows.length-1,0], executable:false} :
            {...state.document.rows.find(r=>r.slot===slot), entryWord:slot*4,
                ...(!state.dirty ? {proposedDescriptor:state.projection.rows.find(r=>r.slot===slot)} : {})};
        dialog(`Namespace slot ${slot} — design inspection`,
            `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(row,null,2))}</pre><p>Design evidence only; not runtime memory or executable approval.</p>${row.kind==='lump'?`<button class="btn" onclick="NamespaceDesignV1.edit(${slot})">Edit placement</button>`:''}`);
    }
    function source(slot) {
        const row=state.document.rows.find(r=>r.slot===slot);
        if (row.kind!=='lump') return inspect(slot);
        root._nsOpenDesignSelection({name:row.name, selection:row.selection || {status:'missing'}},slot);
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
        const free=Array.from({length:61},(_,i)=>i+3).find(s=>!state.document.rows.some(r=>r.slot===s));
        const overlay=dialog(original?'Edit Namespace member':'Add LUMP to Namespace',
            `<label>Saved LUMP (optional)<select id="nsDraftLump" style="width:100%"><option value="">Unfinished / name only</option></select></label>
            <p><label>Pet name <input id="nsDraftName" maxlength="128" value="${esc(original?original.name:'')}" style="width:100%"></label></p>
            <p><label>Slot <input id="nsDraftSlot" type="number" min="3" max="63" value="${original?original.slot:preferred||free||''}"></label></p>
            <p><label>Policy <select id="nsDraftPolicy"><option>Lazy</option><option>Resident</option></select></label></p>
            <p><label><input id="nsDraftBoot" type="checkbox" ${original&&original.boot?'checked':''}> Boot target in this design</label></p>
            <p>Unfinished entries are allowed. Placement does not grant execution authority.</p>
            <p id="nsDraftError" role="alert"></p><button class="btn" id="nsDraftApply">${original?'Apply changes':'Add to Namespace (design)'}</button> `);
        const name=overlay.querySelector('#nsDraftName'), slotEl=overlay.querySelector('#nsDraftSlot');
        const policy=overlay.querySelector('#nsDraftPolicy'), picker=overlay.querySelector('#nsDraftLump');
        policy.value=original?original.policy:'Lazy';
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
            if(!value || /[\x00-\x1f\x7f]/.test(value) || !Number.isInteger(next) || next<3 || next>=64 ||
                state.document.rows.some(r=>r!==original && (r.slot===next || r.name===value))) {
                error.textContent='Choose a unique pet name and a free slot from 3 to 63.'; return;
            }
            if(original && next!==original.slot) {
                error.textContent='Clear and add a separate design placement to change its slot; existing bindings are not rewritten.'; return;
            }
            const row={slot:next,name:value,kind:'lump',policy:policy.value,sequence:original?original.sequence:0};
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
        let nodeChanged=false;
        try {
            if (!root.NamespaceIdeNode) throw Error('IDE node setting is unavailable. Reload the page before saving.');
            nodeChanged=root.NamespaceIdeNode.hasPending();
            if (!await root.NamespaceIdeNode.savePending()) {
                state.error='IDE node was not saved. Namespace design save stopped; your edits are retained.';
                return;
            }
            accept(await request('PUT',{fingerprint:state.fingerprint,document:clone(state.document)}));
        }
        catch(e) { state.error=e.message+
            (nodeChanged?' Check the IDE node status above: its save is separate and may already have completed. ':' ')+
            'No executable image was changed. Your Namespace draft is retained.'; }
        finally { state.saving=false; render(); }
    }
    root.NamespaceDesignV1={state,render,load,save,edit,inspect,source,clear,setProfile,snapshot,renderRows,policy,boot,addFromOriginal,identity};
    if(typeof document!=='undefined') {
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',render);
        else render();
    }
})(typeof window!=='undefined'?window:globalThis);
