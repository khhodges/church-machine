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
    function issueKey(item) {
        // Changed evidence must return to the queue, not inherit an old dismissal.
        return JSON.stringify([item.name, item.category, item.detail, item.evidence]);
    }
    function ignoreStore(prof) {
        return 'church.namespace.attention.ignored.v1.' + prof;
    }
    function renderReport(body, data) {
        body.replaceChildren();
        const scope = el('details');
        scope.appendChild(el('summary', 'About this check'));
        scope.appendChild(el('p', data.scope || 'Scope unspecified'));
        body.appendChild(scope);
        body.appendChild(el('p', 'Checked: ' + (data.checkedAt || 'unknown time') +
            ' · Profile: ' + (data.profile || 'unknown')));
        const items = Array.isArray(data.items) ? data.items : [];
        let ignored = new Set();
        const storageKey = ignoreStore(data.profile || profile());
        const notice = el('p', '', {role:'status'});
        try {
            const saved = JSON.parse(root.localStorage.getItem(storageKey) || '[]');
            if (!Array.isArray(saved) || !saved.every(k => typeof k === 'string')) throw Error('Invalid saved choices');
            ignored = new Set(saved);
        } catch (_) {
            notice.textContent = 'Saved ignore choices could not be read. All issues are shown.';
        }
        body.appendChild(notice);
        if (!items.length) {
            body.appendChild(el('p', 'No flagged issues were found. This does not certify the Namespace as ready to execute.', {role: 'status'}));
            return;
        }
        const pending = items.filter(item => !ignored.has(issueKey(item)));
        const deferred = items.filter(item => ignored.has(issueKey(item)));
        body.appendChild(el('h4', 'Next build — ' + pending.length + ' to review'));
        body.appendChild(el('p', 'Work from the top. Ignore for now only hides an issue in this browser; it does not fix it or waive build checks.'));
        const queue = el('ol', null, {'data-attention-queue':'1'});
        const postponed = el('details', null, {'data-attention-ignored':'1'});
        postponed.appendChild(el('summary', 'Ignored for now (' + deferred.length + ')'));
        const ignoredList = el('ul');
        function appendItem(item, list, isIgnored) {
            const li = el('li');
            li.style.marginBottom = '10px';
            const row = el('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap';
            const details = el('details', null, {'data-attention-item':item.name || ''});
            details.style.cssText = 'flex:1;min-width:180px';
            const summary = el('summary');
            summary.style.cursor = 'pointer';
            summary.appendChild(el('strong', item.name || '(unnamed)'));
            summary.appendChild(el('small', ' — ' + (item.category || 'Inspection warning')));
            details.appendChild(summary);
            const detail = el('div', item.detail || '');
            detail.style.whiteSpace = 'pre-wrap';
            details.appendChild(detail);
            if (item.evidence != null && item.evidence !== '') {
                details.appendChild(el('small', 'Evidence: ' + (typeof item.evidence === 'string'
                    ? item.evidence : JSON.stringify(item.evidence))));
            }
            row.appendChild(details);
            const label = el('label');
            label.style.cssText = 'white-space:nowrap;cursor:pointer';
            const checkbox = el('input', null, {type:'checkbox',
                'aria-label':'Ignore for now: ' + (item.name || 'unnamed issue')});
            checkbox.checked = isIgnored;
            checkbox.onchange = () => {
                const key = issueKey(item);
                const next = new Set(ignored);
                if (checkbox.checked) next.add(key); else next.delete(key);
                try {
                    root.localStorage.setItem(storageKey, JSON.stringify([...next]));
                } catch (_) {
                    checkbox.checked = isIgnored;
                    notice.textContent = 'Could not save the ignore choice in this browser. The issue has not moved.';
                    return;
                }
                renderReport(body, data);
                // Keep keyboard users in the refreshed queue instead of losing focus.
                body.setAttribute('tabindex', '-1');
                body.focus();
            };
            label.appendChild(checkbox);
            label.appendChild(el('span', ' Ignore for now'));
            row.appendChild(label);
            li.appendChild(row);
            list.appendChild(li);
        }
        GROUPS.forEach(([key, label]) => {
            pending.filter(item => groupOf(item.category) === key)
                .forEach(item => appendItem(item, queue, false));
            deferred.filter(item => groupOf(item.category) === key)
                .forEach(item => appendItem(item, ignoredList, true));
        });
        body.appendChild(queue);
        if (!pending.length) body.appendChild(el('p',
            'All current issues are ignored for now, not resolved. Expand the ignored list to restore them.'));
        postponed.appendChild(ignoredList);
        body.appendChild(postponed);
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
        dialog.appendChild(el('p', 'Namespace and hardware unchanged. Ignore choices are saved only in this browser.'));
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
