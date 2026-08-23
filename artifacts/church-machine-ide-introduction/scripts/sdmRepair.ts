import {
  SDM_FORMAT,
  SDM_SLIDE_HEIGHT,
  SDM_SLIDE_WIDTH,
  SDM_VERSION,
} from '../src/.sdm/core/schema';

export type RepairResult = {
  value: unknown;
  changes: Array<string>;
};

const SDM_FILEPATH = /^src\/data\/slides\/([A-Za-z0-9_-]+)\.sdm\.yaml$/;
const COLOR_HEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const DOCUMENT_PREFIX_KEYS = ['format', 'version', 'size'];
const ELEMENT_TYPES = new Set([
  'text',
  'shape',
  'image',
  'line',
  'group',
  'table',
  'widget',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repairManifestPositions(
  manifest: Array<unknown>,
  changes: Array<string>,
): void {
  const positions: Array<number> = [];
  for (const entry of manifest) {
    if (
      !isRecord(entry) ||
      typeof entry.position !== 'number' ||
      !Number.isInteger(entry.position) ||
      entry.position < 1
    ) {
      return;
    }
    positions.push(entry.position);
  }
  if (
    positions.some((position, index) => {
      const previous = positions[index - 1];

      return previous !== undefined && position <= previous;
    }) ||
    positions.every((position, index) => position === index + 1)
  ) {
    return;
  }

  manifest.forEach((entry, index) => {
    if (!isRecord(entry) || entry.position === index + 1) {
      return;
    }
    const previous = entry.position;
    entry.position = index + 1;
    changes.push(
      `manifest[${index}].position: reindexed ${String(previous)} to ${index + 1}`,
    );
  });
}

export function repairSlidesManifest(input: unknown): RepairResult {
  const value = structuredClone(input);
  const changes: Array<string> = [];
  if (!Array.isArray(value)) {
    return { value, changes };
  }

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      return;
    }
    const title = entry.title;
    if (
      typeof title === 'string' &&
      title.trim() !== '' &&
      (entry.description === undefined ||
        (typeof entry.description === 'string' &&
          entry.description.trim() === ''))
    ) {
      entry.description = title;
      changes.push(`manifest[${index}].description: copied non-blank title`);
    }
    if (
      entry.kind === undefined &&
      typeof entry.id === 'string' &&
      typeof entry.filepath === 'string' &&
      SDM_FILEPATH.exec(entry.filepath)?.[1] === entry.id
    ) {
      entry.kind = 'sdm';
      changes.push(`manifest[${index}].kind: set to "sdm" from filepath`);
    }
  });
  repairManifestPositions(value, changes);

  return { value, changes };
}

export function isRepairableSdmFile(id: string, filepath: string): boolean {
  return SDM_FILEPATH.exec(filepath)?.[1] === id;
}

export function isRepairableAssetArray(
  assets: unknown,
): assets is Array<Record<string, unknown> & { id: string }> {
  if (!Array.isArray(assets)) {
    return false;
  }

  const ids = new Set<string>();
  for (const asset of assets) {
    if (
      !isRecord(asset) ||
      typeof asset.id !== 'string' ||
      asset.id.trim() === '' ||
      ids.has(asset.id)
    ) {
      return false;
    }
    ids.add(asset.id);
  }

  return true;
}

function repairDocumentBoilerplate(
  document: Record<string, unknown>,
  changes: Array<string>,
): Record<string, unknown> {
  if (!Array.isArray(document.elements)) {
    return document;
  }
  const added: Record<string, unknown> = {};
  if (document.format === undefined) {
    added.format = SDM_FORMAT;
    changes.push(`format: added "${SDM_FORMAT}"`);
  }
  if (document.version === undefined) {
    added.version = SDM_VERSION;
    changes.push(`version: added ${SDM_VERSION}`);
  }
  if (document.size === undefined) {
    added.size = { width: SDM_SLIDE_WIDTH, height: SDM_SLIDE_HEIGHT };
    changes.push(
      `size: added the ${SDM_SLIDE_WIDTH}x${SDM_SLIDE_HEIGHT} canvas`,
    );
  }
  if (Object.keys(added).length === 0) {
    return document;
  }

  const merged = { ...document, ...added };
  const ordered: Record<string, unknown> = {};
  for (const key of DOCUMENT_PREFIX_KEYS) {
    if (Object.hasOwn(merged, key)) {
      ordered[key] = merged[key];
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!DOCUMENT_PREFIX_KEYS.includes(key)) {
      ordered[key] = value;
    }
  }

  return ordered;
}

function repairAssets(
  document: Record<string, unknown>,
  changes: Array<string>,
): void {
  const assets = document.assets;
  if (!isRepairableAssetArray(assets)) {
    return;
  }
  const converted: Array<[string, Record<string, unknown>]> = [];
  for (const asset of assets) {
    const { id, ...assetValue } = asset;
    converted.push([id, assetValue]);
  }
  document.assets = Object.fromEntries(converted);
  changes.push('assets: converted array to object keyed by asset id');
}

function repairColor(
  owner: Record<string, unknown>,
  key: string,
  path: string,
  changes: Array<string>,
): void {
  const color = owner[key];
  if (typeof color !== 'string' || !COLOR_HEX.test(color)) {
    return;
  }
  const value =
    color.length === 4
      ? `#${Array.from(color.slice(1), (digit) => `${digit}${digit}`).join('')}`
      : color;
  owner[key] = { kind: 'rgb', value };
  changes.push(`${path}: wrapped bare color as rgb ${value}`);
}

