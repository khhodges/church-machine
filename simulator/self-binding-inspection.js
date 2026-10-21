/* Exact report bytes only. Never resolve a saved revision through a name. */
(function(root) {
    'use strict';
    root._openBoundLumpInspection = function(list, original) {
        const words = original ? list.sourceWords : list.boundWords;
        if (!Array.isArray(words) || !words.length) throw Error('Exact binding bytes unavailable; bind again.');
        const e = root._fmtEscape;
        const cc = words[0] & 255;
        let html = '<h3>' + (original ? 'Original saved revision — not bound' : 'Exact bound derivative — not installed or running') + '</h3>' +
            '<p>Status: ' + e(list.status) + ' · Owner NS[' + e(list.slot) + '] · generation ' + e(list.sequence) + '</p>' +
            '<p style="overflow-wrap:anywhere">Namespace fingerprint: ' + e(list.namespaceFingerprint) +
            '<br>Source SHA-256: ' + e(list.sourceHash) + '<br>Bound SHA-256: ' + e(list.derivativeHash) + '</p>' +
            '<button type="button" id="selfBindingToggle">' + (original ? 'Show exact bound derivative' : 'Show original saved revision') + '</button>';
        html += root._renderSavedLumpIdentity({
            filename:list.filename, binary_hash:original ? list.sourceHash : list.derivativeHash,
            boundPreview: original ? null : list
        }, words, 'binding inspection');
        html += '<h4>Full hex — same bytes as C-list and GT decode</h4><table class="lump-hex-table"><tbody>';
        words.forEach((word, i) => {
            if (i % 4 === 0) html += '<tr><th>' + (i * 4).toString(16).padStart(6, '0') + '</th>';
            const hex = '0x' + (word >>> 0).toString(16).padStart(8, '0').toUpperCase();
            html += '<td>' + (i >= words.length - cc ? root._savedGtButton(word, i - words.length + cc, hex) : hex) + '</td>';
            if (i % 4 === 3) html += '</tr>';
        });
        root._showLumpHistoryPreviewModal('binding inspection', html + '</tbody></table>');
        document.getElementById('lumpHistoryPreviewModal').dataset.bindingInspection = 'true';
        document.getElementById('selfBindingToggle').onclick = () => root._openBoundLumpInspection(list, !original);
    };
})(typeof window !== 'undefined' ? window : globalThis);
