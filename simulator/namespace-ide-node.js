/* Explicit project configuration; never writes Namespace rows or editor drafts. */
(function () {
    'use strict';
    const form = document.getElementById('namespaceIdeNodeForm');
    if (!form) return;
    const input = document.getElementById('namespaceIdeNodeInput');
    const save = document.getElementById('namespaceIdeNodeSave');
    const reload = document.getElementById('namespaceIdeNodeReload');
    const status = document.getElementById('namespaceIdeNodeStatus');
    let config, busy = false;
    function hasPending() {
        return config !== undefined && input.value.trim() !== (config && config.node || '');
    }
    function controls() {
        input.disabled = busy || config === undefined;
        reload.disabled = busy;
        save.disabled = input.disabled || !input.value.trim() || input.value.trim() === (config && config.node);
    }
    async function request(options) {
        const response = await fetch('/api/ide-hierarchy', {cache:'no-store', ...options});
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'IDE node request failed.');
        return data;
    }
    async function load() {
        busy = true; controls();
        try {
            config = await request();
            input.value = config && config.node || '';
            status.textContent = config ? 'Current saved node: ' + config.node : 'No IDE node configured.';
        } catch (error) {
            config = undefined;
            status.textContent = 'Could not load the IDE node: ' + error.message + ' Use Reload setting to retry.';
        } finally { busy = false; controls(); }
    }
    input.addEventListener('input', () => {
        controls();
        status.textContent = hasPending()
            ? 'Unsaved IDE node. Save Namespace Design or Save IDE node to apply it.'
            : 'Current saved node: ' + (config && config.node || '(unset)');
    });
    reload.addEventListener('click', () => {
        if (config !== undefined && input.value !== (config && config.node || '') &&
            !window.confirm('Discard the unsaved IDE node edit and reload?')) return;
        load();
    });
    async function savePending() {
        if (busy || config === undefined) {
            status.textContent = 'IDE node is not ready. Reload the setting before saving the design.';
            return false;
        }
        if (!hasPending()) return true;
        const node = input.value.trim();
        if (!node) {
            status.textContent = 'IDE node cannot be empty. Nothing was saved.';
            return false;
        }
        const aliases = Object.entries(config && config.aliases || {})
            .filter(([, target]) => target.slice(0, target.lastIndexOf('.')) === config.node)
            .map(([alias, target]) => alias + ': ' + target + ' → ' + node + target.slice(target.lastIndexOf('.')));
        if (!window.confirm('Change IDE node from ' + (config && config.node || '(unset)') + ' to ' + node +
            '?\n\nThis changes future ownership checks.' +
            (aliases.length ? '\nLocal alias changes:\n' + aliases.join('\n') : '') +
            '\n\nSaved LUMPs, source drafts and the installed Namespace will not change.')) {
            status.textContent = 'Save cancelled. The IDE node edit is still unsaved.';
            return false;
        }
        busy = true; controls();
        try {
            config = await request({method:'PUT',
                headers:{'Content-Type':'application/json','X-Requested-With':'NamespaceDesign'},
                body:JSON.stringify({node, expected:config, confirmed:true})});
            input.value = config.node;
            status.textContent = 'Saved IDE node: ' + config.node + '. Recompile to apply the new ownership setting. No LUMPs or Namespace rows changed.';
            return true;
        } catch (error) {
            status.textContent = 'Save was not confirmed: ' + error.message + ' Reload the setting before retrying.';
            return false;
        } finally { busy = false; controls(); }
    }
    window.NamespaceIdeNode = {savePending, hasPending};
    form.addEventListener('submit', async event => {
        event.preventDefault();
        return savePending();
    });
    if (window.addEventListener) window.addEventListener('beforeunload', event => {
        if (hasPending() || busy) { event.preventDefault(); event.returnValue = ''; }
    });
    load();
})();
