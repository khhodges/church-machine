/*
 * Discoverable switcher for the editor's language and workspace views.
 *
 * The <select id="langSelector"> remains the authoritative view registry.
 * This module only adds descriptions and interaction around those existing
 * options; it does not maintain a second list of view names.
 */
(function (global) {
    'use strict';

    const DESCRIPTION_BY_VALUE = {
        cloomc: 'Write capability-secured abstractions in the primary CLOOMC++ syntax.',
        english: 'Explore the plain-English CLOOMC++ syntax.',
        symbolic: 'Use Ada-inspired symbolic notation for CLOOMC++.',
        assembly: 'Write raw Church Machine instructions and inspect machine-level behavior.',
        javascript: 'Use JavaScript-like CLOOMC++ examples.',
        haskell: 'Use Haskell-like CLOOMC++ examples.',
        lambda: 'Explore lambda calculus and functional programs.',
        abstraction: 'Plan and browse abstractions in the catalog.',
        personal: 'Open saved personal programs and drafts.'
    };
    const WORKSPACE_VALUES = new Set(['abstraction', 'personal']);

    let _initialized = false;
    let _selectorObserver = null;

    function _get(id) {
        return document.getElementById(id);
    }

    function _getOptions() {
        const selector = _get('langSelector');
        return selector ? Array.from(selector.options) : [];
    }

    function _setCount(count) {
        const label = _get('editorViewSwitcherCount');
        const panelLabel = _get('editorViewSwitcherPanelCount');
        if (label) label.textContent = String(count);
        if (panelLabel) panelLabel.textContent = String(count);
    }

    function _close(restoreFocus) {
        const panel = _get('editorViewSwitcherPanel');
        const toggle = _get('editorViewSwitcherToggle');
        if (!panel || !toggle) return;
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        if (restoreFocus !== false) toggle.focus();
    }

    function _describe(option) {
        return DESCRIPTION_BY_VALUE[option.value] ||
            `Open the ${option.textContent.trim()} editor view.`;
    }

    function _selectView(value) {
        const selector = _get('langSelector');
        if (!selector) return;
        selector.value = value;
        _close();
        // Keep the existing change path responsible for source, draft,
        // compile, and personal-program behavior.
        if (typeof global.onLangChange === 'function') global.onLangChange();
    }

    function _renderEntries() {
        const entries = _get('editorViewSwitcherEntries');
        if (!entries) return;

        const options = _getOptions();
        _setCount(options.length);
        entries.replaceChildren();

        const groups = [
            { label: 'Source languages', options: options.filter(o => !WORKSPACE_VALUES.has(o.value)) },
            { label: 'Workspace views', options: options.filter(o => WORKSPACE_VALUES.has(o.value)) }
        ];
        groups.forEach(group => {
            if (!group.options.length) return;
            const section = document.createElement('section');
            section.className = 'editor-view-switcher-group';
            const heading = document.createElement('h3');
            heading.textContent = group.label;
            section.appendChild(heading);

            group.options.forEach(option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'editor-view-switcher-entry';
                button.dataset.viewValue = option.value;
                button.setAttribute('aria-label', `${option.textContent.trim()}: ${_describe(option)}`);

                const name = document.createElement('span');
                name.className = 'editor-view-switcher-entry-name';
                name.textContent = option.textContent.trim();
                const description = document.createElement('span');
                description.className = 'editor-view-switcher-entry-description';
                description.textContent = _describe(option);
                button.append(name, description);
                button.addEventListener('click', () => _selectView(option.value));
                section.appendChild(button);
            });
            entries.appendChild(section);
        });
    }

    function _open() {
        const panel = _get('editorViewSwitcherPanel');
        const toggle = _get('editorViewSwitcherToggle');
        if (!panel || !toggle) return;
        if (typeof global.closeEditorActions === 'function') {
            global.closeEditorActions();
        }
        _renderEntries();
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        const firstEntry = panel.querySelector('.editor-view-switcher-entry');
        if (firstEntry) firstEntry.focus();
    }

    function _toggle() {
        const panel = _get('editorViewSwitcherPanel');
        if (!panel) return;
        if (panel.hidden) _open();
        else _close();
    }

    function _openSourceLibrary(event) {
        event.preventDefault();
        _close();
        if (typeof global.switchView === 'function') global.switchView('abstractions');
        if (typeof global.switchAbsSubtab === 'function') global.switchAbsSubtab('sources');
    }

    function init() {
        if (_initialized) return;
        const selector = _get('langSelector');
        const toggle = _get('editorViewSwitcherToggle');
        const panel = _get('editorViewSwitcherPanel');
        const sourceLink = _get('editorViewSwitcherSourceLink');
        if (!selector || !toggle || !panel || !sourceLink) return;
        _initialized = true;

        _renderEntries();
        toggle.addEventListener('click', _toggle);
        panel.querySelector('.editor-view-switcher-close')?.addEventListener('click', () => _close());
        sourceLink.addEventListener('click', _openSourceLibrary);
        document.addEventListener('click', event => {
            if (panel.hidden || panel.contains(event.target) || toggle.contains(event.target)) return;
            _close(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) {
                event.preventDefault();
                _close();
            }
        });

        if (typeof MutationObserver === 'function') {
            _selectorObserver = new MutationObserver(() => {
                _setCount(_getOptions().length);
                if (!panel.hidden) _renderEntries();
            });
            _selectorObserver.observe(selector, { childList: true });
        }
    }

    global.EditorViewSwitcher = {
        init,
        open: _open,
        close: _close,
        render: _renderEntries,
        select: _selectView
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(window);