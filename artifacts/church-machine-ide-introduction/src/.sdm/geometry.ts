import type { Element, Frame } from './core/schema';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const HANDLE_CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export const HANDLE_POS: Record<Handle, { left: string; top: string }> = {
  nw: { left: '0%', top: '0%' },
  n: { left: '50%', top: '0%' },
  ne: { left: '100%', top: '0%' },
  e: { left: '100%', top: '50%' },
  se: { left: '100%', top: '100%' },
  s: { left: '50%', top: '100%' },
  sw: { left: '0%', top: '100%' },
  w: { left: '0%', top: '50%' },
};

const MIN_SIZE = 8;

export function elementTransform(
  element: Pick<Element, 'rotationDeg' | 'flipH' | 'flipV'>,
  rotationDeg = element.rotationDeg,
): string | undefined {
  return (
    [
      rotationDeg ? `rotate(${rotationDeg}deg)` : '',
      element.flipH ? 'scaleX(-1)' : '',
      element.flipV ? 'scaleY(-1)' : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

export function rotationTransform(
  rotationDeg: number | undefined,
): string | undefined {
  return rotationDeg ? `rotate(${rotationDeg}deg)` : undefined;
}

export function moveFrame(start: Frame, dx: number, dy: number): Frame {
  return {
    ...start,
    x: Math.round(start.x + dx),
    y: Math.round(start.y + dy),
  };
}

export function resizeFrame(
  start: Frame,
  handle: Handle,
  dx: number,
  dy: number,
  keepAspect = false,
  rotationDeg = 0,
): Frame {
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;
  const east = handle.includes('e');
  const west = handle.includes('w');
  const south = handle.includes('s');
  const north = handle.includes('n');

  let width = start.width;
  let height = start.height;

  if (east) {
    width = Math.max(MIN_SIZE, start.width + localDx);
  } else if (west) {
    width = Math.max(MIN_SIZE, start.width - localDx);
  }
  if (south) {
    height = Math.max(MIN_SIZE, start.height + localDy);
  } else if (north) {
    height = Math.max(MIN_SIZE, start.height - localDy);
  }

  if (keepAspect && (east || west) && (north || south)) {
    const widthScale = width / start.width;
    const heightScale = height / start.height;
    const requestedScale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    const scale = Math.max(
      requestedScale,
      MIN_SIZE / start.width,
      MIN_SIZE / start.height,
    );
    width = start.width * scale;
    height = start.height * scale;
  }

  const localX = west ? start.width - width : 0;
  const localY = north ? start.height - height : 0;
  const localCenterX = localX + width / 2 - start.width / 2;
  const localCenterY = localY + height / 2 - start.height / 2;
  const centerX =
    start.x +
    start.width / 2 +
    localCenterX * cos -
    localCenterY * sin;
  const centerY =
    start.y +
    start.height / 2 +
    localCenterX * sin +
    localCenterY * cos;

  return {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}
