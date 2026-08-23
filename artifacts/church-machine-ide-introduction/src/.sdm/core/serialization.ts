import { parse as parseYamlSource, stringify as stringifyYaml } from 'yaml';

import { parseSlideDocument, type ParseSlideDocumentResult } from './schema';

export const SDM_DOCUMENT_EXTENSION = '.sdm.yaml';

export function sdmSlideDocumentFilename(slideId: string): string {
  return `${slideId}${SDM_DOCUMENT_EXTENSION}`;
}

export type DecodeYamlValueResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

export type DecodeSlideDocumentResult =
  | ParseSlideDocumentResult
  | { ok: false; reason: 'syntax'; message: string };

export function encodeSlideDocumentText(document: unknown): string {
  return stringifyYaml(document ?? null, {
    aliasDuplicateObjects: false,
    indent: 2,
    lineWidth: 0,
  });
}

export function decodeYamlValue(text: string): DecodeYamlValueResult {
  let root: unknown;
  try {
    root = parseYamlSource(text) as unknown;
  } catch (error) {
    return { ok: false, message: String(error) };
  }
  if (root === undefined || root === null) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(JSON.stringify(root)) as unknown };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

export function decodeSlideDocumentText(
  text: string,
): DecodeSlideDocumentResult {
  const decoded = decodeYamlValue(text);
  if (!decoded.ok) {
    return { ok: false, reason: 'syntax', message: decoded.message };
  }

  return parseSlideDocument(decoded.value);
}
