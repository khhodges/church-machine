import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  planRootPointerSelection,
  setElementFrame,
  translateRootElements,
  updateElement,
} from './core/operations';
import type { SdmContextMenuInvocation } from './core/protocol';
import type {
  Element as SdmElement,
  Frame,
  SlideDocument,
} from './core/schema';
import type { SdmTextCaretPoint } from './SdmTextEditor';
import {
  HANDLE_CURSORS,
  HANDLE_POS,
  HANDLES,
  elementTransform,
  resizeFrame,
  rotationTransform,
  type Handle,
} from './geometry';

const DRAG_THRESHOLD_PX = 3;

interface Props {
  document: SlideDocument;
  selectedIds: Array<string>;
  scale: number;
  /**
   * Extra visual scale the embedding workspace applies to the iframe. Sizes
   * selection chrome only — pointer math stays in the iframe's own space.
   */
  viewportScale?: number;
  stageRef: RefObject<HTMLDivElement | null>;
  onSelect: (ids: Array<string>) => void;
  textCaretElementId: string | null;
  onActivateTextCaret: (
    elementId: string,
    point: SdmTextCaretPoint,
  ) => boolean;
  onExitTextCaret: () => SlideDocument | null;
  onPlaceTextCaret: (point: SdmTextCaretPoint) => boolean;
  onCommit: (document: SlideDocument, selectedIds: Array<string>) => void;
  onHistory: (direction: 'undo' | 'redo') => void;
  onForwardKey: (event: KeyboardEvent) => boolean;
  onContextMenuRequest: (
    target: string | null,
    invocation: SdmContextMenuInvocation,
  ) => boolean;
}

const KEYBOARD_OWNER_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="tree"]',
  '[role="treeitem"]',
  '[role="dialog"]',
  '[role="combobox"]',
].join(',');

const ENTER_OWNER_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="link"]',
  'summary',
].join(',');

function topLevelIdAt(
  target: EventTarget | null,
  stage: HTMLElement,
): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  let found: string | null = null;
  let node: Element | null = target.closest('[data-sdm-id]');
  while (node !== null && stage.contains(node)) {
    const id = node.getAttribute('data-sdm-id');
    if (id !== null) {
      found = id;
    }
    node = node.parentElement?.closest('[data-sdm-id]') ?? null;
  }

  return found;
}

function isKeyOwnedByTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(KEYBOARD_OWNER_SELECTOR) !== null
  );
}

function isEnterOwnedByTarget(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    event.target instanceof Element &&
    event.target.closest(ENTER_OWNER_SELECTOR) !== null
  );
}

function hasNoModifiers(event: KeyboardEvent): boolean {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function shouldSuppressForwardedDefault(event: KeyboardEvent): boolean {
  const isPlainDelete =
    (event.key === 'Delete' || event.key === 'Backspace') &&
    hasNoModifiers(event);
  const isArrow =
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown';
  const isNudge =
    isArrow && !event.altKey && !event.ctrlKey && !event.metaKey;
  const isSelectAll =
    event.key.toLowerCase() === 'a' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey;
  const hasPrimaryModifier = event.ctrlKey || event.metaKey;
  const isDuplicate =
    event.key.toLowerCase() === 'd' &&
    hasPrimaryModifier &&
    !event.altKey &&
    !event.shiftKey;
  const isArrange =
    hasPrimaryModifier &&
    !event.altKey &&
    (event.code === 'BracketRight' ||
      event.key === ']' ||
      event.key === '}' ||
      event.code === 'BracketLeft' ||
      event.key === '[' ||
      event.key === '{');

  return isPlainDelete || isNudge || isSelectAll || isDuplicate || isArrange;
}

function isOverlayChrome(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-sdm-handle], [data-sdm-rotate-handle]') !== null
  );
}

function isTextCaretTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-sdm-text-caret-active="true"]') !== null
  );
}

function isRenderedTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-sdm-text-run], [data-sdm-text-marker]') !== null
  );
}

