/* Read-only "Needs attention" report for the saved Namespace. Never saves, binds or activates. */
(function(root) {
    'use strict';
    const GROUPS = [
        ['unfinished', 'Unfinished implementation'],
        ['missing', 'Missing resource'],
        ['inspection', 'Inspection warning'],
    ];
    function profile() {
        const d = root.NamespaceDesignV1;
        if (d && d.state && d.state.active) {
            return ['ascending', 'phase1'].includes(d.state.profile) ? d.state.profile : 'ascending';
        }
        return 'legacy';
    }
    function dirty() {
        const d = root.NamespaceDesignV1;
        return !!((d && d.state && d.state.active && d.state.dirty) || root._nsTableDirty);
    }
    function groupOf(category) {
        const c = String(category || '').toLowerCase();
        if (c.includes('unfinished')) return 'unfinished';
        if (c.includes('missing')) return 'missing';
        return 'inspection';
    }
    function el(tag, text, attrs) {
        const n = document.createElement(tag);
        if (text != null) n.textContent = String(text);
        if (attrs) Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
        return n;
    }
    function renderReport(body, data) {
        body.replaceChildren();
        body.appendChild(el('p', 'Scope: ' + (data.scope || 'unspecified')));
        body.appendChild(el('p', 'Checked: ' + (data.checkedAt || 'unknown time') +
            ' · Profile: ' + (data.profile || 'unknown')));
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
            body.appendChild(el('p', 'No flagged issues were found. This does not certify the Namespace as ready to execute.', {role: 'status'}));
            return;
        }
        GROUPS.forEach(([key, label]) => {
            const list = items.filter(i => groupOf(i && i.category) === key);
            if (!list.length) return;
            const section = el(key === 'inspection' ? 'details' : 'section', null, {'data-attention-group': key});
            section.appendChild(el(key === 'inspection' ? 'summary' : 'h4', label + ' (' + list.length + ')'));
            const ul = el('ul');
            list.forEach(item => {
                const li = el('li');
                li.appendChild(el('strong', item.name || '(unnamed)'));
                const detail = el('div', item.detail || '');
                detail.style.whiteSpace = 'pre-wrap';
                li.appendChild(detail);
                if (item.evidence != null && item.evidence !== '') {
                    li.appendChild(el('small', 'Evidence: ' + (typeof item.evidence === 'string'
                        ? item.evidence : JSON.stringify(item.evidence))));
                }
                ul.appendChild(li);
            });
            section.appendChild(ul);
            body.appendChild(section);
        });
    }
    let requestId = 0;
    async function load(dialog, body) {
        const id = ++requestId;
        const prof = profile();
        body.replaceChildren(el('p', 'Checking saved Namespace (' + prof + ')…', {role: 'status'}));
        try {
            const response = await fetch('/api/namespace/attention?profile=' + encodeURIComponent(prof),
                {cache: 'no-store', credentials: 'include'});
            let data = null;
            try { data = await response.json(); } catch (_) { data = null; }
            if (id !== requestId || !dialog.open) return;
            if (!response.ok || !data || data.ok !== true) {
                throw new Error((data && data.error) || ('Request failed (' + response.status + ')'));
            }
            renderReport(body, data);
        } catch (error) {
            if (id !== requestId || !dialog.open) return;
            body.replaceChildren(el('p', 'Attention report unavailable: ' +
                (error && error.message || String(error)), {role: 'alert'}));
            const retry = el('button', 'Retry', {type: 'button', class: 'btn'});
            retry.onclick = () => load(dialog, body);
            body.appendChild(retry);
        }
    }
    function open() {
        const old = document.getElementById('namespaceAttentionDialog');
        if (old) { try { old.close(); } catch (_) {} old.remove(); }
        const dialog = el('dialog', null, {id: 'namespaceAttentionDialog', 'aria-labelledby': 'namespaceAttentionTitle'});
        dialog.style.cssText = 'background:#12121f;color:#ddd;padding:24px;max-width:620px;width:100%;max-height:85vh;overflow:auto;border:1px solid #777;border-radius:6px';
        dialog.appendChild(el('h3', 'Needs attention', {id: 'namespaceAttentionTitle'}));
        dialog.appendChild(el('p', 'Read-only. Nothing is saved, bound or activated.'));
        if (dirty()) dialog.appendChild(el('p',
            'You have unsaved Namespace edits. This report covers the saved Namespace, not your unsaved changes.',
            {role: 'note', 'data-attention-dirty': '1'}));
        const body = el('div', null, {'aria-live': 'polite'});
        dialog.appendChild(body);
        const close = el('button', 'Close', {type: 'button', class: 'btn'});
        close.onclick = () => dialog.close();
        dialog.appendChild(close);
        dialog.addEventListener('close', () => { requestId++; dialog.remove(); });
        document.body.appendChild(dialog);
        dialog.showModal();
        close.focus();
        load(dialog, body);
        return dialog;
    }
    root.NamespaceAttention = {open, profile, groupOf, renderReport};
})(typeof window !== 'undefined' ? window : globalThis);
