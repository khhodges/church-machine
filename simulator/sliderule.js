const slideruleState = {
    slideOffset: 0,
    cursorX: 0,
    draggingSlide: false,
    draggingCursor: false,
    dragStartX: 0,
    dragStartOffset: 0,
    dragStartCursor: 0,
    result: 1,
    trace: [],
    maxTrace: 50,
    rendered: false,
    scaleWidth: 900,
    scaleStart: 50,
    lastReadD: 1,
    lastReadC: 1,
    scaleMode: 'CD'
};

const SLIDERULE_SCALES = {
    CD: {
        label: 'C / D',
        desc: 'Multiplication & Division',
        fixed: { name: 'D', color: '#cc9933', map: v => Math.log10(v), unmap: x => Math.pow(10, x), range: [1, 10] },
        slide: { name: 'C', color: '#33cc66', map: v => Math.log10(v), unmap: x => Math.pow(10, x), range: [1, 10] },
        readout: (d, c) => `D: ${d}  \u00b7  C: ${c}  \u00b7  D\u00d7C \u2248 ${Math.round(d * c * 1000) / 1000}`
    },
    AB: {
        label: 'A / B',
        desc: 'Squares & Square Roots',
        fixed: { name: 'A', color: '#cc9933', map: v => Math.log10(v) / 2, unmap: x => Math.pow(10, x * 2), range: [1, 100] },
        slide: { name: 'B', color: '#33cc66', map: v => Math.log10(v) / 2, unmap: x => Math.pow(10, x * 2), range: [1, 100] },
        readout: (d, c) => `A: ${d}  \u00b7  B: ${c}  \u00b7  \u221aA \u2248 ${Math.round(Math.sqrt(d) * 1000) / 1000}`
    },
    CI: {
        label: 'C / CI',
        desc: 'Reciprocals (inverted C)',
        fixed: { name: 'C', color: '#cc9933', map: v => Math.log10(v), unmap: x => Math.pow(10, x), range: [1, 10] },
        slide: { name: 'CI', color: '#ff6699', map: v => 1 - Math.log10(v), unmap: x => Math.pow(10, 1 - x), range: [1, 10] },
        readout: (d, c) => `C: ${d}  \u00b7  CI: ${c}  \u00b7  D\u00f7C \u2248 ${Math.round(d / c * 1000) / 1000}`
    },
    K: {
        label: 'D / K',
        desc: 'Cubes & Cube Roots',
        fixed: { name: 'K', color: '#cc9933', map: v => Math.log10(v) / 3, unmap: x => Math.pow(10, x * 3), range: [1, 1000] },
        slide: { name: 'D', color: '#33cc66', map: v => Math.log10(v), unmap: x => Math.pow(10, x), range: [1, 10] },
        readout: (d, c) => `K: ${d}  \u00b7  D: ${c}  \u00b7  \u00b3\u221aK \u2248 ${Math.round(Math.pow(d, 1/3) * 1000) / 1000}`
    },
    ST: {
        label: 'S / T',
        desc: 'Sine & Tangent',
        fixed: { name: 'S', color: '#cc9933', map: v => Math.log10(Math.sin(v * Math.PI / 180) * 10), unmap: x => Math.asin(Math.pow(10, x) / 10) * 180 / Math.PI, range: [5.7, 90] },
        slide: { name: 'T', color: '#66bbff', map: v => Math.log10(Math.tan(v * Math.PI / 180) * 10), unmap: x => Math.atan(Math.pow(10, x) / 10) * 180 / Math.PI, range: [5.7, 45] },
        readout: (d, c) => `S: ${d}\u00b0  \u00b7  sin \u2248 ${Math.round(Math.sin(d * Math.PI / 180) * 10000) / 10000}  \u00b7  T: ${c}\u00b0  \u00b7  tan \u2248 ${Math.round(Math.tan(c * Math.PI / 180) * 10000) / 10000}`
    }
};

function slideruleTraceLog(lambdaExpr, desc) {
    slideruleState.trace.unshift({ lambda: lambdaExpr, desc: desc, time: Date.now() });
    if (slideruleState.trace.length > slideruleState.maxTrace) slideruleState.trace.pop();
}