function isEditableTextElement(element: SdmElement): boolean {
  return (
    element.type === 'text' ||
    (element.type === 'shape' && element.body !== undefined)
  );
}

function sameFrame(left: Frame, right: Frame): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function applyDraft(nodes: Array<HTMLElement>, frame: Frame) {
  for (const node of nodes) {
    node.style.left = `${frame.x}px`;
    node.style.top = `${frame.y}px`;
    node.style.width = `${frame.width}px`;
    node.style.height = `${frame.height}px`;
  }
}

function normalizeRotation(rotationDeg: number): number {
  return ((rotationDeg % 360) + 360) % 360;
}

export function SdmInteractionLayer({
  document,
  selectedIds,
  scale,
  viewportScale = 1,
  stageRef,
  onSelect,
  textCaretElementId,
  onActivateTextCaret,
  onExitTextCaret,
  onPlaceTextCaret,
  onCommit,
  onHistory,
  onForwardKey,
  onContextMenuRequest,
}: Props) {
  const documentRef = useRef(document);
  documentRef.current = document;
  const lastDocumentRef = useRef(document);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const textCaretElementIdRef = useRef(textCaretElementId);
  textCaretElementIdRef.current = textCaretElementId;
  const onActivateTextCaretRef = useRef(onActivateTextCaret);
  onActivateTextCaretRef.current = onActivateTextCaret;
  const onExitTextCaretRef = useRef(onExitTextCaret);
  onExitTextCaretRef.current = onExitTextCaret;
  const onPlaceTextCaretRef = useRef(onPlaceTextCaret);
  onPlaceTextCaretRef.current = onPlaceTextCaret;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;
  const onForwardKeyRef = useRef(onForwardKey);
  onForwardKeyRef.current = onForwardKey;
  const onContextMenuRequestRef = useRef(onContextMenuRequest);
  onContextMenuRequestRef.current = onContextMenuRequest;
  const overlayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    captureTarget: HTMLElement;
    controller: AbortController;
    pointerId: number;
    restore: () => void;
  } | null>(null);

  const draftNodes = (elementId: string): Array<HTMLElement> => {
    const nodes: Array<HTMLElement> = [];
    const stageNode = stageRef.current?.querySelector(
      `[data-sdm-id="${CSS.escape(elementId)}"]`,
    );
    if (stageNode instanceof HTMLElement) {
      nodes.push(stageNode);
    }
    const outlineNode = overlayRef.current?.querySelector(
      `[data-sdm-selection-id="${CSS.escape(elementId)}"]`,
    );
    if (outlineNode instanceof HTMLElement) {
      nodes.push(outlineNode);
    }

    return nodes;
  };

  const applyRotationDraft = (
    element: SdmElement,
    rotationDeg: number | undefined,
  ) => {
    const stageNode = stageRef.current?.querySelector(
      `[data-sdm-id="${CSS.escape(element.id)}"]`,
    );
    if (stageNode instanceof HTMLElement) {
      stageNode.style.transform = elementTransform(element, rotationDeg) ?? '';
    }
    const outlineNode = overlayRef.current?.querySelector(
      `[data-sdm-selection-id="${CSS.escape(element.id)}"]`,
    );
    if (outlineNode instanceof HTMLElement) {
      outlineNode.style.transform = rotationTransform(rotationDeg) ?? '';
    }
  };

  const endGesture = () => {
    const gesture = gestureRef.current;
    if (gesture === null) {
      return;
    }
    gestureRef.current = null;
    gesture.restore();
    gesture.controller.abort();
    try {
      gesture.captureTarget.releasePointerCapture(gesture.pointerId);
    } catch {}
  };

  const trackGesture = <Value,>({
    startEvent,
    startValue,
    valueAt,
    valuesEqual,
    applyValue,
    commitValue,
    restore,
    onClick,
  }: {
    startEvent: PointerEvent;
    startValue: Value;
    valueAt: (
      dxStage: number,
      dyStage: number,
      shiftKey: boolean,
      event: PointerEvent,
    ) => Value;
    valuesEqual: (left: Value, right: Value) => boolean;
    applyValue: (value: Value) => void;
    commitValue: (value: Value) => void;
    restore: () => void;
    onClick?: () => void;
  }) => {
    endGesture();
    const captureTarget = stageRef.current;
    if (captureTarget === null) {
      return;
    }
    const controller = new AbortController();
    gestureRef.current = {
      captureTarget,
      controller,
      pointerId: startEvent.pointerId,
      restore,
    };
    let moved = false;
    let lastValue = startValue;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== startEvent.pointerId) {
        return;
      }
      const dxClient = event.clientX - startEvent.clientX;
      const dyClient = event.clientY - startEvent.clientY;
      if (!moved && Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      const stageScale = scaleRef.current || 1;
      lastValue = valueAt(
        dxClient / stageScale,
        dyClient / stageScale,
        event.shiftKey,
        event,
      );
      applyValue(lastValue);
    };

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== startEvent.pointerId) {
        return;
      }
      const shouldCommit = moved && !valuesEqual(lastValue, startValue);
      endGesture();
      if (!shouldCommit) {
        if (!moved) {
          onClick?.();
        }

        return;
      }
      commitValue(lastValue);
    };

    const cancel = (event: PointerEvent) => {
      if (event.pointerId !== startEvent.pointerId) {
        return;
      }
      endGesture();
    };

    window.addEventListener('pointermove', onMove, {
      signal: controller.signal,
    });
    window.addEventListener('pointerup', finish, { signal: controller.signal });
    window.addEventListener('pointercancel', cancel, {
      signal: controller.signal,
    });
    captureTarget.addEventListener('lostpointercapture', cancel, {
      signal: controller.signal,
    });
    try {
      captureTarget.setPointerCapture(startEvent.pointerId);
    } catch {}
  };

  const beginDragRef = useRef<
    (
      event: PointerEvent,
      element: SdmElement,
      elementIds: Array<string>,
      collapseTo?: string,
      onClick?: () => void,
    ) => void
  >(() => {});
  beginDragRef.current = (
    event,
    element,
    elementIds,
    collapseTo,
    onClick,
  ) => {
    const dragElements = documentRef.current.elements.filter((candidate) =>
      elementIds.includes(candidate.id),
    );
    const dragBlocked = dragElements.some((dragElement) => dragElement.locked);
    trackGesture({
      startEvent: event,
      startValue: element.frame,
      valueAt: (dx, dy) => {
        if (dragBlocked) {
          return element.frame;
        }
        const logicalDx = Math.round(dx);
        const logicalDy = Math.round(dy);

        return {
          ...element.frame,
          x: element.frame.x + logicalDx,
          y: element.frame.y + logicalDy,
        };
      },
      valuesEqual: sameFrame,
      applyValue: (frame) => {
        if (dragBlocked) {
          return;
        }
        const dx = frame.x - element.frame.x;
        const dy = frame.y - element.frame.y;
        for (const dragElement of dragElements) {
          applyDraft(draftNodes(dragElement.id), {
            ...dragElement.frame,
            x: dragElement.frame.x + dx,
            y: dragElement.frame.y + dy,
          });
        }
      },
      commitValue: (frame) => {
        if (dragBlocked) {
          return;
        }
        const currentDocument = documentRef.current;
        const nextDocument = translateRootElements(
          currentDocument,
          elementIds,
          frame.x - element.frame.x,
          frame.y - element.frame.y,
        );
        if (nextDocument !== currentDocument) {
          onCommitRef.current(nextDocument, elementIds);
        }
      },
      restore: () => {
        for (const elementId of elementIds) {
          const currentElement = documentRef.current.elements.find(
            (candidate) => candidate.id === elementId,
          );
          if (currentElement !== undefined) {
            applyDraft(draftNodes(elementId), currentElement.frame);
          }
        }
      },
      onClick:
        collapseTo === undefined
          ? onClick
          : () => onSelectRef.current([collapseTo]),
    });
  };

  const beginResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    element: SdmElement,
    handle: Handle,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (textCaretElementIdRef.current !== null) {
      const committedDocument = onExitTextCaretRef.current();
      if (committedDocument !== null) {
        documentRef.current = committedDocument;
        lastDocumentRef.current = committedDocument;
      }
    }
    trackGesture({
      startEvent: event.nativeEvent,
      startValue: element.frame,
      valueAt: (dx, dy, shiftKey) =>
        resizeFrame(
          element.frame,
          handle,
          dx,
          dy,
          shiftKey,
          element.rotationDeg,
        ),
      valuesEqual: sameFrame,
      applyValue: (frame) => applyDraft(draftNodes(element.id), frame),
      commitValue: (frame) => {
        onCommitRef.current(
          setElementFrame(documentRef.current, element.id, frame),
          [element.id],
        );
      },
      restore: () => {
        const currentElement = documentRef.current.elements.find(
          (candidate) => candidate.id === element.id,
        );
        if (currentElement !== undefined) {
          applyDraft(draftNodes(element.id), currentElement.frame);
        }
      },
    });
  };

  const beginRotation = (
    event: ReactPointerEvent<HTMLDivElement>,
    element: SdmElement,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (textCaretElementIdRef.current !== null) {
      const committedDocument = onExitTextCaretRef.current();
      if (committedDocument !== null) {
        documentRef.current = committedDocument;
        lastDocumentRef.current = committedDocument;
      }
    }
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const stageScale = scaleRef.current || 1;
    const centerX =
      stageRect.left +
      (element.frame.x + element.frame.width / 2) * stageScale;
    const centerY =
      stageRect.top +
      (element.frame.y + element.frame.height / 2) * stageScale;
    const angleAt = (pointerEvent: PointerEvent) =>
      normalizeRotation(
        (Math.atan2(
          pointerEvent.clientY - centerY,
          pointerEvent.clientX - centerX,
        ) *
          180) /
          Math.PI +
          90,
      );
    const startRotation = normalizeRotation(element.rotationDeg ?? 0);
    const startPointerAngle = angleAt(event.nativeEvent);
    trackGesture({
      startEvent: event.nativeEvent,
      startValue: startRotation,
      valueAt: (_dx, _dy, shiftKey, pointerEvent) => {
        const pointerDelta =
          ((angleAt(pointerEvent) - startPointerAngle + 540) % 360) - 180;
        const rotation = normalizeRotation(startRotation + pointerDelta);
        const increment = shiftKey ? 15 : 1;

        return normalizeRotation(Math.round(rotation / increment) * increment);
      },
      valuesEqual: (left, right) => left === right,
      applyValue: (rotationDeg) =>
        applyRotationDraft(element, rotationDeg),
      commitValue: (rotationDeg) => {
        const currentDocument = documentRef.current;
        const nextDocument = updateElement(
          currentDocument,
          element.id,
          (currentElement) => ({ ...currentElement, rotationDeg }),
        );
        if (nextDocument !== currentDocument) {
          onCommitRef.current(nextDocument, [element.id]);
        }
      },
      restore: () => {
        const currentElement = documentRef.current.elements.find(
          (candidate) => candidate.id === element.id,
        );
        if (currentElement !== undefined) {
          applyRotationDraft(currentElement, currentElement.rotationDeg);
        }
      },
    });
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isOverlayChrome(event.target)) {
        return;
      }
      const id = topLevelIdAt(event.target, stage);
      const activeCaretId = textCaretElementIdRef.current;
      if (activeCaretId !== null) {
        if (isTextCaretTarget(event.target)) {
          return;
        }
        if (id === activeCaretId) {
          event.preventDefault();
          onPlaceTextCaretRef.current({
            clientX: event.clientX,
            clientY: event.clientY,
          });

          return;
        }
        const committedDocument = onExitTextCaretRef.current();
        if (committedDocument !== null) {
          documentRef.current = committedDocument;
          lastDocumentRef.current = committedDocument;
        }
      }
      const currentIds = selectedIdsRef.current;
      const hasSelectionModifier =
        event.ctrlKey || event.metaKey || event.shiftKey;
      const selectionPlan = planRootPointerSelection(
        documentRef.current,
        currentIds,
        id,
        hasSelectionModifier,
      );
      if (id === null) {
        if (currentIds.length > 0) {
          onSelectRef.current(selectionPlan.selectedIds);
        }

        return;
      }
      const element = documentRef.current.elements.find(
        (candidate) => candidate.id === id,
      );
      if (element === undefined) {
        return;
      }
      event.preventDefault();
      const selectionChanged =
        currentIds.length !== selectionPlan.selectedIds.length ||
        currentIds.some(
          (selectedId, index) =>
            selectedId !== selectionPlan.selectedIds[index],
        );
      if (selectionChanged) {
        onSelectRef.current(selectionPlan.selectedIds);
      }
      if (!selectionPlan.selectedIds.includes(id)) {
        return;
      }
      const activateTextCaret =
        !hasSelectionModifier &&
        !element.locked &&
        isEditableTextElement(element) &&
        selectionPlan.selectedIds.length === 1 &&
        selectionPlan.selectedIds[0] === id &&
        ((currentIds.length === 1 && currentIds[0] === id) ||
          isRenderedTextTarget(event.target))
          ? () =>
              onActivateTextCaretRef.current(id, {
                clientX: event.clientX,
                clientY: event.clientY,
              })
          : undefined;
      beginDragRef.current(
        event,
        element,
        selectionPlan.selectedIds,
        selectionPlan.collapseTo,
        selectionPlan.collapseTo === undefined
          ? activateTextCaret
          : undefined,
      );
    };

    const suppressActions = (event: MouseEvent) => {
      if (event.button !== 0 || isTextCaretTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (isTextCaretTarget(event.target)) {
        return;
      }
      const id = topLevelIdAt(event.target, stage);
      if (id === null) {
        return;
      }
      const element = documentRef.current.elements.find(
        (candidate) => candidate.id === id,
      );
      if (
        element === undefined ||
        !isEditableTextElement(element) ||
        element.locked
      ) {
        return;
      }
      onActivateTextCaretRef.current(id, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    // Keyboard invocations (Shift+F10, Menu key) fire at the focused element
    // outside the stage, so this listens window-wide. Browsers synthesize
    // them without a button and at unreliable coordinates (Chrome uses the
    // focused element's center), so the secondary button is the pointer
    // signal — not the position.
    const onContextMenu = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        textCaretElementIdRef.current !== null ||
        gestureRef.current !== null
      ) {
        return;
      }
      if (event.button !== 2) {
        if (isKeyOwnedByTarget(event.target)) {
          return;
        }
        if (onContextMenuRequestRef.current(null, { kind: 'keyboard' })) {
          event.preventDefault();
        }

        return;
      }
      const size = documentRef.current.size;
      const stageRect = stage.getBoundingClientRect();
      const stageScale = scaleRef.current || 1;
      const point = {
        x: Math.min(
          Math.max((event.clientX - stageRect.left) / stageScale, 0),
          size.width,
        ),
        y: Math.min(
          Math.max((event.clientY - stageRect.top) / stageScale, 0),
          size.height,
        ),
      };
      const target = isOverlayChrome(event.target)
        ? (selectedIdsRef.current[0] ?? null)
        : topLevelIdAt(event.target, stage);
      if (
        onContextMenuRequestRef.current(target, { kind: 'pointer', point })
      ) {
        event.preventDefault();
      }
    };

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('click', suppressActions, true);
    stage.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('click', suppressActions, true);
      stage.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [stageRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        textCaretElementIdRef.current !== null ||
        isEnterOwnedByTarget(event) ||
        isKeyOwnedByTarget(event.target)
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          onHistoryRef.current(event.shiftKey ? 'redo' : 'undo');

          return;
        }
        if (key === 'y') {
          event.preventDefault();
          onHistoryRef.current('redo');

          return;
        }
      }
      if (event.key === 'Escape') {
        if (selectedIdsRef.current.length > 0) {
          onSelectRef.current([]);
        }

        return;
      }
      if (
        onForwardKeyRef.current(event) &&
        shouldSuppressForwardedDefault(event)
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => () => endGesture(), []);

  useEffect(() => {
    if (lastDocumentRef.current === document) {
      return;
    }
    lastDocumentRef.current = document;
    endGesture();
  });

  const selectedElements = document.elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const resizeTarget =
    selectedElements.length === 1 &&
    selectedElements[0] !== undefined &&
    !selectedElements[0].locked &&
    selectedElements[0].type !== 'group' &&
    selectedElements[0].type !== 'line'
      ? selectedElements[0]
      : null;
  const visualScale = (scale || 1) * viewportScale;
  const selectionChromeScale = Math.min(Math.max(visualScale, 1), 1.5);
  const outlineWidth = Math.max(1.5 / visualScale, 1);
  const handleSize = (8 * selectionChromeScale) / visualScale;
  const rotationHandleSize = (12 * selectionChromeScale) / visualScale;
  const rotationHandleOffset = (16 * selectionChromeScale) / visualScale;
  const rotationIconSize = (7 * selectionChromeScale) / visualScale;

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1000000,
      }}
    >
      {selectedElements.map((element) => (
        <div
          key={element.id}
          data-sdm-selection-id={element.id}
          style={{
            position: 'absolute',
            left: element.frame.x,
            top: element.frame.y,
            width: element.frame.width,
            height: element.frame.height,
            transform: rotationTransform(element.rotationDeg),
            transformOrigin: 'center center',
            border: `${outlineWidth}px solid #2563eb`,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          {resizeTarget === element ? (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: -rotationHandleOffset,
                  width: outlineWidth,
                  height: rotationHandleOffset,
                  marginLeft: -outlineWidth / 2,
                  background: '#2563eb',
                }}
              />
              <div
                data-sdm-rotate-handle=""
                onPointerDown={(handleEvent) =>
                  beginRotation(handleEvent, element)
                }
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: -rotationHandleOffset,
                  width: rotationHandleSize,
                  height: rotationHandleSize,
                  marginLeft: -rotationHandleSize / 2,
                  marginTop: -rotationHandleSize / 2,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#2563eb',
                  background: '#ffffff',
                  border: `${outlineWidth}px solid #2563eb`,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  cursor: 'grab',
                  pointerEvents: 'auto',
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width={rotationIconSize}
                  height={rotationIconSize}
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M21 2.25a.75.75 0 0 1 .75.75v5a.754.754 0 0 1-.058.286c-.012.03-.028.056-.044.083a.742.742 0 0 1-.118.161.755.755 0 0 1-.244.162c-.032.014-.065.022-.099.03-.013.004-.025.01-.039.012l-.016.003A.75.75 0 0 1 21 8.75h-5a.75.75 0 0 1 0-1.5h3.19l-.98-.98a9.01 9.01 0 0 0-5.777-2.51L12 3.75A8.25 8.25 0 1 0 20.25 12a.75.75 0 0 1 .75-.75l.076.004a.75.75 0 0 1 .674.746 9.751 9.751 0 0 1-16.645 6.895A9.75 9.75 0 0 1 12 2.25l.508.013a10.509 10.509 0 0 1 6.752 2.936l.99.99V3a.75.75 0 0 1 .75-.75Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              {HANDLES.map((handle) => (
                <div
                  key={handle}
                  data-sdm-handle={handle}
                  onPointerDown={(handleEvent) =>
                    beginResize(handleEvent, element, handle)
                  }
                  style={{
                    position: 'absolute',
                    left: HANDLE_POS[handle].left,
                    top: HANDLE_POS[handle].top,
                    width: handleSize,
                    height: handleSize,
                    marginLeft: -handleSize / 2,
                    marginTop: -handleSize / 2,
                    background: '#ffffff',
                    border: `${outlineWidth}px solid #2563eb`,
                    borderRadius:
                      (2 * selectionChromeScale) / visualScale,
                    cursor: HANDLE_CURSORS[handle],
                    pointerEvents: 'auto',
                  }}
                />
              ))}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
