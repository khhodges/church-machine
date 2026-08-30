// Shared popup lifecycle and accessibility support.
// Existing popup-specific open/close functions remain authoritative; this layer
// supplies consistent semantics, focus containment/restoration, and Escape.
(function () {
    'use strict';

    var lastFocus = new WeakMap();
    var state = new WeakMap();
    var sequence = 0;
    var popoverPairs = [
        ['stepSettingsPopover', 'toolBreakBtn', 'dialog', 'Step settings'],
        ['runPopover', 'btnRunSim', 'dialog', 'Run settings'],
        ['helpDropdown', 'helpMenuBtn', 'menu', 'Help and guides'],
    ];

    function visible(el) {
        if (!el || !el.isConnected) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : el.style;
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function focusables(root) {
        return Array.prototype.filter.call(root.querySelectorAll(
            'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),' +
            'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ), visible);
    }

    function titleFor(dialog) {
        return dialog.querySelector(
            '[data-popup-title],h1,h2,h3,.modal-title,.dialog-title,.step-settings-title,' +
            '.run-popover-title,.help-dropdown-title'
        );
    }

    function enhanceModal(overlay) {
        if (!overlay || overlay.dataset.popupEnhanced === 'true') return;
        overlay.dataset.popupEnhanced = 'true';
        overlay.setAttribute('role', 'presentation');
        var dialog = overlay.querySelector(
            ':scope > .modal-dialog,:scope > [class*="-dialog"],:scope > [class*="-modal"],:scope > div'
        );
        if (!dialog) return;
        dialog.setAttribute('role', dialog.getAttribute('role') || 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('tabindex', dialog.getAttribute('tabindex') || '-1');
        var title = titleFor(dialog);
        if (title) {
            if (!title.id) title.id = 'popup-title-' + (++sequence);
            dialog.setAttribute('aria-labelledby', title.id);
        } else if (!dialog.getAttribute('aria-label')) {
            dialog.setAttribute('aria-label', 'Dialog');
        }
        Array.prototype.forEach.call(dialog.querySelectorAll(
            'button[title="Close"],button[title^="Close "],button[title="Dismiss"],' +
            '.modal-close,.step-settings-close,.run-close-btn,.break-close-btn'
        ), function (button) {
            if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Close dialog');
        });
        syncModal(overlay);
    }

    function syncModal(overlay) {
        var isOpen = visible(overlay);
        var prior = state.get(overlay) || false;
        state.set(overlay, isOpen);
        if (isOpen && !prior) {
            var active = document.activeElement;
            if (active && active !== document.body && !overlay.contains(active)) lastFocus.set(overlay, active);
            window.setTimeout(function () {
                if (!visible(overlay) || overlay.contains(document.activeElement)) return;
                var controls = focusables(overlay);
                (controls[0] || overlay.querySelector('[role="dialog"]') || overlay).focus();
            }, 0);
        } else if (!isOpen && prior) {
            var trigger = lastFocus.get(overlay);
            if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
        }
    }

    function enhancePopover(popover, trigger, role, label) {
        if (!popover || !trigger) return;
        popover.setAttribute('role', role);
        popover.setAttribute('aria-label', popover.getAttribute('aria-label') || label);
        trigger.setAttribute('aria-haspopup', role === 'menu' ? 'menu' : 'dialog');
        trigger.setAttribute('aria-controls', popover.id);
        if (!trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
        if (role === 'menu') {
            Array.prototype.forEach.call(popover.querySelectorAll('button,a'), function (item) {
                item.setAttribute('role', 'menuitem');
            });
        }
        syncPopover(popover, trigger);
    }

    function syncPopover(popover, trigger) {
        if (!popover || !trigger) return;
        var open = visible(popover);
        var prior = state.get(popover) || false;
        state.set(popover, open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && !prior) lastFocus.set(popover, trigger);
        if (!open && prior && popover.contains(document.activeElement)) trigger.focus();
    }

    function enhanceAll() {
        Array.prototype.forEach.call(document.querySelectorAll('.modal-overlay'), enhanceModal);
        popoverPairs.forEach(function (pair) {
            enhancePopover(document.getElementById(pair[0]), document.getElementById(pair[1]), pair[2], pair[3]);
        });
    }

    function topModal() {
        var open = Array.prototype.filter.call(document.querySelectorAll('.modal-overlay'), visible);
        return open.length ? open[open.length - 1] : null;
    }

    function closeControl(root) {
        var buttons = focusables(root);
        for (var i = 0; i < buttons.length; i++) {
            var text = [
                buttons[i].getAttribute('aria-label') || '',
                buttons[i].getAttribute('title') || '',
                buttons[i].textContent || ''
            ].join(' ').trim();
            if (/^(close|cancel|dismiss|got it|not now)\b/i.test(text) || /\bclose dialog\b/i.test(text)) {
                return buttons[i];
            }
        }
        return null;
    }

    document.addEventListener('keydown', function (event) {
        var modal = topModal();
        if (modal) {
            if (event.key === 'Escape') {
                var close = closeControl(modal);
                if (close) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    close.click();
                }
                return;
            }
            if (event.key === 'Tab') {
                var items = focusables(modal);
                if (!items.length) {
                    event.preventDefault();
                    (modal.querySelector('[role="dialog"]') || modal).focus();
                    return;
                }
                var first = items[0], last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
            return;
        }

        if (event.key !== 'Escape') return;
        for (var i = 0; i < popoverPairs.length; i++) {
            var pair = popoverPairs[i];
            var popover = document.getElementById(pair[0]);
            if (!visible(popover)) continue;
            var close = closeControl(popover);
            if (close) close.click();
            else {
                popover.style.display = 'none';
                var trigger = document.getElementById(pair[1]);
                if (trigger) trigger.focus();
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            break;
        }
    }, true);

    function start() {
        enhanceAll();
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(enhanceAll).observe(document.body, {
                childList: true, subtree: true, attributes: true,
                attributeFilter: ['style', 'class', 'hidden']
            });
        }
    }

    window._popupLifecycleEnhanceAll = enhanceAll;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}());