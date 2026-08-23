import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseWorkspaceToRuntimeMessage,
  SDM_PROTOCOL_VERSION,
  type RuntimeToWorkspaceMessage,
  type SdmContextMenuInvocation,
  type SdmTextCommand,
  type SdmTextSelectionFormatting,
} from './core/protocol';
import type { SlideDocument } from './core/schema';
import {
  clearActiveEditingSlide,
  setActiveEditingSlide,
} from './editingState';

const RUNTIME_CAPABILITIES: Array<string> = [
  'edit',
  'textCaret',
  'viewportScale',
  'contextMenu',
];

const TRUSTED_WORKSPACE_ORIGINS = new Set([
  'https://replit.com',
  'https://replit-staging.com',
  'https://staging.replit.com',
]);

interface SessionTarget {
  targetWindow: Window;
  origin: string;
  sessionId: string;
}

type ForwardedKeyEvent = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'code'
  | 'ctrlKey'
  | 'key'
  | 'metaKey'
  | 'repeat'
  | 'shiftKey'
>;

function isTrustedWorkspaceOrigin(origin: string): boolean {
  if (TRUSTED_WORKSPACE_ORIGINS.has(origin)) {
    return true;
  }

  try {
    const { hostname, protocol } = new URL(origin);

    return (
      (protocol === 'http:' &&
        (hostname === 'localhost' || hostname === '127.0.0.1')) ||
      (protocol === 'https:' &&
        hostname.startsWith('web--') &&
        hostname.endsWith('.z.zergrush.dev'))
    );
  } catch {
    return false;
  }
}

function findAncestorWindow(source: MessageEventSource | null): Window | null {
  if (source === null) {
    return null;
  }
  let ancestor: Window = window;
  while (ancestor.parent !== ancestor) {
    ancestor = ancestor.parent;
    if (source === ancestor) {
      return ancestor;
    }
  }

  return null;
}

function post(session: SessionTarget, message: RuntimeToWorkspaceMessage) {
  session.targetWindow.postMessage(message, session.origin);
}