function slideruleLog10(val) {
    return Math.log10(val);
}

function slideruleValToX(val, offset) {
    offset = offset || 0;
    const mode = SLIDERULE_SCALES[slideruleState.scaleMode];
    const mapped = mode.fixed.map(val);
    return slideruleState.scaleStart + mapped * slideruleState.scaleWidth + offset;
}

function slideruleValToXForScale(val, scaleDef, offset) {
    offset = offset || 0;
    const mapped = scaleDef.map(val);
    return slideruleState.scaleStart + mapped * slideruleState.scaleWidth + offset;
}

function slideruleXToValForScale(x, scaleDef, offset) {
    offset = offset || 0;
    const norm = (x - slideruleState.scaleStart - offset) / slideruleState.scaleWidth;
    return scaleDef.unmap(norm);
}

function slideruleClampVal(v, range) {
    v = Math.max(range[0], Math.min(range[1], v));
    return Math.round(v * 1000) / 1000;
}

function slideruleReadAtCursor() {
    const mode = SLIDERULE_SCALES[slideruleState.scaleMode];
    const cx = slideruleState.cursorX;
    const dVal = slideruleClampVal(slideruleXToValForScale(cx, mode.fixed, 0), mode.fixed.range);
    const cVal = slideruleClampVal(slideruleXToValForScale(cx, mode.slide, -slideruleState.slideOffset), mode.slide.range);
    slideruleState.lastReadD = dVal;
    slideruleState.lastReadC = cVal;
    return { d: dVal, c: cVal };
}

function slideruleGetScaleFactor() {
    const svgEl = document.querySelector('.sliderule-svg');
    if (!svgEl) return 1;
    const rect = svgEl.getBoundingClientRect();
    const totalW = slideruleState.scaleStart * 2 + slideruleState.scaleWidth;
    return totalW / rect.width;
}

function slideruleStartDragSlide(e) {
    e.preventDefault();
    slideruleState.draggingSlide = true;
    slideruleState.dragStartX = e.clientX || e.touches[0].clientX;
    slideruleState.dragStartOffset = slideruleState.slideOffset;
    document.addEventListener('mousemove', slideruleDragMove);
    document.addEventListener('mouseup', slideruleDragEnd);
    document.addEventListener('touchmove', slideruleDragMove, { passive: false });
    document.addEventListener('touchend', slideruleDragEnd);
}

function slideruleStartDragCursor(e) {
    e.preventDefault();
    e.stopPropagation();
    slideruleState.draggingCursor = true;
    slideruleState.dragStartX = e.clientX || e.touches[0].clientX;
    slideruleState.dragStartCursor = slideruleState.cursorX;
    document.addEventListener('mousemove', slideruleDragMove);
    document.addEventListener('mouseup', slideruleDragEnd);
    document.addEventListener('touchmove', slideruleDragMove, { passive: false });
    document.addEventListener('touchend', slideruleDragEnd);
}

function slideruleDragMove(e) {
    e.preventDefault();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    if (clientX === undefined) return;

    const scale = slideruleGetScaleFactor();
    const dx = (clientX - slideruleState.dragStartX) * scale;

    if (slideruleState.draggingSlide) {
        slideruleState.slideOffset = slideruleState.dragStartOffset + dx;
        slideruleState.slideOffset = Math.max(-slideruleState.scaleWidth, Math.min(slideruleState.scaleWidth, slideruleState.slideOffset));
        slideruleUpdateDisplay();
    } else if (slideruleState.draggingCursor) {
        slideruleState.cursorX = slideruleState.dragStartCursor + dx;
        slideruleState.cursorX = Math.max(slideruleState.scaleStart, Math.min(slideruleState.scaleStart + slideruleState.scaleWidth, slideruleState.cursorX));
        slideruleUpdateDisplay();
    }
}

