// Save is the programmer's explicit choice of the next revision. Never select
// an unrelated "latest", rewrite editor text, or send anything to hardware.
(function(root) {
    const storageKey = 'savedLumpRealignment';
    const dismissalKey = 'savedLumpRealignmentDismissedNotice';
    const readyMessage = 'Saved revision ready. Use Run or Step in Namespace.';
    let retryInput = null;
    let dismissedNotice = null;
    try { dismissedNotice = root.sessionStorage.getItem(dismissalKey); } catch (_) {}
    function noticeKey(state) {
        if (!state) return null;
        const saved = (state.retryInput || retryInput)?.response || {};
        // Canonical fields, not object property order or transient pending state.
        return JSON.stringify([state.privateReady === true, state.message,
            saved.token, saved.lump, saved.digest, saved.lump_version]);
    }
    function renderStatus() {
        if (typeof document === 'undefined' || !document.body) return;
        let host = document.getElementById('savedLumpRealignmentStatus');
        if (!host) {
            host = document.createElement('div');
            host.id = 'savedLumpRealignmentStatus';
            host.setAttribute('role','status');
            host.style.cssText='position:fixed;top:80px;right:16px;z-index:100000;box-sizing:border-box;max-width:min(520px,calc(100vw - 32px));padding:10px 76px 10px 10px;background:#29344c;color:#fff;border:1px solid #e0a055;box-shadow:0 4px 20px #0008';
            document.body.prepend(host);
        }
        host.replaceChildren();
        const state = root._savedLumpRealignment;
        // Saved identity is already visible in the editor. Never replay a
        // successful save as a persistent popup, even without dismissal storage.
        // Retain the underlying state: presentation is not execution authority.
        const ready = state && !state.pending && state.privateReady === true;
        host.hidden = !state || ready || dismissedNotice === noticeKey(state);
        if (!state || ready) return;
        host.setAttribute('data-state', state.pending ? 'pending' : 'error');
        host.style.borderColor = state.pending ? '#93c5fd' : '#e0a055';
        host.style.background = '#29344c';
        host.append(document.createTextNode(state.message+' '));
        if (!state.pending && retryInput) {
            const button=document.createElement('button');
            button.textContent='Retry saved-revision alignment';
            button.onclick=()=>realign(retryInput.response,retryInput.metadata).catch(()=>{});
            host.append(button);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.setAttribute('aria-label', 'Close saved revision notice');
        close.style.cssText = 'position:absolute;top:6px;right:6px;min-height:32px;padding:4px 10px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:4px;cursor:pointer';
        // Dismiss presentation only. Never clear the execution barrier or
        // cancel an in-flight preparation just because its notice is closed.
        close.onclick = () => {
            dismissedNotice = noticeKey(state);
            try { root.sessionStorage.setItem(dismissalKey, dismissedNotice); } catch (_) {}
            host.hidden = true;
        };
        host.append(close);
    }
    function barrier(value) {
        if (value && retryInput) value.retryInput = retryInput;
        root._savedLumpRealignment = value;
        try {
            if (value) root.sessionStorage.setItem(storageKey,JSON.stringify(value));
            else root.sessionStorage.removeItem(storageKey);
        } catch (_) {}
        renderStatus();
    }
    try {
        root._savedLumpRealignment = JSON.parse(root.sessionStorage.getItem(storageKey) || 'null');
        if (root._savedLumpRealignment) {
            retryInput = root._savedLumpRealignment.retryInput || null;
            root._savedLumpRealignment.pending = false;
            // Refresh the wording of already-persisted successful statuses too.
            if (root._savedLumpRealignment.privateReady === true) {
                root._savedLumpRealignment.message = readyMessage;
            }
        }
    } catch (_) {}
    function begin() {
        // Only an explicit new preparation resets dismissal, never a redraw
        // or restoration of the same notice after page reload.
        dismissedNotice = null;
        try { root.sessionStorage.removeItem(dismissalKey); } catch (_) {}
        if (root.DesignSimulation) root.DesignSimulation.invalidate();
        barrier({pending:true,message:'Saved revision is being aligned. Stale execution is stopped.'});
        if (typeof stopSim === 'function') stopSim();
        if (typeof finishWalk === 'function') finishWalk();
        if (typeof bootAnimating !== 'undefined') bootAnimating = false;
    }
    function replacementRows(rows, artifact, metadata, design) {
        if (metadata.save_as_copy) return {rows, slots:[]};
        const previous = metadata.editor_base || {};
        const matches = rows.filter(row => {
            const selected = row.selection || row;
            return row.name === artifact.abstraction ||
                (previous.filename && selected.filename === previous.filename) ||
                // Explicit canonicalization of this IDE's old unqualified names.
                (!String(row.name).includes('.') && artifact.abstraction === 'ide.' + row.name);
        });
        if (matches.length > 1) throw Error('Several Namespace slots match this saved revision; select its destination explicitly.');
        if (matches.some(row => Number(row.slot) < 2)) throw Error('Foundational Namespace slots cannot be replaced by Save LUMP.');
        const slots = matches.map(row => row.slot);
        return {slots, rows:rows.map(row => {
            if (!matches.includes(row)) return row;
            const next = {...row, name:artifact.abstraction};
            if (design) {
                next.selection = {token:artifact.token,filename:artifact.filename,
                    binaryHash:artifact.binary_hash,revision:artifact.lump_version};
            } else {
                Object.assign(next, {token:artifact.token,filename:artifact.filename,
                    binary_hash:artifact.binary_hash,lump_version:artifact.lump_version,
                    artifact_pin:{token:artifact.token,filename:artifact.filename,revision:artifact.lump_version}});
                for (const key of ['identity_hash','identityHash','seal','revision_hash']) delete next[key];
                for (const key of ['identity_hash','issue_n']) if (artifact[key] != null) next[key]=artifact[key];
            }
            return next;
        })};
    }
    async function request(url, body, method='POST', headers={}) {
        const response = await fetch(url, body === undefined ? {cache:'no-store'} : {
            method, headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
        const data = await response.json();
        if (!response.ok || data?.ok === false) {
            const explanation = [data?.message, data?.error]
                .find(value => typeof value === 'string' && value.trim());
            throw Error(explanation || `Realignment failed (${response.status}).`);
        }
        return data;
    }
    async function refreshHistory(response) {
        const list = await request('/api/lumps/list?include_archived=1');
        const records = list.filter(row => row.archived !== true &&
            row.token === response.token &&
            row.filename === (response.lump || response.filename) &&
            row.binary_hash === (response.digest || response.binary_hash) &&
            (response.lump_version == null || row.lump_version === response.lump_version));
        if (records.length !== 1) throw Error(
            `Expected one active catalog record for the saved LUMP, but found ${records.length}. ` +
            'No substitute was selected; execution remains stopped. Refresh the LUMP library and retry saved-revision alignment. ' +
            'If another save superseded it, explicitly select the intended revision from History.');
        const artifact = records[0];
        root._lumpLibraryBrowsing = true;
        if (typeof renderLumps === 'function') await renderLumps();
        if (typeof showLumpDetail === 'function') showLumpDetail(artifact.token,{assignedLump:artifact});
        if (typeof _switchLumpTab === 'function') await _switchLumpTab(_lumpTokenIdentity(artifact.token),'history');
        return artifact;
    }
    async function realign(response, metadata) {
        retryInput = {response:{token:response.token,lump:response.lump || response.filename,
            digest:response.digest || response.binary_hash,lump_version:response.lump_version},
            metadata:{save_as_copy:metadata.save_as_copy,editor_base:metadata.editor_base}};
        begin();
        try {
            // Publication is already committed: History must advance even if
            // downstream Namespace admission needs correction.
            const artifact = await refreshHistory(response);
            const design = root.NamespaceDesignV1;
            let advanced = false;
            if (design && design.state.active) {
                if (!design.state.document) await design.load();
                const result = replacementRows(design.state.document.rows,artifact,metadata,true);
                if (result.slots.length) {
                    await design.advanceSavedRevision(result.rows);
                    advanced = true;
                }
            } else {
                if (root._nsTableDirty) throw Error('The Namespace has unsaved edits. Save those edits before realigning this committed LUMP.');
                const state = await request('/api/boot-image/ns-state');
                const result = replacementRows(state.abstractions,artifact,metadata,false);
                if (result.slots.length) {
                    root._nsState = await request('/api/namespace/save-table',{
                        namespaceFingerprint:state.namespaceFingerprint,ns_state:{abstractions:result.rows}});
                    advanced = true;
                }
            }
            // Always display the just-saved exact record, even for a new library
            // object with no assigned slot. Never invent a destination for it.
            root._lumpLibraryBrowsing = !advanced;
            if (typeof renderLumps === 'function') await renderLumps();
            if (typeof showLumpDetail === 'function') showLumpDetail(artifact.token,{assignedLump:artifact});
            if (typeof _switchLumpTab === 'function') await _switchLumpTab(_lumpTokenIdentity(artifact.token),'history');
            if (!advanced) throw Error('This saved LUMP has no Namespace assignment. Select a destination before simulation.');
            if (design && design.state.active) {
                if (!root.DesignSimulation) throw Error('Validated design simulation admission is unavailable. Reload the IDE and retry; stale execution remains stopped.');
                await root.DesignSimulation.prepare(true);
                // A successful ascending replay does not authorize legacy Run
                // or silently replace its differently formatted machine.
                barrier({pending:false,privateReady:true,message:readyMessage});
                return artifact;
            }
            // Do not splice a c-list into the running image: replace the complete
            // validated private simulation, leaving it stopped at the new boot.
            for (let i=0; typeof _simRunActive !== 'undefined' && _simRunActive && i<100; i++)
                await new Promise(resolve=>setTimeout(resolve,20));
            if (!root.SimulationPreparation) throw Error('Simulation preparation is unavailable.');
            for (const action of ['prepare','approve','activate']) {
                if (!await root.SimulationPreparation[action]()) throw Error(`Saved revision selected, but simulation ${action} failed. Review the simulation panel; stale execution remains blocked.`);
            }
            barrier(null);
            return artifact;
        } catch (error) {
            barrier({pending:false,message:`LUMP saved; realignment incomplete. ${error.message}`});
            // A display refresh must not disguise a committed artifact as a
            // failed save or clear the stale-execution barrier.
            throw error;
        }
    }
    root.LumpSaveRealignment = {realign,refreshHistory,replacementRows,begin,clear:()=>barrier(null)};
    renderStatus();
    if (typeof module !== 'undefined') module.exports = root.LumpSaveRealignment;
})(typeof window !== 'undefined' ? window : globalThis);