export function useSdmRuntimeSession({
  slideId,
  document,
  onBeforeTextCaretExit,
  onDocumentReplaced,
  onTextCommand,
}: {
  slideId: string;
  document: SlideDocument | null;
  onBeforeTextCaretExit: () => void;
  onDocumentReplaced: (document: SlideDocument) => void;
  /**
   * Applies a workspace-routed formatting command to the live text caret;
   * returns whether an active caret on that element handled it.
   */
  onTextCommand?: (elementId: string, command: SdmTextCommand) => boolean;
}): {
  editing: boolean;
  selectedIds: Array<string>;
  textCaretElementId: string | null;
  /** Extra visual scale the workspace applies to the deck iframe; 1 when standalone. */
  viewportScale: number;
  select: (ids: Array<string>) => void;
  activateTextCaret: (elementId: string) => boolean;
  exitTextCaret: () => void;
  reportTextSelection: (
    elementId: string,
    formatting: SdmTextSelectionFormatting | null,
  ) => void;
  commit: (
    document: SlideDocument,
    selectedIds: Array<string>,
    options?: { keepTextCaret?: boolean },
  ) => void;
  requestHistory: (direction: 'undo' | 'redo') => void;
  forwardKey: (event: ForwardedKeyEvent) => boolean;
  requestContextMenu: (
    target: string | null,
    invocation: SdmContextMenuInvocation,
  ) => boolean;
} {
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Array<string>>([]);
  const [textCaretElementId, setTextCaretElementId] = useState<string | null>(
    null,
  );
  const [viewportScale, setViewportScale] = useState(1);
  const documentRef = useRef(document);
  documentRef.current = document;
  const onBeforeTextCaretExitRef = useRef(onBeforeTextCaretExit);
  onBeforeTextCaretExitRef.current = onBeforeTextCaretExit;
  const onDocumentReplacedRef = useRef(onDocumentReplaced);
  onDocumentReplacedRef.current = onDocumentReplaced;
  const onTextCommandRef = useRef(onTextCommand);
  onTextCommandRef.current = onTextCommand;
  const sessionRef = useRef<SessionTarget | null>(null);
  const revisionRef = useRef(0);
  const authorityReadyRef = useRef(false);
  const historyReadyRef = useRef(false);
  const workspaceCapabilitiesRef = useRef<ReadonlyArray<string>>([]);

  useEffect(() => {
    if (window.parent === window) {
      return;
    }
    window.parent.postMessage(
      {
        type: 'sdm:ready',
        supportedProtocolVersions: [SDM_PROTOCOL_VERSION],
        slideId,
        capabilities: RUNTIME_CAPABILITIES,
      } satisfies RuntimeToWorkspaceMessage,
      '*',
    );
  }, [slideId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const result = parseWorkspaceToRuntimeMessage(event.data);
      if (!result.ok) {
        return;
      }
      const message = result.message;
      if (message.slideId !== slideId) {
        return;
      }
      if (message.type === 'sdm:setEditMode') {
        if (message.enabled) {
          const ancestor = findAncestorWindow(event.source);
          const currentDocument = documentRef.current;
          if (
            ancestor === null ||
            currentDocument === null ||
            !isTrustedWorkspaceOrigin(event.origin)
          ) {
            return;
          }
          onBeforeTextCaretExitRef.current();
          const session: SessionTarget = {
            targetWindow: ancestor,
            origin: event.origin,
            sessionId: message.sessionId,
          };
          sessionRef.current = session;
          revisionRef.current = 0;
          authorityReadyRef.current = false;
          historyReadyRef.current = false;
          workspaceCapabilitiesRef.current = [];
          setEditing(false);
          setSelectedIds([]);
          setTextCaretElementId(null);
          setViewportScale(1);
          clearActiveEditingSlide(slideId);
          post(session, {
            type: 'sdm:ready',
            supportedProtocolVersions: [SDM_PROTOCOL_VERSION],
            slideId,
            sessionId: session.sessionId,
            capabilities: RUNTIME_CAPABILITIES,
          });
          post(session, {
            type: 'sdm:doc',
            protocolVersion: SDM_PROTOCOL_VERSION,
            slideId,
            sessionId: session.sessionId,
            document: currentDocument,
            selectedIds: [],
          });

          return;
        }
        const session = sessionRef.current;
        if (
          session === null ||
          session.sessionId !== message.sessionId ||
          event.source !== session.targetWindow
        ) {
          return;
        }
        onBeforeTextCaretExitRef.current();
        sessionRef.current = null;
        authorityReadyRef.current = false;
        historyReadyRef.current = false;
        workspaceCapabilitiesRef.current = [];
        setEditing(false);
        setSelectedIds([]);
        setTextCaretElementId(null);
        setViewportScale(1);
        clearActiveEditingSlide(slideId);

        return;
      }

      const session = sessionRef.current;
      if (
        session === null ||
        session.sessionId !== message.sessionId ||
        event.source !== session.targetWindow ||
        event.origin !== session.origin
      ) {
        return;
      }
      if (message.type === 'sdm:setDoc') {
        revisionRef.current = message.logicalRevision;
        authorityReadyRef.current = true;
        setTextCaretElementId(null);
        setSelectedIds(message.selectedIds);
        onDocumentReplacedRef.current(message.document);
        setEditing(true);
        setActiveEditingSlide(slideId);

        return;
      }
      if (message.type === 'sdm:select') {
        onBeforeTextCaretExitRef.current();
        setTextCaretElementId(null);
        setSelectedIds(message.selectedIds);

        return;
      }
      if (message.type === 'sdm:editText') {
        if (!authorityReadyRef.current) {
          return;
        }
        const element = documentRef.current?.elements.find(
          (candidate) => candidate.id === message.elementId,
        );
        if (
          element === undefined ||
          (element.type !== 'text' &&
            (element.type !== 'shape' || element.body === undefined)) ||
          element.locked
        ) {
          return;
        }
        setSelectedIds([element.id]);
        setTextCaretElementId(element.id);

        return;
      }
      if (message.type === 'sdm:textCommand') {
        if (!authorityReadyRef.current) {
          return;
        }
        const handled =
          onTextCommandRef.current?.(message.elementId, message.command) ??
          false;
        if (!handled) {
          // Failsafe: tell the workspace this caret is gone so its
          // formatting controls fall back to whole-element updates.
          post(session, {
            type: 'sdm:textSelection',
            protocolVersion: SDM_PROTOCOL_VERSION,
            slideId,
            sessionId: session.sessionId,
            elementId: message.elementId,
            active: false,
          });
        }

        return;
      }
      if (message.type === 'sdm:historyReady') {
        historyReadyRef.current = true;

        return;
      }
      if (message.type === 'sdm:setViewportScale') {
        setViewportScale(message.scale);

        return;
      }
      if (message.type === 'sdm:workspaceCapabilities') {
        workspaceCapabilitiesRef.current = message.capabilities;
      }
    };
    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [slideId]);

  useEffect(
    () => () => {
      if (sessionRef.current !== null) {
        clearActiveEditingSlide(slideId);
      }
    },
    [slideId],
  );

  const select = useCallback(
    (ids: Array<string>) => {
      const session = sessionRef.current;
      if (session === null || !authorityReadyRef.current) {
        return;
      }
      onBeforeTextCaretExitRef.current();
      setTextCaretElementId(null);
      setSelectedIds(ids);
      post(session, {
        type: 'sdm:selectionChanged',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        selectedIds: ids,
      });
    },
    [slideId],
  );

  const activateTextCaret = useCallback(
    (elementId: string): boolean => {
      const session = sessionRef.current;
      const element = documentRef.current?.elements.find(
        (candidate) => candidate.id === elementId,
      );
      if (
        session === null ||
        !authorityReadyRef.current ||
        element === undefined ||
        (element.type !== 'text' &&
          (element.type !== 'shape' || element.body === undefined)) ||
        element.locked
      ) {
        return false;
      }
      setSelectedIds([elementId]);
      setTextCaretElementId(elementId);
      post(session, {
        type: 'sdm:selectionChanged',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        selectedIds: [elementId],
      });

      return true;
    },
    [slideId],
  );

  const exitTextCaret = useCallback(() => {
    onBeforeTextCaretExitRef.current();
    setTextCaretElementId(null);
  }, []);

  const reportTextSelection = useCallback(
    (
      elementId: string,
      formatting: SdmTextSelectionFormatting | null,
    ): void => {
      const session = sessionRef.current;
      if (session === null || !authorityReadyRef.current) {
        return;
      }
      post(session, {
        type: 'sdm:textSelection',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        elementId,
        active: formatting !== null,
        ...(formatting === null ? {} : { formatting }),
      });
    },
    [slideId],
  );

  const commit = useCallback(
    (
      nextDocument: SlideDocument,
      ids: Array<string>,
      options?: { keepTextCaret?: boolean },
    ) => {
      const session = sessionRef.current;
      if (session === null || !authorityReadyRef.current) {
        return;
      }
      if (options?.keepTextCaret !== true) {
        setTextCaretElementId(null);
      }
      setSelectedIds(ids);
      onDocumentReplacedRef.current(nextDocument);
      post(session, {
        type: 'sdm:committed',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        baseLogicalRevision: revisionRef.current,
        transactionId: crypto.randomUUID(),
        document: nextDocument,
        selectedIds: ids,
      });
      // Advance optimistically in lockstep with the workspace: accepted
      // commits are not echoed back. If the commit was stale the workspace
      // answers with an authoritative sdm:setDoc that resets this counter.
      revisionRef.current += 1;
    },
    [slideId],
  );

  const requestHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const session = sessionRef.current;
      if (
        session === null ||
        !authorityReadyRef.current ||
        !historyReadyRef.current
      ) {
        return;
      }
      authorityReadyRef.current = false;
      setEditing(false);
      setTextCaretElementId(null);
      post(session, {
        type: 'sdm:historyRequest',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        direction,
      });
    },
    [slideId],
  );

  const forwardKey = useCallback(
    (event: ForwardedKeyEvent): boolean => {
      const session = sessionRef.current;
      if (session === null || !authorityReadyRef.current) {
        return false;
      }
      post(session, {
        type: 'sdm:keydown',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });

      return true;
    },
    [slideId],
  );

  const requestContextMenu = useCallback(
    (target: string | null, invocation: SdmContextMenuInvocation): boolean => {
      const session = sessionRef.current;
      if (
        session === null ||
        !authorityReadyRef.current ||
        !workspaceCapabilitiesRef.current.includes('contextMenu')
      ) {
        return false;
      }
      post(session, {
        type: 'sdm:contextMenuRequest',
        protocolVersion: SDM_PROTOCOL_VERSION,
        slideId,
        sessionId: session.sessionId,
        baseLogicalRevision: revisionRef.current,
        target,
        invocation,
      });

      return true;
    },
    [slideId],
  );

  return {
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
  };
}