function slideruleDragEnd() {
    if (slideruleState.draggingSlide) {
        const vals = slideruleReadAtCursor();
        slideruleTraceLog(
            `CALL SlideRule.Slide(${slideruleState.scaleMode})`,
            `Slide positioned: ${SLIDERULE_SCALES[slideruleState.scaleMode].fixed.name}=${vals.d}, ${SLIDERULE_SCALES[slideruleState.scaleMode].slide.name}=${vals.c}`
        );
    }
    if (slideruleState.draggingCursor) {
        const vals = slideruleReadAtCursor();
        slideruleTraceLog(
            `CALL SlideRule.Read(cursor)`,
            `Cursor reads: ${SLIDERULE_SCALES[slideruleState.scaleMode].fixed.name}=${vals.d}, ${SLIDERULE_SCALES[slideruleState.scaleMode].slide.name}=${vals.c}`
        );
    }
    slideruleState.draggingSlide = false;
    slideruleState.draggingCursor = false;
    document.removeEventListener('mousemove', slideruleDragMove);
    document.removeEventListener('mouseup', slideruleDragEnd);
    document.removeEventListener('touchmove', slideruleDragMove);
    document.removeEventListener('touchend', slideruleDragEnd);
}

function slideruleSwitchScale(mode) {
    if (!SLIDERULE_SCALES[mode]) return;
    slideruleState.scaleMode = mode;
    slideruleState.slideOffset = 0;
    slideruleState.cursorX = slideruleState.scaleStart + slideruleState.scaleWidth / 2;
    slideruleTraceLog(
        `CALL SlideRule.SetScale("${mode}")`,
        `Switched to ${SLIDERULE_SCALES[mode].label}: ${SLIDERULE_SCALES[mode].desc}`
    );
    slideruleUpdateScaleButtons();
    slideruleUpdateDisplay();
}

function slideruleUpdateScaleButtons() {
    const container = document.getElementById('slideruleContainer');
    if (!container) return;
    const btns = container.querySelectorAll('.sliderule-scale-btn');
    btns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scale === slideruleState.scaleMode);
    });
}

function sliderulePresetMultiply(a, b) {
    if (slideruleState.scaleMode !== 'CD') slideruleSwitchScale('CD');
    const aClamp = Math.max(1, Math.min(10, a));
    const bClamp = Math.max(1, Math.min(10, b));
    const mode = SLIDERULE_SCALES.CD;
    slideruleState.slideOffset = mode.fixed.map(aClamp) * slideruleState.scaleWidth;
    slideruleState.cursorX = slideruleValToXForScale(bClamp, mode.slide, slideruleState.slideOffset);
    slideruleState.cursorX = Math.max(slideruleState.scaleStart, Math.min(slideruleState.scaleStart + slideruleState.scaleWidth, slideruleState.cursorX));
    const result = aClamp * bClamp;
    slideruleTraceLog(
        `CALL SlideRule.Mul(${aClamp}, ${bClamp}) \u2192 ${Math.round(result * 1000) / 1000}`,
        `Multiply: set C-scale 1 at D=${aClamp}, read D at C=${bClamp}`
    );
    slideruleUpdateDisplay();
}

function sliderulePresetSqrt(val) {
    if (slideruleState.scaleMode !== 'CD') slideruleSwitchScale('CD');
    const v = Math.max(1, Math.min(100, val));
    const sqr = Math.sqrt(v);
    slideruleState.slideOffset = 0;
    slideruleState.cursorX = slideruleValToXForScale(sqr, SLIDERULE_SCALES.CD.fixed, 0);
    slideruleTraceLog(
        `CALL SlideRule.Sqrt(${v}) \u2192 ${Math.round(sqr * 1000) / 1000}`,
        `Square root: \u221a${v} \u2248 ${Math.round(sqr * 1000) / 1000}`
    );
    slideruleUpdateDisplay();
}

function slideruleReset() {
    slideruleState.slideOffset = 0;
    slideruleState.cursorX = slideruleState.scaleStart + slideruleState.scaleWidth / 2;
    slideruleTraceLog('CALL SlideRule.Reset()', 'Slide and cursor reset to home position');
    slideruleUpdateDisplay();
}

function slideruleUpdateDisplay() {
    slideruleRenderDisplay();
}

