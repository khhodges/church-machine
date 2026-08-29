'use strict';

// DOM-level regression coverage for the configuration reference-image viewer.
// Keep this independent from the full IDE boot so the interaction contract is
// tested quickly and without network or simulator state.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`<!doctype html><body>
    <section class="ti60-config-gallery">
        <figure class="ti60-config-image-card" tabindex="0" role="button"
                data-gallery-description="The first explanation.">
            <img src="/first.png" alt="First image">
            <figcaption>First reference</figcaption>
        </figure>
        <figure class="ti60-config-image-card" tabindex="0" role="button"
                data-gallery-description="The second explanation.">
            <img src="/second.png" alt="Second image">
            <figcaption>Second reference</figcaption>
        </figure>
    </section>
    <figure class="ti60-board-photo-card" tabindex="0" role="button"
            data-gallery-description="The board explanation.">
        <img src="/board.jpg" alt="Board photo">
        <figcaption><strong>Board under test</strong><span>Physical unit</span></figcaption>
    </figure>
</body>`, { url: 'http://localhost/simulator/' });

const sandbox = {
    document: dom.window.document,
    window: dom.window,
    console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/app-image-gallery.js', 'utf8'), sandbox);

const cards = dom.window.document.querySelectorAll(
    '.ti60-config-image-card, .ti60-board-photo-card');
const first = cards[0];
const second = cards[1];
const board = cards[2];

first.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const modal = dom.window.document.querySelector('.ti60-image-viewer');
assert(modal && modal.classList.contains('is-open'),
    'clicking a reference image opens the full-size viewer');
assert.strictEqual(
    modal.querySelector('#ti60ImageViewerTitle').textContent,
    'First reference',
    'viewer shows the selected image title');
assert.strictEqual(
    modal.querySelector('#ti60ImageViewerDescription').textContent,
    'The first explanation.',
    'viewer shows the selected image explanation');
assert.strictEqual(
    modal.querySelector('.ti60-image-viewer-position').textContent,
    '1 of 3',
    'viewer reports the position in the combined reference gallery');

modal.querySelector('.ti60-image-viewer-next').click();
assert.strictEqual(
    modal.querySelector('#ti60ImageViewerTitle').textContent,
    'Second reference',
    'next control opens the next reference image');

modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.strictEqual(
    modal.querySelector('#ti60ImageViewerTitle').textContent,
    'Board under test',
    'right arrow advances through the board photo too');

modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
assert(modal.hidden && !modal.classList.contains('is-open'),
    'Escape closes the viewer');
assert.strictEqual(dom.window.document.activeElement, first,
    'closing returns keyboard focus to the image card that opened it');

board.focus();
board.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert.strictEqual(
    modal.querySelector('#ti60ImageViewerDescription').textContent,
    'The board explanation.',
    'keyboard activation opens the board image with its explanation');

console.log('image gallery viewer tests passed');