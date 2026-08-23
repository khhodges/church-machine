import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { updateElement } from './core/operations';
import type { SdmTextCommand } from './core/protocol';
import {
  parseSlideDocument,
  type Action,
  type ParseSlideDocumentResult,
  type SlideDocument,
  type TextBody,
} from './core/schema';
import { ensureRegistryFontsStylesheet } from './fontCss';
import {
  backgroundValue,
  PaintLayer,
  SdmElementView,
  SdmRenderContext,
} from './render';
import { resolveAssetSrc, paintToBackground } from './style';
import { SdmInteractionLayer } from './SdmInteractionLayer';
import type {
  SdmTextCaretPoint,
  SdmTextEditorOptions,
} from './SdmTextEditor';
import { SDM_BASE_URL, sdmWidgetModules } from './sdmRuntime';
import { useSdmRuntimeSession } from './session';

interface Props {
  slideId: string;
  initialDocument: unknown;
}

interface ParsedState {
  document: SlideDocument | null;
  error: string | null;
}

const RENDER_CONTEXT = {
  baseUrl: SDM_BASE_URL,
  widgets: sdmWidgetModules,
};

function describeParseFailure(
  result: Exclude<ParseSlideDocumentResult, { ok: true }>,
): string {
  if (result.reason === 'unsupportedVersion') {
    return `document version ${result.version} is newer than this runtime supports`;
  }

  return result.issues
    .slice(0, 8)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
}

function tryParse(input: unknown): ParsedState {
  const result = parseSlideDocument(input);
  if (result.ok) {
    return { document: result.document, error: null };
  }

  return { document: null, error: describeParseFailure(result) };
}

function useStageScale(
  rootRef: RefObject<HTMLDivElement | null>,
  size: { width: number; height: number },
): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const update = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (w > 0 && h > 0) {
        setScale(Math.min(w / size.width, h / size.height));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);

    return () => observer.disconnect();
  }, [rootRef, size.height, size.width]);

  return scale;
}

