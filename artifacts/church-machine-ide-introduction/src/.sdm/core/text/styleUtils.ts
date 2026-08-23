import type { RunStyle } from '../schema';

export const RUN_STYLE_KEYS: ReadonlyArray<keyof RunStyle> = [
  'font',
  'sizePt',
  'weight',
  'italic',
  'underline',
  'strike',
  'color',
  'highlight',
  'letterSpacingPt',
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (Object.hasOwn(left, index) && !deepEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  let leftDefinedKeys = 0;
  for (const key of Object.keys(left)) {
    if (left[key] === undefined) {
      continue;
    }
    leftDefinedKeys += 1;
    if (!Object.hasOwn(right, key) || !deepEqual(left[key], right[key])) {
      return false;
    }
  }
  let rightDefinedKeys = 0;
  for (const key of Object.keys(right)) {
    if (right[key] !== undefined) {
      rightDefinedKeys += 1;
    }
  }

  return leftDefinedKeys === rightDefinedKeys;
}

export function runStyleOverrides(
  style: RunStyle,
  inherited: RunStyle | undefined,
): RunStyle {
  const overrides: RunStyle = {};
  for (const key of RUN_STYLE_KEYS) {
    if (style[key] !== undefined && !deepEqual(style[key], inherited?.[key])) {
      Object.assign(overrides, { [key]: style[key] });
    }
  }

  return overrides;
}
