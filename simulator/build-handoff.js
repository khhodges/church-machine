(function () {
    'use strict';
    // Handoff applies to the displayed immutable binary, never the working draft.
    window.renderBuildHandoff = function (panel, lump, token, verified) {
        var document = panel.ownerDocument;
        var section = document.createElement('div');
        section.className = 'saved-lump-handoff';
        function row(label, value) {
            var element = document.createElement('div');
            element.className = 'saved-lump-identity-row';
            var title = document.createElement('span');
            title.textContent = label;
            var text = document.createElement('code');
            text.textContent = value;
            element.append(title, text);
            section.append(element);
            return text;
        }
        var version = row('Saved version', 'unavailable');
        var date = row('Date (compiled, UTC)', 'unavailable');
        var label = document.createElement('label');
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = true;
        checkbox.dataset.testid = 'released-to-builder';
        label.append(checkbox, document.createTextNode(' Released to build handoff'));
        section.append(label);
        var status = document.createElement('div');
        status.className = 'saved-lump-identity-note';
        status.setAttribute('role', 'status');
        status.textContent = 'Saved artifact identity required. Not a Builder configuration approval.';
        section.append(status);
        panel.append(section);
        var live = function () {
            return section.isConnected && panel.contains(section) &&
                window._savedLumpEditorMode && !window._compiledCandidateEditorMode;
        };
        if (!verified || !lump || !lump.filename || !lump.binary_hash ||
                !window._savedLumpEditorMode || window._compiledCandidateEditorMode) return;
        var locator = {token: String(token || '').replace(/^0x/i, '').toLowerCase().padStart(8, '0'),
            filename: lump.filename, binary_hash: lump.binary_hash};
        var current = null;
        var csrf = null;
        function matches(identity) {
            return identity && identity.token === locator.token &&
                identity.filename === locator.filename && identity.binary_hash === locator.binary_hash &&
                Number.isInteger(identity.lump_version) && identity.lump_version > 0;
        }
        function present(data) {
            if (!matches(data.identity) || !data.handoff ||
                    typeof data.handoff.released !== 'boolean' ||
                    !Number.isInteger(data.handoff.revision)) {
                throw new Error('Handoff response does not match this saved artifact.');
            }
            current = data;
            if (data.csrf) csrf = data.csrf;
            version.textContent = 'v' + data.identity.lump_version;
            date.textContent = data.identity.compiled_at || 'unavailable in saved metadata';
            checkbox.checked = data.handoff.released;
            checkbox.disabled = !csrf || (!data.identity.eligible && !data.handoff.released);
            status.textContent = (data.handoff.released ? 'Released' : 'Not released') +
                (data.handoff.updated_at ? ' — recorded ' + data.handoff.updated_at : '') +
                '. Applies only to this saved version and binary seal, not unsaved edits. ' +
                'Not a Builder configuration approval.' +
                (!data.identity.eligible ? ' Release unavailable: saved binary verification or approval failed.' : '');
        }
        async function json(response) {
            var data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Handoff request failed (HTTP ' + response.status + ').');
            return data;
        }
        status.textContent = 'Loading saved version, date and handoff status…';
        window.fetch('/api/build-handoff?' + new URLSearchParams(locator), {cache: 'no-store'})
            .then(json).then(function (data) {
                if (live()) present(data);
            }).catch(function (error) {
                if (live()) status.textContent = 'Handoff unavailable: ' + error.message;
            });
        checkbox.addEventListener('change', async function () {
            if (!current || !live()) return;
            var desired = checkbox.checked;
            // Do not show success optimistically; only the server receipt changes state.
            checkbox.checked = current.handoff.released;
            checkbox.disabled = true;
            status.textContent = 'Recording handoff decision…';
            try {
                var response = await window.fetch('/api/build-handoff', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json',
                        'X-Build-Handoff-CSRF': csrf,
                        'If-Match': String(current.handoff.revision)},
                    body: JSON.stringify(Object.assign({}, locator, {
                        lump_version: current.identity.lump_version, released: desired
                    }))
                });
                var result = await json(response);
                if (result.committed !== true) throw new Error('Handoff was not confirmed.');
                if (live()) present(result);
            } catch (error) {
                if (live()) {
                    // A lost response may follow a commit. Do not claim either outcome.
                    checkbox.checked = false;
                    checkbox.indeterminate = true;
                    checkbox.disabled = true;
                    status.textContent = 'Handoff status needs reloading: ' + error.message +
                        ' Reopen this saved artifact to check the recorded status.';
                }
            }
        });
    };
})();