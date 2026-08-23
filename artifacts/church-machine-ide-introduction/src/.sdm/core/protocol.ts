import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  BulletSchema,
  parseSlideDocument,
  RunStyleSchema,
  SDM_MAX_NUMBER_START_AT,
  SlideDocumentSchema,
  type SdmIssue,
} from './schema';

/**
 * Wire contract between the workspace (authoritative document, history,
 * editor UI) and the thin slide-iframe runtime (rendering, gestures, caret).
 * Types and strict parsers only — transport, handshake state, and nonce
 * issuance live with the consumers.
 */
export const SDM_PROTOCOL_VERSION = 1;

export type SdmSaveState = 'saving' | 'saved' | 'error';

export type SdmKnownCapability =
  | 'edit'
  | 'textCaret'
  | 'viewportScale'
  | 'contextMenu';

const strict = { additionalProperties: false } as const;

const envelope = {
  protocolVersion: Type.Literal(SDM_PROTOCOL_VERSION),
  slideId: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
};

const selectedIds = Type.Array(Type.String({ minLength: 1 }));

const capabilities = Type.Array(Type.String({ minLength: 1 }));

/**
 * How the runtime's context-menu interception was triggered. Keyboard
 * invocations (Shift+F10, Menu key) carry no usable coordinates — the
 * workspace anchors the menu at the selected elements' bounds instead.
 */
export const SdmContextMenuInvocationSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('pointer'),
      point: Type.Object(
        {
          x: Type.Number({ minimum: 0 }),
          y: Type.Number({ minimum: 0 }),
        },
        strict,
      ),
    },
    strict,
  ),
  Type.Object({ kind: Type.Literal('keyboard') }, strict),
]);

export type SdmContextMenuInvocation = Static<
  typeof SdmContextMenuInvocationSchema
>;

const textAlign = Type.Union([
  Type.Literal('left'),
  Type.Literal('center'),
  Type.Literal('right'),
  Type.Literal('justify'),
]);

/**
 * Bullet replacement carried by a `setBullet` text command. Number updates
 * may set an explicit restart (`startAt: null` clears it); omitted fields
 * preserve what the paragraphs already have.
 */
export const SdmTextBulletUpdateSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('character'),
      character: Type.String({
        minLength: 1,
        maxLength: 8,
        pattern: '^[^\\n\\r]+$',
      }),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('number'),
      style: Type.Optional(Type.String({ minLength: 1 })),
      startAt: Type.Optional(
        Type.Union([
          Type.Integer({ minimum: 1, maximum: SDM_MAX_NUMBER_START_AT }),
          Type.Null(),
        ]),
      ),
    },
    strict,
  ),
]);

/**
 * Formatting command the workspace routes to the runtime's live text caret.
 * The runtime applies it to the active ProseMirror view and answers with an
 * updated `sdm:textSelection`.
 */
export const SdmTextCommandSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('setRunStyle'), style: RunStyleSchema },
    strict,
  ),
  Type.Object({ kind: Type.Literal('setAlignment'), align: textAlign }, strict),
  Type.Object(
    {
      kind: Type.Literal('setParagraphSpacing'),
      lineHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      spaceAfterPt: Type.Optional(Type.Number({ minimum: 0 })),
      spaceBeforePt: Type.Optional(Type.Number({ minimum: 0 })),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('toggleBullets'),
      bulletKind: Type.Union([
        Type.Literal('character'),
        Type.Literal('number'),
      ]),
    },
    strict,
  ),
  Type.Object(
    { kind: Type.Literal('setBullet'), bullet: SdmTextBulletUpdateSchema },
    strict,
  ),
  Type.Object({ kind: Type.Literal('indent') }, strict),
  Type.Object({ kind: Type.Literal('outdent') }, strict),
  Type.Object({ kind: Type.Literal('undo') }, strict),
  Type.Object({ kind: Type.Literal('redo') }, strict),
]);

export type SdmTextCommand = Static<typeof SdmTextCommandSchema>;

/**
 * Effective formatting at the runtime caret's selection head, mirrored to
 * the workspace so formatting controls reflect the live selection.
 */
export const SdmTextSelectionFormattingSchema = Type.Object(
  {
    align: textAlign,
    bullet: Type.Union([BulletSchema, Type.Null()]),
    level: Type.Integer({ minimum: 0, maximum: 8 }),
    lineHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    runStyle: RunStyleSchema,
    spaceAfterPt: Type.Optional(Type.Number({ minimum: 0 })),
    spaceBeforePt: Type.Optional(Type.Number({ minimum: 0 })),
  },
  strict,
);

export type SdmTextSelectionFormatting = Static<
  typeof SdmTextSelectionFormattingSchema
>;

export const WorkspaceToRuntimeMessageSchema = Type.Union([
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:setEditMode'),
      enabled: Type.Boolean(),
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:setDoc'),
      logicalRevision: Type.Integer({ minimum: 0 }),
      document: SlideDocumentSchema,
      selectedIds,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:select'),
      selectedIds,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:editText'),
      elementId: Type.String({ minLength: 1 }),
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:textCommand'),
      elementId: Type.String({ minLength: 1 }),
      command: SdmTextCommandSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:historyReady'),
    },
    strict,
  ),
  /**
   * Extra visual scale the workspace applies to the deck iframe (CSS
   * transform), invisible to the runtime's own viewport measurements. The
   * runtime multiplies it into its stage scale so selection chrome stays
   * screen-constant. Sent only to runtimes advertising `viewportScale`.
   */
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:setViewportScale'),
      scale: Type.Number({ exclusiveMinimum: 0 }),
    },
    strict,
  ),
  /**
   * Capabilities this workspace can serve, mirroring `sdm:ready`'s runtime
   * capabilities. The runtime must not intercept behaviors the workspace
   * cannot answer (e.g. secondary click for `contextMenu`) — runtimes that
   * never receive this keep native behavior, which is how deployment skew
   * against an older workspace stays safe.
   */
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:workspaceCapabilities'),
      capabilities,
    },
    strict,
  ),
]);

export const RuntimeToWorkspaceMessageSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('sdm:ready'),
      supportedProtocolVersions: Type.Array(Type.Integer({ minimum: 1 }), {
        minItems: 1,
        uniqueItems: true,
      }),
      slideId: Type.String({ minLength: 1 }),
      sessionId: Type.Optional(Type.String({ minLength: 1 })),
      capabilities,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:doc'),
      document: SlideDocumentSchema,
      selectedIds,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:selectionChanged'),
      selectedIds,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:committed'),
      baseLogicalRevision: Type.Integer({ minimum: 0 }),
      transactionId: Type.String({ minLength: 1 }),
      document: SlideDocumentSchema,
      selectedIds,
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:historyRequest'),
      direction: Type.Union([Type.Literal('undo'), Type.Literal('redo')]),
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:textSelection'),
      elementId: Type.String({ minLength: 1 }),
      active: Type.Boolean(),
      formatting: Type.Optional(SdmTextSelectionFormattingSchema),
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:saveStatus'),
      state: Type.Union([
        Type.Literal('saving'),
        Type.Literal('saved'),
        Type.Literal('error'),
      ]),
      message: Type.Optional(Type.String()),
    },
    strict,
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:keydown'),
      key: Type.String(),
      code: Type.String(),
      repeat: Type.Boolean(),
      altKey: Type.Boolean(),
      ctrlKey: Type.Boolean(),
      metaKey: Type.Boolean(),
      shiftKey: Type.Boolean(),
    },
    strict,
  ),
  /**
   * Intercepted secondary click or keyboard menu invocation. The workspace
   * owns targeting and the menu UI: `target` is the hit root element (null
   * for empty canvas) and `point` is in slide-logical coordinates. Sent only
   * after both sides negotiated the `contextMenu` capability.
   */
  Type.Object(
    {
      ...envelope,
      type: Type.Literal('sdm:contextMenuRequest'),
      baseLogicalRevision: Type.Integer({ minimum: 0 }),
      target: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      invocation: SdmContextMenuInvocationSchema,
    },
    strict,
  ),
]);

export type WorkspaceToRuntimeMessage = Static<
  typeof WorkspaceToRuntimeMessageSchema
>;
export type RuntimeToWorkspaceMessage = Static<
  typeof RuntimeToWorkspaceMessageSchema
>;

export type ParseSdmMessageResult<Message> =
  | { ok: true; message: Message }
  | { ok: false; reason: 'invalid'; issues: Array<SdmIssue> }
  | { ok: false; reason: 'unsupportedVersion'; version: number };

export function isWorkspaceToRuntimeMessage(
  input: unknown,
): input is WorkspaceToRuntimeMessage {
  return parseWorkspaceToRuntimeMessage(input).ok;
}

export function isRuntimeToWorkspaceMessage(
  input: unknown,
): input is RuntimeToWorkspaceMessage {
  return parseRuntimeToWorkspaceMessage(input).ok;
}

function probeUnsupportedVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.type !== 'string' ||
    !candidate.type.startsWith('sdm:')
  ) {
    return undefined;
  }
  return typeof candidate.protocolVersion === 'number' &&
    Number.isInteger(candidate.protocolVersion) &&
    candidate.protocolVersion > SDM_PROTOCOL_VERSION
    ? candidate.protocolVersion
    : undefined;
}

function embeddedDocumentIssues(
  message: Record<string, unknown>,
): Array<SdmIssue> {
  if (!('document' in message)) {
    return [];
  }
  const result = parseSlideDocument(message.document);
  if (result.ok) {
    return [];
  }
  if (result.reason === 'invalid') {
    return result.issues.map((issue) => ({
      path: issue.path === '/' ? '/document' : `/document${issue.path}`,
      message: issue.message,
    }));
  }
  return [
    {
      path: '/document/version',
      message: `Unsupported SDM document version ${result.version}.`,
    },
  ];
}

function parseMessage<Message>(
  schema:
    | typeof WorkspaceToRuntimeMessageSchema
    | typeof RuntimeToWorkspaceMessageSchema,
  input: unknown,
): ParseSdmMessageResult<Message> {
  const futureVersion = probeUnsupportedVersion(input);
  if (futureVersion !== undefined) {
    return { ok: false, reason: 'unsupportedVersion', version: futureVersion };
  }
  if (!Value.Check(schema, input)) {
    const issues = [...Value.Errors(schema, input)].map((error) => ({
      path: error.path || '/',
      message: error.message,
    }));
    return { ok: false, reason: 'invalid', issues };
  }
  const documentIssues = embeddedDocumentIssues(
    input as Record<string, unknown>,
  );
  if (documentIssues.length > 0) {
    return { ok: false, reason: 'invalid', issues: documentIssues };
  }

  return { ok: true, message: input as Message };
}

export function parseWorkspaceToRuntimeMessage(
  input: unknown,
): ParseSdmMessageResult<WorkspaceToRuntimeMessage> {
  return parseMessage(WorkspaceToRuntimeMessageSchema, input);
}

export function parseRuntimeToWorkspaceMessage(
  input: unknown,
): ParseSdmMessageResult<RuntimeToWorkspaceMessage> {
  return parseMessage(RuntimeToWorkspaceMessageSchema, input);
}