export function SdmSlide({ slideId, initialDocument }: Props) {
  const [state, setState] = useState<ParsedState>(() =>
    tryParse(initialDocument),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const document = state.document;
  const documentRef = useRef(document);
  documentRef.current = document;
  const size = document?.size ?? { width: 1920, height: 1080 };
  const scale = useStageScale(rootRef, size);

  useEffect(() => {
    ensureRegistryFontsStylesheet();
  }, []);

  const handleDocumentReplaced = useCallback((next: SlideDocument) => {
    documentRef.current = next;
    setState({ document: next, error: null });
  }, []);
  const textCommandHandlerRef = useRef<
    ((command: SdmTextCommand) => boolean) | null
  >(null);
  const textCommitHandlerRef = useRef<(() => void) | null>(null);
  const textPlacementHandlerRef = useRef<
    ((point: SdmTextCaretPoint) => void) | null
  >(null);
  const textCaretElementIdRef = useRef<string | null>(null);
  const handleTextCommand = useCallback(
    (elementId: string, command: SdmTextCommand): boolean => {
      if (elementId !== textCaretElementIdRef.current) {
        return false;
      }

      return textCommandHandlerRef.current?.(command) ?? false;
    },
    [],
  );
  const handleBeforeTextCaretExit = useCallback(() => {
    textCommitHandlerRef.current?.();
  }, []);
  const {
    editing,
    selectedIds,
    textCaretElementId,
    viewportScale,
    select,
    activateTextCaret,
    exitTextCaret,
    reportTextSelection,
    commit,
    requestHistory,
    forwardKey,
    requestContextMenu,
  } = useSdmRuntimeSession({
      slideId,
      document,
      onBeforeTextCaretExit: handleBeforeTextCaretExit,
      onDocumentReplaced: handleDocumentReplaced,
      onTextCommand: handleTextCommand,
    });
  textCaretElementIdRef.current = textCaretElementId;
  const [textCaretPoint, setTextCaretPoint] =
    useState<SdmTextCaretPoint | null>(null);
  const handleActivateTextCaret = useCallback(
    (elementId: string, point: SdmTextCaretPoint) => {
      setTextCaretPoint(point);
      const activated = activateTextCaret(elementId);
      if (!activated) {
        setTextCaretPoint(null);
      }

      return activated;
    },
    [activateTextCaret],
  );
  const handleExitTextCaret = useCallback(() => {
    setTextCaretPoint(null);
    exitTextCaret();

    return documentRef.current;
  }, [exitTextCaret]);
  const handlePlaceTextCaret = useCallback((point: SdmTextCaretPoint) => {
    const handler = textPlacementHandlerRef.current;
    if (handler === null) {
      return false;
    }
    handler(point);

    return true;
  }, []);
  const textEditor = useMemo<SdmTextEditorOptions | undefined>(() => {
    if (document === null || textCaretElementId === null) {
      return undefined;
    }

    return {
      initialPoint: textCaretPoint,
      onCancel: handleExitTextCaret,
      onCommit: (body: TextBody) => {
        const currentDocument = documentRef.current;
        if (currentDocument === null) {
          return;
        }
        const nextDocument = updateElement(
          currentDocument,
          textCaretElementId,
          (element) =>
            (element.type === 'text' || element.type === 'shape') &&
            element.body !== body
              ? { ...element, body }
              : element,
        );
        if (nextDocument !== currentDocument) {
          // The caret session survives its own commits; exits are explicit
          // (Escape, outside click, selection change).
          commit(nextDocument, [textCaretElementId], { keepTextCaret: true });
        }
      },
      onSelectionChange: (formatting) => {
        reportTextSelection(textCaretElementId, formatting);
      },
      registerCommitHandler: (handler) => {
        textCommitHandlerRef.current = handler;

        return () => {
          if (textCommitHandlerRef.current === handler) {
            textCommitHandlerRef.current = null;
          }
        };
      },
      registerCommandHandler: (handler) => {
        textCommandHandlerRef.current = handler;

        return () => {
          if (textCommandHandlerRef.current === handler) {
            textCommandHandlerRef.current = null;
          }
        };
      },
      registerPlacementHandler: (handler) => {
        textPlacementHandlerRef.current = handler;

        return () => {
          if (textPlacementHandlerRef.current === handler) {
            textPlacementHandlerRef.current = null;
          }
        };
      },
    };
  }, [
    commit,
    document,
    handleBeforeTextCaretExit,
    handleExitTextCaret,
    reportTextSelection,
    textCaretElementId,
    textCaretPoint,
  ]);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    if (textCaretElementId === null) {
      setTextCaretPoint(null);
    }
  }, [textCaretElementId]);

  const lastReportedCaretRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastReportedCaretRef.current;
    if (previous !== null && previous !== textCaretElementId) {
      reportTextSelection(previous, null);
    }
    lastReportedCaretRef.current = textCaretElementId;
  }, [reportTextSelection, textCaretElementId]);

  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) {
      return;
    }
    const handler = (data: { slideId?: string; document?: unknown }) => {
      if (data?.slideId !== slideId || !data.document || editingRef.current) {
        return;
      }
      setState(tryParse(data.document));
    };
    hot.on('sdm:documentChanged', handler);

    return () => hot.off('sdm:documentChanged', handler);
  }, [slideId]);

  const handleAction = useCallback((action: Action) => {
    window.postMessage({ type: 'sdm:action', action }, '*');
  }, []);

  const background = document
    ? paintToBackground(document.background, document.theme, (assetId) =>
        resolveAssetSrc(document.assets, assetId, SDM_BASE_URL),
      )
    : undefined;
  const stageBackground = document
    ? (backgroundValue(background) ?? '#ffffff')
    : '#1a1a1a';

  return (
    <SdmRenderContext.Provider value={RENDER_CONTEXT}>
      <div
        ref={rootRef}
        className="relative w-screen h-screen overflow-hidden"
        style={{ background: stageBackground }}
        data-sdm-slide-id={slideId}
        data-sdm-ready="true"
        data-sdm-editing={editing ? 'true' : undefined}
      >
        <div
          ref={stageRef}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: size.width,
            height: size.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center center',
            background: stageBackground,
            overflow: 'hidden',
          }}
        >
          <PaintLayer resolved={background} />
          {document?.elements.map((element) => (
            <SdmElementView
              key={element.id}
              element={element}
              document={document}
              onAction={handleAction}
              textEditor={
                textCaretElementId === element.id ? textEditor : undefined
              }
            />
          ))}
          {editing && document ? (
            <SdmInteractionLayer
              document={document}
              selectedIds={selectedIds}
              scale={scale}
              viewportScale={viewportScale}
              stageRef={stageRef}
              onSelect={select}
              textCaretElementId={textCaretElementId}
              onActivateTextCaret={handleActivateTextCaret}
              onExitTextCaret={handleExitTextCaret}
              onPlaceTextCaret={handlePlaceTextCaret}
              onCommit={commit}
              onHistory={requestHistory}
              onForwardKey={forwardKey}
              onContextMenuRequest={requestContextMenu}
            />
          ) : null}
        </div>

        {state.error ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 40,
              color: '#fca5a5',
              fontFamily: 'monospace',
              fontSize: 16,
              textAlign: 'center',
            }}
          >
            Invalid SDM slide “{slideId}”: {state.error}
          </div>
        ) : null}
      </div>
    </SdmRenderContext.Provider>
  );
}