function repairFont(
  owner: Record<string, unknown>,
  key: string,
  path: string,
  fontTokens: Set<string>,
  changes: Array<string>,
): void {
  const font = owner[key];
  if (
    typeof font !== 'string' ||
    font.trim() === '' ||
    fontTokens.has(font)
  ) {
    return;
  }
  owner[key] = { kind: 'family', family: font };
  changes.push(`${path}: wrapped bare font as family "${font}"`);
}

function repairRunStyle(
  style: unknown,
  path: string,
  fontTokens: Set<string>,
  changes: Array<string>,
): void {
  if (!isRecord(style)) {
    return;
  }
  if (typeof style.fontSize === 'number' && style.sizePt === undefined) {
    style.sizePt = style.fontSize;
    delete style.fontSize;
    changes.push(`${path}: renamed fontSize to sizePt`);
  }
  repairFont(style, 'font', `${path}.font`, fontTokens, changes);
  repairColor(style, 'color', `${path}.color`, changes);
  repairColor(style, 'highlight', `${path}.highlight`, changes);
}

function repairPaint(
  paint: unknown,
  path: string,
  changes: Array<string>,
): void {
  if (!isRecord(paint)) {
    return;
  }
  if (paint.kind === 'solid') {
    repairColor(paint, 'color', `${path}.color`, changes);
  } else if (paint.kind === 'linearGradient' && Array.isArray(paint.stops)) {
    paint.stops.forEach((stop, index) => {
      if (isRecord(stop)) {
        repairColor(stop, 'color', `${path}.stops[${index}].color`, changes);
      }
    });
  }
}

function repairStroke(
  stroke: unknown,
  path: string,
  changes: Array<string>,
): void {
  if (isRecord(stroke)) {
    repairColor(stroke, 'color', `${path}.color`, changes);
  }
}

function repairTextBody(
  body: unknown,
  path: string,
  fontTokens: Set<string>,
  changes: Array<string>,
): void {
  if (!isRecord(body)) {
    return;
  }
  if (!Array.isArray(body.paragraphs)) {
    return;
  }
  body.paragraphs.forEach((paragraph, paragraphIndex) => {
    if (!isRecord(paragraph)) {
      return;
    }
    repairRunStyle(
      paragraph.defaultRunStyle,
      `${path}.paragraphs[${paragraphIndex}].defaultRunStyle`,
      fontTokens,
      changes,
    );
    repairRunStyle(
      paragraph.markerStyle,
      `${path}.paragraphs[${paragraphIndex}].markerStyle`,
      fontTokens,
      changes,
    );
    if (!Array.isArray(paragraph.runs)) {
      return;
    }
    paragraph.runs.forEach((run, runIndex) => {
      repairRunStyle(
        run,
        `${path}.paragraphs[${paragraphIndex}].runs[${runIndex}]`,
        fontTokens,
        changes,
      );
    });
  });
}

function repairElements(
  elements: unknown,
  path: string,
  fontTokens: Set<string>,
  changes: Array<string>,
): void {
  if (!Array.isArray(elements)) {
    return;
  }
  elements.forEach((element, elementIndex) => {
    if (!isRecord(element)) {
      return;
    }
    const elementPath = `${path}[${elementIndex}]`;
    if (
      element.type === undefined &&
      typeof element.kind === 'string' &&
      ELEMENT_TYPES.has(element.kind)
    ) {
      element.type = element.kind;
      delete element.kind;
      changes.push(`${elementPath}: renamed kind to type`);
    }
    if (element.type === 'text' || element.type === 'shape') {
      repairTextBody(
        element.body,
        `${elementPath}.body`,
        fontTokens,
        changes,
      );
      repairPaint(element.fill, `${elementPath}.fill`, changes);
      repairStroke(element.stroke, `${elementPath}.stroke`, changes);
    }
    if (element.type === 'line') {
      repairStroke(element.stroke, `${elementPath}.stroke`, changes);
    }
    if (element.type === 'group') {
      repairElements(
        element.children,
        `${elementPath}.children`,
        fontTokens,
        changes,
      );
    }
    if (element.type === 'table' && Array.isArray(element.rows)) {
      element.rows.forEach((row, rowIndex) => {
        if (!isRecord(row) || !Array.isArray(row.cells)) {
          return;
        }
        row.cells.forEach((cell, cellIndex) => {
          if (!isRecord(cell)) {
            return;
          }
          repairTextBody(
            cell.body,
            `${elementPath}.rows[${rowIndex}].cells[${cellIndex}].body`,
            fontTokens,
            changes,
          );
          repairPaint(
            cell.fill,
            `${elementPath}.rows[${rowIndex}].cells[${cellIndex}].fill`,
            changes,
          );
        });
      });
    }
  });
}

export function repairSlideDocument(input: unknown): RepairResult {
  const value = structuredClone(input);
  const changes: Array<string> = [];
  if (
    !isRecord(value) ||
    (value.format !== undefined && value.format !== SDM_FORMAT) ||
    (value.version !== undefined && value.version !== SDM_VERSION)
  ) {
    return { value, changes };
  }

  const document = repairDocumentBoilerplate(value, changes);
  repairAssets(document, changes);
  repairPaint(document.background, 'background', changes);
  const fontTokens =
    isRecord(document.theme) && isRecord(document.theme.fonts)
      ? new Set(Object.keys(document.theme.fonts))
      : new Set<string>();
  repairElements(document.elements, 'elements', fontTokens, changes);

  return { value: document, changes };
}
