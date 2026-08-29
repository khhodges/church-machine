(function () {
    'use strict';

    var CARD_SELECTOR = '.ti60-config-image-card, .ti60-board-photo-card';
    var modal = null;
    var modalImage = null;
    var modalTitle = null;
    var modalDescription = null;
    var modalPosition = null;
    var previousButton = null;
    var nextButton = null;
    var closeButton = null;
    var items = [];
    var activeIndex = -1;
    var returnFocus = null;
    var previousBodyOverflow = '';

    function collectItems() {
        return Array.prototype.map.call(document.querySelectorAll(CARD_SELECTOR), function (card) {
            var image = card.querySelector('img');
            if (!image) return null;
            var caption = card.querySelector('figcaption');
            var captionTitle = caption && caption.querySelector('strong');
            var title = captionTitle
                ? captionTitle.textContent.trim()
                : (caption ? caption.textContent.trim() : image.alt);
            return {
                card: card,
                image: image,
                title: title || 'Reference image',
                description: card.getAttribute('data-gallery-description') || image.alt || ''
            };
        }).filter(Boolean);
    }

    function ensureModal() {
        if (modal) return;

        modal = document.createElement('div');
        modal.className = 'ti60-image-viewer';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'ti60ImageViewerTitle');
        modal.setAttribute('aria-describedby', 'ti60ImageViewerDescription');
        modal.hidden = true;
        modal.innerHTML =
            '<div class="ti60-image-viewer-dialog">' +
                '<div class="ti60-image-viewer-toolbar">' +
                    '<div>' +
                        '<div class="ti60-image-viewer-kicker">REFERENCE IMAGE</div>' +
                        '<h2 id="ti60ImageViewerTitle"></h2>' +
                    '</div>' +
                    '<button type="button" class="ti60-image-viewer-close" aria-label="Close image viewer">&times;</button>' +
                '</div>' +
                '<div class="ti60-image-viewer-content">' +
                    '<div class="ti60-image-viewer-stage">' +
                        '<button type="button" class="ti60-image-viewer-nav ti60-image-viewer-prev" aria-label="Previous image">&lsaquo;</button>' +
                        '<img class="ti60-image-viewer-image" alt="">' +
                        '<button type="button" class="ti60-image-viewer-nav ti60-image-viewer-next" aria-label="Next image">&rsaquo;</button>' +
                    '</div>' +
                    '<aside class="ti60-image-viewer-copy">' +
                        '<p id="ti60ImageViewerDescription"></p>' +
                        '<div class="ti60-image-viewer-position"></div>' +
                        '<p class="ti60-image-viewer-hint">Use the arrow keys to browse. Press Escape to close.</p>' +
                    '</aside>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        modalImage = modal.querySelector('.ti60-image-viewer-image');
        modalTitle = modal.querySelector('#ti60ImageViewerTitle');
        modalDescription = modal.querySelector('#ti60ImageViewerDescription');
        modalPosition = modal.querySelector('.ti60-image-viewer-position');
        previousButton = modal.querySelector('.ti60-image-viewer-prev');
        nextButton = modal.querySelector('.ti60-image-viewer-next');
        closeButton = modal.querySelector('.ti60-image-viewer-close');

        closeButton.addEventListener('click', close);
        previousButton.addEventListener('click', function () { move(-1); });
        nextButton.addEventListener('click', function () { move(1); });
        modal.addEventListener('click', function (event) {
            if (event.target === modal) close();
        });
    }

    function render() {
        var item = items[activeIndex];
        if (!item) return;
        modalImage.src = item.image.currentSrc || item.image.src;
        modalImage.alt = item.image.alt || item.title;
        modalTitle.textContent = item.title;
        modalDescription.textContent = item.description;
        modalPosition.textContent = (activeIndex + 1) + ' of ' + items.length;
        previousButton.disabled = items.length < 2;
        nextButton.disabled = items.length < 2;
    }

    function open(card) {
        ensureModal();
        items = collectItems();
        activeIndex = items.findIndex(function (item) { return item.card === card; });
        if (activeIndex < 0) return;
        returnFocus = card;
        render();
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        modal.hidden = false;
        modal.classList.add('is-open');
        closeButton.focus();
    }

    function close() {
        if (!modal || modal.hidden) return;
        modal.classList.remove('is-open');
        modal.hidden = true;
        document.body.style.overflow = previousBodyOverflow;
        if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
        returnFocus = null;
    }

    function move(delta) {
        if (!items.length) return;
        activeIndex = (activeIndex + delta + items.length) % items.length;
        render();
    }

    document.addEventListener('click', function (event) {
        var card = event.target.closest && event.target.closest(CARD_SELECTOR);
        if (card) open(card);
    });

    document.addEventListener('keydown', function (event) {
        var card = event.target.closest && event.target.closest(CARD_SELECTOR);
        if (card && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            open(card);
            return;
        }
        if (!modal || modal.hidden) return;
        if (event.key === 'Escape') close();
        else if (event.key === 'ArrowLeft') move(-1);
        else if (event.key === 'ArrowRight') move(1);
    });

    // Useful for the existing inline UI and small DOM-level regression tests.
    window.openReferenceImage = function (card) {
        open(typeof card === 'string' ? document.querySelector(card) : card);
    };
    window.closeReferenceImage = close;
}());