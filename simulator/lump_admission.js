/*
 * LUMP admission is deliberately kept separate from execution.  The browser
 * can inspect an uploaded blob at any time, but an upload gets an executable
 * token only after all of the applicable gates have passed.
 *
 * This file has no dependency on the simulator so it is also useful to the
 * file-picker and to tests running without a DOM.
 */
'use strict';

const GATES = Object.freeze([
    'provenance', 'structure', 'type', 'integrity', 'authority', 'containment'
]);

function result(ok, message, extra) {
    return Object.assign({ ok: !!ok, message: String(message || '') }, extra || {});
}

function checkGate(name, value) {
    if (value === true || (value && value.ok === true)) {
        return result(true, name + ' gate passed');
    }
    if (value && value.ok === null) {
        return result(null, value.message || name + ' gate unavailable',
            { status: 'unavailable' });
    }
    return result(false, value && value.message || name + ' gate failed');
}

/**
 * Admit an unknown/uploaded LUMP. `checks` may contain booleans or
 * {ok,message,status} records. Missing checks are failures, never approvals.
 */
function admitUpload(upload, checks, options) {
    options = options || {};
    const source = upload && typeof upload === 'object' ? upload : null;
    const reports = {};
    let admitted = !!source;
    if (!source) reports.provenance = result(false, 'upload is not an object');
    for (let i = 0; i < GATES.length; i++) {
        const gate = GATES[i];
        const value = checks && checks[gate];
        reports[gate] = reports[gate] || checkGate(gate, value);
        if (reports[gate].ok !== true) admitted = false;
    }
    // An explicitly inert upload is never accidentally promoted by callers.
    const inert = !admitted;
    const out = {
        ok: admitted,
        admitted,
        inert,
        executable: admitted,
        reports,
        gates: GATES.slice(),
        source: source,
        egt: admitted ? (options.mintEgt || null) : null,
    };
    if (admitted && !out.egt) {
        out.ok = out.admitted = out.executable = false;
        out.inert = true;
        out.message = 'all admission gates passed, but Mint E-GT is unavailable';
    } else {
        out.message = admitted ? 'upload admitted; Mint E-GT issued' :
            'upload remains inert pending Gate 0–5 admission';
    }
    return out;
}

/**
 * Trusted compiler output is already statically checked by Compile.  Do not
 * route it through an approval ledger or reconstruct its source to approve it.
 */
function trustedCompilerOutput(output, compiler) {
    if (!output || output.ok === false) {
        return result(false, 'compiler did not produce a successful output');
    }
    const identity = compiler || output.compiler || {};
    return {
        ok: true,
        trusted: true,
        authoritative: true,
        approvalRequired: false,
        executableCandidate: true,
        compiler: {
            identity: identity.identity || identity.name || 'Trusted Home IDE',
            version: identity.version || 'unknown'
        },
        output
    };
}

function chooseArtifact(selection, revisions) {
    selection = selection || {};
    const list = Array.isArray(revisions) ? revisions : [];
    if (!selection.revision || selection.slot == null ||
            typeof selection.replace !== 'boolean' ||
            typeof selection.resident !== 'boolean' ||
            typeof selection.boot !== 'boolean') {
        return result(false, 'explicit revision, destination, replace, resident, and boot choices are required',
            { code: 'EXPLICIT_SELECTION_REQUIRED' });
    }
    const matches = list.filter(r => String(r.revision || r.token) === String(selection.revision));
    if (matches.length !== 1) {
        return result(false, matches.length ? 'artifact revision is ambiguous' :
            'requested artifact revision was not found', { code: 'REVISION_AMBIGUOUS' });
    }
    return result(true, 'explicit artifact selection accepted', {
        artifact: matches[0], selection: Object.assign({}, selection)
    });
}

/**
 * Execute the server admission phase only after the programmer has supplied
 * every placement choice.  The server owns the approval intent and all gate
 * results; callers must not manufacture an E-GT or a human_authorized flag.
 */
async function admitUploadPhaseTwo(upload, choices, approvalIntent, fetchImpl) {
    choices = choices || {};
    const required = ['revision', 'destination_slot', 'replace', 'resident', 'boot'];
    if (!approvalIntent || required.some(key => choices[key] === undefined) ||
            !required.slice(2).every(key => typeof choices[key] === 'boolean')) {
        return result(false,
            'explicit revision, destination, replace, resident, and boot choices are required',
            { code: 'EXPLICIT_SELECTION_REQUIRED' });
    }
    const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetcher) return result(false, 'admission transport is unavailable',
        { code: 'ADMISSION_TRANSPORT_UNAVAILABLE' });
    const body = Object.assign({}, choices, {
        token: upload && upload.token,
        binary_hash: upload && upload.binary_hash,
        approval_intent: approvalIntent,
        requested_capabilities: upload && upload.requested_capabilities,
        granted_capabilities: upload && upload.granted_capabilities,
        approved_capabilities: upload && upload.approved_capabilities,
        name: upload && upload.name
    });
    const response = await fetcher('/api/lumps/admit-upload', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data.ok || !data.mint_egt)
        return result(false, data.error || 'server admission was rejected',
            { code: 'ADMISSION_REJECTED', gates: data.gates || null });
    return result(true, 'upload admitted; Mint E-GT issued', data);
}

function freshnessWarning(selected, latest) {
    if (!selected || !latest || String(selected) === String(latest)) return null;
    return {
        warning: true,
        executionVeto: false,
        message: 'Selected artifact is not the latest compiled revision; execution uses the exact selected bytes.',
        selected: selected,
        latest: latest
    };
}

const api = { GATES, admitUpload, admitUploadPhaseTwo, trustedCompilerOutput, chooseArtifact, freshnessWarning };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.LumpAdmission = api;