function slideruleGenerateScaleTicksForDef(scaleDef, offset) {
    let ticks = '';
    const range = scaleDef.range;

    let majorVals = [];
    let minorSets = [];

    if (range[1] <= 10) {
        majorVals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        minorSets = [[1.5], [2.5], [3.5], [4.5], [5.5], [6.5], [7.5], [8.5], [9.5]];
    } else if (range[1] <= 100) {
        majorVals = [1, 2, 3, 5, 10, 20, 30, 50, 100];
        minorSets = [[4, 6, 7, 8, 9, 15, 25, 40, 60, 70, 80, 90]];
    } else if (range[1] <= 1000) {
        majorVals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
        minorSets = [[3, 4, 7, 30, 70, 300, 700]];
    } else if (range[0] >= 5) {
        majorVals = [6, 10, 15, 20, 30, 45, 60, 90];
        minorSets = [[7, 8, 9, 12, 25, 35, 50, 70, 80]];
    }

    for (const v of majorVals) {
        if (v < range[0] || v > range[1]) continue;
        const x = slideruleValToXForScale(v, scaleDef, offset);
        if (x < slideruleState.scaleStart - 5 || x > slideruleState.scaleStart + slideruleState.scaleWidth + 5) continue;
        ticks += `<line x1="${x}" y1="0" x2="${x}" y2="20" stroke="#eee" stroke-width="2"/>`;
        let label = v.toString();
        if (v >= 1000) label = '1k';
        ticks += `<text x="${x}" y="32" text-anchor="middle" fill="#fff" font-size="20" font-weight="bold" font-family="monospace">${label}</text>`;
    }

    for (const set of minorSets) {
        for (const v of set) {
            if (v < range[0] || v > range[1]) continue;
            const x = slideruleValToXForScale(v, scaleDef, offset);
            if (x < slideruleState.scaleStart - 5 || x > slideruleState.scaleStart + slideruleState.scaleWidth + 5) continue;
            ticks += `<line x1="${x}" y1="0" x2="${x}" y2="12" stroke="#aaa" stroke-width="1"/>`;
        }
    }

    return ticks;
}

