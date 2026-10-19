(function () {
    'use strict';
    // Read-only saved revision metadata. There is no release checkbox or state.
    window.renderSavedArtifactMetadata = function (panel, lump, token, verified) {
        var document = panel.ownerDocument;
        var section = document.createElement('div');
        section.className = 'saved-artifact-metadata';
        function row(label) {
            var element = document.createElement('div');
            element.className = 'saved-lump-identity-row';
            var title = document.createElement('span');
            title.textContent = label;
            var text = document.createElement('code');
            text.textContent = 'unavailable';
            element.append(title, text);
            section.append(element);
            return text;
        }
        var version = row('History');
        var date = row('Saved at (UTC)');
        panel.append(section);
        var live = function () {
            return section.isConnected && panel.contains(section) &&
                window._savedLumpEditorMode && !window._compiledCandidateEditorMode;
        };
        if (!verified || !lump || !lump.filename || !lump.binary_hash || !live()) return;
        var locator = {token: String(token || '').replace(/^0x/i, '').toLowerCase().padStart(8, '0'),
            filename: lump.filename, binary_hash: lump.binary_hash};
        window.fetch('/api/saved-artifact-metadata?' + new URLSearchParams(locator),
            {cache: 'no-store'}).then(async function (response) {
            var data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Saved metadata could not be read.');
            var identity = data.identity;
            if (!identity || identity.token !== locator.token ||
                    identity.filename !== locator.filename || identity.binary_hash !== locator.binary_hash ||
                    !Number.isInteger(identity.lump_version) || identity.lump_version < 1 ||
                    (Number.isInteger(lump.lump_version) && lump.lump_version !== identity.lump_version))
                throw new Error('Metadata does not match the exact saved artifact.');
            if (!live()) return;
            var receipt = window._editorSavedBinaryReceipt;
            if (window._editorOpenLumpToken === locator.token && receipt &&
                    receipt.token === locator.token && receipt.filename === locator.filename &&
                    receipt.binary_hash === locator.binary_hash) {
                receipt.lump_version = identity.lump_version;
                if (typeof window._refreshEditorActionIdentity === 'function')
                    window._refreshEditorActionIdentity();
            }
            version.textContent = 'View this saved revision';
            if (typeof window._openSavedLumpVersionDetails === 'function') {
                var link = document.createElement('a');
                link.href = '#saved-lump-details';
                link.textContent = version.textContent;
                link.setAttribute('aria-label', 'View LUMP details for saved version ' + identity.lump_version);
                link.addEventListener('click', function (event) {
                    event.preventDefault();
                    if (live()) window._openSavedLumpVersionDetails(Object.assign({}, identity), link);
                });
                version.textContent = '';
                version.append(link);
            }
            date.textContent = identity.compiled_at || 'unavailable in saved metadata';
        }).catch(function (error) {
            if (!live()) return;
            var note = document.createElement('div');
            note.className = 'saved-lump-identity-note';
            note.setAttribute('role', 'alert');
            note.textContent = 'Saved metadata unavailable: ' + error.message +
                ' No data changed. Reopen this saved artifact to retry.';
            section.append(note);
        });
    };
})();