function slideruleHandArrow(x1, y, x2, color, id) {
    const len = x2 - x1;
    const dir = len > 0 ? 1 : -1;
    const abs = Math.abs(len);
    const mid = (x1 + x2) / 2;
    const wobble = Math.min(abs * 0.06, 5);
    const cp1x = x1 + len * 0.3;
    const cp1y = y - wobble;
    const cp2x = x1 + len * 0.7;
    const cp2y = y + wobble * 0.7;
    const tipX = x2;
    const headLen = Math.min(abs * 0.15, 14);
    const headW = Math.min(abs * 0.08, 7);
    return `<path d="M${x1},${y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${tipX},${y}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.9"/>` +
        `<path d="M${tipX - dir * headLen},${y - headW} L${tipX},${y} L${tipX - dir * headLen},${y + headW}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
}

function slideruleGenerateArrows(cx) {
    const so = slideruleState.slideOffset;
    if (Math.abs(so) < 2) return '';
    if (slideruleState.scaleMode !== 'CD') return '';

    const colorA = '#ff6644';
    const colorB = '#44aaff';
    const colorR = '#ff3333';

    let arrows = '';
    const ss = slideruleState.scaleStart;
    const cOneX = ss + so;
    const vals = slideruleReadAtCursor();
    const aVal = Math.round(vals.d * 1000) / 1000;
    const bVal = Math.round(vals.c * 1000) / 1000;
    const product = Math.round(aVal * bVal * 1000) / 1000;

    const labelY = -8;
    const labelFontSize = 16;

    arrows += `<text x="${cOneX}" y="${labelY}" text-anchor="middle" fill="${colorA}" font-size="${labelFontSize}" font-weight="bold" font-family="'Comic Sans MS', 'Marker Felt', cursive">a = ${aVal}</text>`;

    if (Math.abs(cx - cOneX) > 2) {
        arrows += `<text x="${cx}" y="${labelY}" text-anchor="middle" fill="${colorB}" font-size="${labelFontSize}" font-weight="bold" font-family="'Comic Sans MS', 'Marker Felt', cursive">b = ${bVal}</text>`;
    }

    const sumY = 128;
    if (cx > ss + 2) {
        arrows += slideruleHandArrow(ss, sumY, cx, colorR, 'sum');
        const midR = (ss + cx) / 2;
        arrows += `<text x="${midR}" y="${sumY + 18}" text-anchor="middle" fill="${colorR}" font-size="14" font-weight="bold" font-family="'Comic Sans MS', 'Marker Felt', cursive">a × b = ${product}</text>`;
    }

    return arrows;
}

function slideruleInjectSidebar() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;
    const existing = document.getElementById('slideruleSidebarHIW');
    if (existing) return;

    const hiwHTML = `<div id="slideruleSidebarHIW" style="margin-bottom:1rem;">
        <div class="panel" style="margin-bottom:0.75rem;">
            <div class="panel-title" style="color:var(--church-gold);">How the Slide Rule Works</div>
            <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                The slide rule computes by <em>adding or comparing logarithmic lengths</em>.
                On the C/D scales, sliding by log(a) and reading at C=b gives D = a\u00d7b.
                <span style="color:#ff6644;">a</span> and <span style="color:#44aaff;">b</span> are labelled above the scale. The <span style="color:#ff3333;">red arrow</span> below shows a \u00d7 b.
                Other scales use the same principle for squares (A/B), cubes (K),
                reciprocals (CI), and trigonometry (S/T) \u2014 all backed by
                CALL SlideRule at NS[16].
            </div>
        </div>
        <div class="panel" style="margin-bottom:0.75rem;">
            <div class="panel-title" style="color:rgba(130,200,255,0.95);">Floating Point \u2014 The Slide Rule Inside Your Computer</div>
            <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                <p style="margin:0 0 0.5rem 0;">Every floating-point number works like a slide rule reading: a <strong>mantissa</strong> (scale position) and an <strong>exponent</strong> (power of 10). IEEE 754 does the same in binary.</p>
                <div style="display:flex;flex-direction:column;gap:0.3rem;background:rgba(0,0,0,0.2);border-radius:6px;padding:0.5rem;margin-bottom:0.5rem;font-size:0.78rem;font-family:monospace;">
                    <div><span style="color:var(--church-gold);">Slide Rule:</span> \u00b1 scale position (1\u201310) \u00d7 10\u207f</div>
                    <div><span style="color:rgba(130,200,255,0.95);">IEEE 754:</span> sign bit \u00b7 mantissa (1.xxx\u2082) \u00d7 2\u1d49</div>
                </div>
                <p style="margin:0 0 0.3rem 0;"><strong style="color:var(--church-gold);">Why logarithmic?</strong> Numbers are spread so 1\u20132 takes the same space as 2\u20134 or 4\u20138 \u2014 equal precision per order of magnitude.</p>
                <p style="margin:0 0 0.3rem 0;"><strong style="color:var(--church-gold);">Multiply = add logs:</strong> <span style="color:var(--church-gold);">log(a \u00d7 b) = log(a) + log(b)</span>. CPUs do the same: add exponents, multiply mantissas.</p>
                <p style="margin:0;"><strong style="color:var(--church-gold);">In the Church Machine:</strong> 32-bit Turing data words follow the same mantissa + exponent structure. The slide rule on screen and the ALU in hardware are doing the same mathematics.</p>
            </div>
        </div>
    </div>`;

    historyContent.insertAdjacentHTML('afterbegin', hiwHTML);
}

function slideruleRemoveSidebar() {
    const el = document.getElementById('slideruleSidebarHIW');
    if (el) el.remove();
}

function slideruleGenerateTopLabels(scaleDef, offset) {
    let labels = '';
    const range = scaleDef.range;
    let majorVals = [];
    if (range[1] <= 10) {
        majorVals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    } else if (range[1] <= 100) {
        majorVals = [1, 2, 3, 5, 10, 20, 30, 50, 100];
    } else if (range[1] <= 1000) {
        majorVals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    } else if (range[0] >= 5) {
        majorVals = [6, 10, 15, 20, 30, 45, 60, 90];
    }
    for (const v of majorVals) {
        if (v < range[0] || v > range[1]) continue;
        const x = slideruleValToXForScale(v, scaleDef, offset);
        if (x < slideruleState.scaleStart - 5 || x > slideruleState.scaleStart + slideruleState.scaleWidth + 5) continue;
        let label = v.toString();
        if (v >= 1000) label = '1k';
        labels += `<text x="${x}" y="-6" text-anchor="middle" fill="${scaleDef.color}" font-size="20" font-weight="bold" font-family="monospace" opacity="0.85">${label}</text>`;
        labels += `<line x1="${x}" y1="-2" x2="${x}" y2="0" stroke="${scaleDef.color}" stroke-width="1" opacity="0.5"/>`;
    }
    return labels;
}

function slideruleRenderDisplay() {
    const container = document.getElementById('slideruleContainer');
    if (!container) return;

    const mode = SLIDERULE_SCALES[slideruleState.scaleMode];
    const vals = slideruleReadAtCursor();

    const readout = container.querySelector('.sliderule-readout-value');
    if (readout) readout.textContent = mode.readout(vals.d, vals.c);

    const svgEl = container.querySelector('.sliderule-svg');
    if (svgEl) {
        const totalW = slideruleState.scaleStart * 2 + slideruleState.scaleWidth;
        const fixedTicks = slideruleGenerateScaleTicksForDef(mode.fixed, 0);
        const slideTicks = slideruleGenerateScaleTicksForDef(mode.slide, slideruleState.slideOffset);
        const cx = slideruleState.cursorX;
        const arrowsSVG = slideruleGenerateArrows(cx);
        const hasArrows = Math.abs(slideruleState.slideOffset) > 2 && slideruleState.scaleMode === 'CD';
        const svgHeight = hasArrows ? 150 : 140;
        const svgTop = hasArrows ? -30 : -28;

        svgEl.setAttribute('viewBox', `0 ${svgTop} ${totalW} ${svgHeight - svgTop}`);

        const topLabels = slideruleGenerateTopLabels(mode.fixed, 0);

        svgEl.innerHTML = `
            ${topLabels}

            <rect x="0" y="0" width="${totalW}" height="110" rx="4" fill="#2a1a0a" stroke="#8B7355" stroke-width="2"/>
            <rect x="${slideruleState.scaleStart - 4}" y="2" width="${slideruleState.scaleWidth + 8}" height="32" fill="#1a1a1a" rx="2"/>
            <text x="14" y="22" fill="${mode.fixed.color}" font-size="14" font-weight="bold" font-family="monospace">${mode.fixed.name}</text>
            <g transform="translate(0, 4)">${fixedTicks}</g>

            <rect x="${slideruleState.scaleStart - 4 + slideruleState.slideOffset}" y="38" width="${slideruleState.scaleWidth + 8}" height="32" fill="#1a3318" rx="2" class="sliderule-slide-rect" style="cursor:grab;"/>
            <text x="${slideruleState.scaleStart - 18 + slideruleState.slideOffset}" y="58" fill="${mode.slide.color}" font-size="14" font-weight="bold" font-family="monospace">${mode.slide.name}</text>
            <g transform="translate(0, 42)">${slideTicks}</g>

            <rect x="${slideruleState.scaleStart - 4}" y="74" width="${slideruleState.scaleWidth + 8}" height="32" fill="#1a1a1a" rx="2"/>
            <text x="14" y="94" fill="${mode.fixed.color}" font-size="14" font-weight="bold" font-family="monospace">${mode.fixed.name}</text>
            <g transform="translate(0, 78)">${fixedTicks}</g>

            <line x1="${cx}" y1="${svgTop}" x2="${cx}" y2="110" stroke="rgba(255,50,50,0.8)" stroke-width="1.5" stroke-dasharray="3,2"/>
            <rect x="${cx - 10}" y="${svgTop}" width="20" height="${110 - svgTop}" fill="rgba(255,50,50,0.08)" class="sliderule-cursor-zone" style="cursor:crosshair;"/>
            <circle cx="${cx}" cy="${svgTop + 4}" r="4" fill="#ff3333" class="sliderule-cursor-handle" style="cursor:crosshair;"/>

            ${arrowsSVG}
        `;

        const slideRect = svgEl.querySelector('.sliderule-slide-rect');
        if (slideRect) {
            slideRect.addEventListener('mousedown', slideruleStartDragSlide);
            slideRect.addEventListener('touchstart', slideruleStartDragSlide, { passive: false });
        }

        const cursorZone = svgEl.querySelector('.sliderule-cursor-zone');
        const cursorHandle = svgEl.querySelector('.sliderule-cursor-handle');
        if (cursorZone) {
            cursorZone.addEventListener('mousedown', slideruleStartDragCursor);
            cursorZone.addEventListener('touchstart', slideruleStartDragCursor, { passive: false });
        }
        if (cursorHandle) {
            cursorHandle.addEventListener('mousedown', slideruleStartDragCursor);
            cursorHandle.addEventListener('touchstart', slideruleStartDragCursor, { passive: false });
        }
    }

    const traceArea = container.querySelector('.sliderule-trace-area');
    if (traceArea) {
        traceArea.innerHTML = slideruleState.trace.map((t, i) =>
            `<div class="sliderule-trace-entry${i === 0 ? ' sliderule-trace-latest' : ''}">
                <div class="sliderule-trace-lambda">${t.lambda}</div>
                <div class="sliderule-trace-desc">${t.desc}</div>
            </div>`
        ).join('');
    }
}

function renderSlideRuleCalculator() {
    const container = document.getElementById('slideruleContainer');
    if (!container) return;

    slideruleState.cursorX = slideruleState.scaleStart + slideruleState.scaleWidth / 2;
    const totalW = slideruleState.scaleStart * 2 + slideruleState.scaleWidth;

    let scaleButtonsHTML = '';
    for (const key in SLIDERULE_SCALES) {
        const s = SLIDERULE_SCALES[key];
        const active = key === slideruleState.scaleMode ? ' active' : '';
        scaleButtonsHTML += `<button class="sliderule-scale-btn${active}" data-scale="${key}" onclick="slideruleSwitchScale('${key}')">${s.label}<span class="sliderule-scale-desc">${s.desc}</span></button>`;
    }

    container.innerHTML = `
    <div class="sliderule-tile-grid">
        <div class="sliderule-tile-column">
            <div class="sliderule-tile sliderule-tile-calc">
                <div class="sliderule-body">
                    <div class="sliderule-title">
                        <span class="sliderule-title-label">SLIDE RULE</span>
                        <span class="sliderule-title-ns">NS[16] \u00b7 SlideRule</span>
                    </div>
                    <div class="sliderule-scale-selector">
                        ${scaleButtonsHTML}
                    </div>
                    <div class="sliderule-readout">
                        <span class="sliderule-readout-value"></span>
                    </div>
                    <svg class="sliderule-svg" width="${totalW}" height="110" viewBox="0 0 ${totalW} 110" preserveAspectRatio="xMidYMid meet"></svg>
                    <div class="sliderule-instructions">Drag <span style="color:#33cc66;">green slide</span> to set value \u00b7 Drag <span style="color:#ff3333;">red cursor</span> to read</div>
                    <div class="sliderule-presets">
                        <span class="sliderule-preset-label">Try:</span>
                        <button class="sliderule-preset-btn" onclick="sliderulePresetMultiply(2, 3)">2 \u00d7 3</button>
                        <button class="sliderule-preset-btn" onclick="sliderulePresetMultiply(1.5, 4)">1.5 \u00d7 4</button>
                        <button class="sliderule-preset-btn" onclick="sliderulePresetMultiply(3.14, 2)">\u03c0 \u00d7 2</button>
                        <button class="sliderule-preset-btn" onclick="sliderulePresetSqrt(2)">\u221a2</button>
                        <button class="sliderule-preset-btn" onclick="sliderulePresetSqrt(9)">\u221a9</button>
                        <button class="sliderule-preset-btn" onclick="slideruleReset()">Reset</button>
                    </div>
                </div>
            </div>
            <div class="sliderule-tile sliderule-tile-trace">
                <div class="sliderule-tile-header">Church Machine Trace</div>
                <div class="sliderule-trace-area"></div>
            </div>
        </div>

        
    </div>`;

    slideruleState.rendered = true;
    sliderulePresetMultiply(2, 3);
}
