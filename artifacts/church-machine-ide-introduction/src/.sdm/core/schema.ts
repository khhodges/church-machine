import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const SDM_FORMAT = 'replit.sdm';
export const SDM_VERSION = 1;
export const SDM_SLIDE_WIDTH = 1920;
export const SDM_SLIDE_HEIGHT = 1080;
export const SDM_POINT_TO_UNIT = 2;
export const SDM_DEFAULT_TEXT_SIZE_PT = 18;

const strict = { additionalProperties: false } as const;
const finiteNumber = Type.Number();
const unitInterval = Type.Number({ minimum: 0, maximum: 1 });
const colorHex = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });

/* Each embedding gets its own recursive instance with a distinct explicit $id:
 * a shared instance would emit the same $id twice in sdm.schema.yaml, which
 * JSON Schema resolvers may reject as a duplicate identifier. */
function jsonValueSchema($id: string) {
  return Type.Recursive(
    (Self) =>
      Type.Union([
        Type.Null(),
        Type.Boolean(),
        Type.Number(),
        Type.String(),
        Type.Array(Self),
        Type.Record(Type.String(), Self),
      ]),
    { $id },
  );
}

export const JsonValueSchema = jsonValueSchema('SdmJsonValue');

export const SizeSchema = Type.Object(
  {
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
  },
  strict,
);

export const FrameSchema = Type.Object(
  {
    x: finiteNumber,
    y: finiteNumber,
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
  },
  strict,
);

export const InsetsSchema = Type.Object(
  {
    top: Type.Number({ minimum: 0 }),
    right: Type.Number({ minimum: 0 }),
    bottom: Type.Number({ minimum: 0 }),
    left: Type.Number({ minimum: 0 }),
  },
  strict,
);

export const PointSchema = Type.Object(
  { x: finiteNumber, y: finiteNumber },
  strict,
);

export const ColorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('token'),
      token: Type.String({ minLength: 1 }),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('rgb'),
      value: colorHex,
    },
    strict,
  ),
]);

export const FontSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('token'),
      token: Type.String({ minLength: 1 }),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('family'),
      family: Type.String({ minLength: 1 }),
    },
    strict,
  ),
]);

export const PaintSchema = Type.Union([
  Type.Object({ kind: Type.Literal('none') }, strict),
  Type.Object(
    {
      kind: Type.Literal('solid'),
      color: ColorSchema,
      opacity: Type.Optional(unitInterval),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('linearGradient'),
      angleDeg: finiteNumber,
      stops: Type.Array(
        Type.Object(
          {
            offset: unitInterval,
            color: ColorSchema,
            opacity: Type.Optional(unitInterval),
          },
          strict,
        ),
        { minItems: 2 },
      ),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('image'),
      assetId: Type.String({ minLength: 1 }),
      fit: Type.Union([
        Type.Literal('cover'),
        Type.Literal('contain'),
        Type.Literal('fill'),
      ]),
      opacity: Type.Optional(unitInterval),
    },
    strict,
  ),
]);

export const StrokeSchema = Type.Object(
  {
    color: ColorSchema,
    widthPt: Type.Number({ minimum: 0 }),
    opacity: Type.Optional(unitInterval),
    dash: Type.Optional(
      Type.Union([
        Type.Literal('solid'),
        Type.Literal('dash'),
        Type.Literal('dot'),
      ]),
    ),
    cap: Type.Optional(
      Type.Union([
        Type.Literal('flat'),
        Type.Literal('round'),
        Type.Literal('square'),
      ]),
    ),
    startArrow: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('triangle'),
        Type.Literal('stealth'),
        Type.Literal('diamond'),
        Type.Literal('oval'),
      ]),
    ),
    endArrow: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('triangle'),
        Type.Literal('stealth'),
        Type.Literal('diamond'),
        Type.Literal('oval'),
      ]),
    ),
  },
  strict,
);

export const ActionSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('openUrl'),
      url: Type.String({ minLength: 1 }),
      tooltip: Type.Optional(Type.String()),
      target: Type.Optional(
        Type.Union([Type.Literal('sameWindow'), Type.Literal('newWindow')]),
      ),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('goToSlide'),
      slideId: Type.String({ minLength: 1 }),
      tooltip: Type.Optional(Type.String()),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('goToRelativeSlide'),
      target: Type.Union([
        Type.Literal('next'),
        Type.Literal('previous'),
        Type.Literal('first'),
        Type.Literal('last'),
      ]),
      tooltip: Type.Optional(Type.String()),
    },
    strict,
  ),
]);

const runStyleProperties = {
  font: Type.Optional(FontSchema),
  sizePt: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  weight: Type.Optional(Type.Integer({ minimum: 100, maximum: 900 })),
  italic: Type.Optional(Type.Boolean()),
  underline: Type.Optional(Type.Boolean()),
  strike: Type.Optional(Type.Boolean()),
  color: Type.Optional(ColorSchema),
  highlight: Type.Optional(ColorSchema),
  letterSpacingPt: Type.Optional(finiteNumber),
};

export const RunStyleSchema = Type.Object(runStyleProperties, strict);

export const TextRunSchema = Type.Object(
  {
    text: Type.String(),
    ...runStyleProperties,
    action: Type.Optional(ActionSchema),
  },
  strict,
);

export const SDM_MAX_NUMBER_START_AT = 32767;

export const BulletSchema = Type.Union(
  [
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
        style: Type.Optional(
          Type.String({
            minLength: 1,
            description:
              'Numeral family (arabic, alphaUc, alphaLc, romanUc, romanLc) ' +
              'plus suffix (Period, ParenR, ParenBoth, Plain). Unrecognized ' +
              'families render arabic with the matching suffix.',
            examples: [
              'arabicPeriod',
              'arabicParenR',
              'arabicParenBoth',
              'arabicPlain',
              'alphaUcPeriod',
              'alphaLcPeriod',
              'alphaUcParenR',
              'alphaLcParenR',
              'romanUcPeriod',
              'romanLcPeriod',
              'romanUcParenR',
              'romanLcParenR',
            ],
          }),
        ),
        startAt: Type.Optional(
          Type.Integer({ minimum: 1, maximum: SDM_MAX_NUMBER_START_AT }),
        ),
      },
      strict,
    ),
  ],
  {
    description: 'Paragraph-local bullet formatting.',
  },
);

export const ParagraphSchema = Type.Object(
  {
    runs: Type.Array(TextRunSchema),
    defaultRunStyle: Type.Optional(RunStyleSchema),
    markerStyle: Type.Optional(RunStyleSchema),
    align: Type.Optional(
      Type.Union([
        Type.Literal('left'),
        Type.Literal('center'),
        Type.Literal('right'),
        Type.Literal('justify'),
      ]),
    ),
    level: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
    bullet: Type.Optional(BulletSchema),
    lineHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    spaceBeforePt: Type.Optional(Type.Number({ minimum: 0 })),
    spaceAfterPt: Type.Optional(Type.Number({ minimum: 0 })),
    indentPt: Type.Optional(Type.Number({ minimum: 0 })),
    hangingIndentPt: Type.Optional(Type.Number({ minimum: 0 })),
  },
  strict,
);

export const TextBodySchema = Type.Object(
  {
    paragraphs: Type.Array(ParagraphSchema),
    verticalAlign: Type.Optional(
      Type.Union([
        Type.Literal('top'),
        Type.Literal('middle'),
        Type.Literal('bottom'),
      ]),
    ),
    overflow: Type.Optional(
      Type.Union([Type.Literal('clip'), Type.Literal('visible')]),
    ),
    insetsPt: Type.Optional(InsetsSchema),
  },
  strict,
);

export const GeometrySchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('preset'),
      preset: Type.String({ minLength: 1 }),
      cornerRadius: Type.Optional(Type.Number({ minimum: 0 })),
      adjustments: Type.Optional(Type.Record(Type.String(), finiteNumber)),
    },
    strict,
  ),
  Type.Object(
    {
      kind: Type.Literal('path'),
      viewBox: SizeSchema,
      path: Type.String({ minLength: 1 }),
    },
    strict,
  ),
]);

const elementBase = {
  id: Type.String({ minLength: 1, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' }),
  name: Type.Optional(Type.String()),
  frame: FrameSchema,
  rotationDeg: Type.Optional(finiteNumber),
  flipH: Type.Optional(Type.Boolean()),
  flipV: Type.Optional(Type.Boolean()),
  opacity: Type.Optional(unitInterval),
  hidden: Type.Optional(Type.Boolean()),
  locked: Type.Optional(Type.Boolean()),
  altText: Type.Optional(Type.String()),
  action: Type.Optional(ActionSchema),
};

export const ElementSchema = Type.Recursive(
  (Element) =>
    Type.Union([
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('text'),
          body: TextBodySchema,
          fill: Type.Optional(PaintSchema),
          stroke: Type.Optional(StrokeSchema),
        },
        strict,
      ),
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('shape'),
          geometry: GeometrySchema,
          fill: PaintSchema,
          stroke: Type.Optional(StrokeSchema),
          body: Type.Optional(TextBodySchema),
        },
        strict,
      ),
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('image'),
          assetId: Type.String({ minLength: 1 }),
          fit: Type.Union([
            Type.Literal('cover'),
            Type.Literal('contain'),
            Type.Literal('fill'),
          ]),
          crop: Type.Optional(InsetsSchema),
        },
        strict,
      ),
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('line'),
          points: Type.Array(PointSchema, { minItems: 2 }),
          stroke: StrokeSchema,
        },
        strict,
      ),
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('group'),
          coordinateSpace: SizeSchema,
          children: Type.Array(Element),
          clip: Type.Optional(Type.Boolean()),
        },
        strict,
      ),
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('table'),
          columns: Type.Array(
            Type.Object(
              { width: Type.Number({ exclusiveMinimum: 0 }) },
              strict,
            ),
            { minItems: 1 },
          ),
          rows: Type.Array(
            Type.Object(
              {
                height: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                cells: Type.Array(
                  Type.Object(
                    {
                      body: TextBodySchema,
                      fill: Type.Optional(PaintSchema),
                      colSpan: Type.Optional(Type.Integer({ minimum: 1 })),
                      rowSpan: Type.Optional(Type.Integer({ minimum: 1 })),
                    },
                    strict,
                  ),
                ),
              },
              strict,
            ),
          ),
        },
        strict,
      ),
      Type.Object(
        {
          ...elementBase,
          type: Type.Literal('widget'),
          widget: Type.Object(
            {
              module: Type.String({
                pattern: '^\\./widgets/[A-Za-z0-9_/-]+\\.tsx$',
              }),
              exportName: Type.Optional(Type.String({ minLength: 1 })),
              props: Type.Optional(
                Type.Record(
                  Type.String(),
                  jsonValueSchema('SdmWidgetPropValue'),
                ),
              ),
              sizing: Type.Optional(Type.Literal('fill')),
              export: Type.Optional(
                Type.Object(
                  {
                    mode: Type.Union([
                      Type.Literal('snapshot'),
                      Type.Literal('svg'),
                    ]),
                  },
                  strict,
                ),
              ),
            },
            strict,
          ),
        },
        strict,
      ),
    ]),
  { $id: 'SdmElement' },
);

export const AssetSchema = Type.Object(
  {
    src: Type.String({ minLength: 1 }),
    mimeType: Type.Optional(Type.String()),
    width: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    height: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    sha256: Type.Optional(Type.String()),
  },
  strict,
);

export const ThemeSchema = Type.Object(
  {
    colors: Type.Record(Type.String(), colorHex),
    fonts: Type.Record(Type.String(), Type.String({ minLength: 1 })),
  },
  strict,
);

export const SlideDocumentSchema = Type.Object(
  {
    format: Type.Literal(SDM_FORMAT),
    version: Type.Literal(SDM_VERSION),
    size: SizeSchema,
    background: PaintSchema,
    theme: Type.Optional(ThemeSchema),
    assets: Type.Optional(Type.Record(Type.String(), AssetSchema)),
    elements: Type.Array(ElementSchema),
    extensions: Type.Optional(Type.Record(Type.String(), JsonValueSchema)),
  },
  strict,
);

export type JsonValue = Static<typeof JsonValueSchema>;
export type Size = Static<typeof SizeSchema>;
export type Frame = Static<typeof FrameSchema>;
export type Insets = Static<typeof InsetsSchema>;
export type Point = Static<typeof PointSchema>;
export type Color = Static<typeof ColorSchema>;
export type Font = Static<typeof FontSchema>;
export type Paint = Static<typeof PaintSchema>;
export type Stroke = Static<typeof StrokeSchema>;
export type Action = Static<typeof ActionSchema>;
export type RunStyle = Static<typeof RunStyleSchema>;
export type TextRun = Static<typeof TextRunSchema>;
export type Bullet = Static<typeof BulletSchema>;
export type Paragraph = Static<typeof ParagraphSchema>;
export type TextBody = Static<typeof TextBodySchema>;
export type Geometry = Static<typeof GeometrySchema>;
export type Element = Static<typeof ElementSchema>;
export type Asset = Static<typeof AssetSchema>;
export type Theme = Static<typeof ThemeSchema>;
export type SlideDocument = Static<typeof SlideDocumentSchema>;

export type SdmIssue = {
  path: string;
  message: string;
};

export type ParseSlideDocumentResult =
  | { ok: true; document: SlideDocument }
  | { ok: false; reason: 'invalid'; issues: Array<SdmIssue> }
  | { ok: false; reason: 'unsupportedVersion'; version: number };

type SchemaValueError =
  ReturnType<typeof Value.Errors> extends Iterable<infer Error> ? Error : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unionBranches(schema: unknown): Array<unknown> | undefined {
  if (!isRecord(schema) || !Array.isArray(schema.anyOf)) {
    return undefined;
  }

  return schema.anyOf;
}

function branchLiteral(branch: unknown, property?: string): unknown {
  if (!isRecord(branch)) {
    return undefined;
  }
  let schema: unknown = branch;
  if (property !== undefined) {
    schema = isRecord(branch.properties)
      ? branch.properties[property]
      : undefined;
  }

  return isRecord(schema) ? schema.const : undefined;
}

function formatOptions(options: Array<unknown>): string {
  return options.map((option) => JSON.stringify(option)).join(' | ');
}

function unionLabel(options: Array<unknown>): string {
  const values = new Set(options);
  if (values.has('text') && values.has('shape') && values.has('image')) {
    return 'element';
  }
  if (values.has('token') && values.has('rgb')) {
    return 'color';
  }
  if (values.has('none') && values.has('solid')) {
    return 'paint';
  }
  if (values.has('token') && values.has('family')) {
    return 'font';
  }
  if (values.has('preset') && values.has('path')) {
    return 'geometry';
  }
  if (values.has('openUrl') && values.has('goToSlide')) {
    return 'action';
  }
  if (values.has('character') && values.has('number')) {
    return 'bullet';
  }

  return 'value';
}

function leafIssue(error: SchemaValueError): SdmIssue {
  const property = error.path.split('/').at(-1);
  if (error.message === 'Unexpected property' && property) {
    const hint =
      property === 'fontSize' ? ' Text size belongs on runs as "sizePt".' : '';

    return {
      path: error.path || '/',
      message: `unknown property "${property}".${hint}`,
    };
  }
  if (isRecord(error.schema) && error.schema.pattern === '^#[0-9A-Fa-f]{6}$') {
    return {
      path: error.path || '/',
      message: 'color must be a 6-digit hex like "#1A2B3C"',
    };
  }

  return {
    path: error.path || '/',
    message: error.message,
  };
}

function expandSchemaError(error: SchemaValueError): Array<SdmIssue> {
  const branches = unionBranches(error.schema);
  if (!branches || error.errors.length !== branches.length) {
    return [leafIssue(error)];
  }

  for (const discriminator of ['type', 'kind']) {
    const options = branches.map((branch) =>
      branchLiteral(branch, discriminator),
    );
    if (options.some((option) => option === undefined)) {
      continue;
    }
    const label = unionLabel(options);
    if (!isRecord(error.value)) {
      return [
        {
          path: error.path || '/',
          message: `${label} must be an object with "${discriminator}" set to ${formatOptions(options)}`,
        },
      ];
    }
    const selected = error.value[discriminator];
    if (selected === undefined) {
      const wrongDiscriminator =
        discriminator === 'type' && error.value.kind !== undefined
          ? ' Elements use "type", not "kind".'
          : '';

      return [
        {
          path: `${error.path}/${discriminator}`,
          message: `missing "${discriminator}" discriminator.${wrongDiscriminator} Expected ${formatOptions(options)}`,
        },
      ];
    }
    const selectedIndex = options.indexOf(selected);
    if (selectedIndex === -1) {
      return [
        {
          path: `${error.path}/${discriminator}`,
          message: `unknown ${label} ${discriminator} ${JSON.stringify(selected)}; expected ${formatOptions(options)}`,
        },
      ];
    }

    return [...error.errors[selectedIndex]].flatMap(expandSchemaError);
  }

  const options = branches.map((branch) => branchLiteral(branch));
  if (options.every((option) => option !== undefined)) {
    return [
      {
        path: error.path || '/',
        message: `expected one of ${formatOptions(options)}`,
      },
    ];
  }

  return [leafIssue(error)];
}

export function isSlideDocument(input: unknown): input is SlideDocument {
  return Value.Check(SlideDocumentSchema, input);
}

function probeUnsupportedVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== SDM_FORMAT) {
    return undefined;
  }
  return typeof candidate.version === 'number' &&
    candidate.version > SDM_VERSION
    ? candidate.version
    : undefined;
}

function collectPaintIssues(
  paint: Paint | undefined,
  path: string,
  assets: Record<string, Asset>,
  issues: Array<SdmIssue>,
): void {
  if (paint?.kind === 'image' && !Object.hasOwn(assets, paint.assetId)) {
    issues.push({
      path,
      message: `references missing asset "${paint.assetId}"`,
    });
  }
}

function collectSemanticIssues(document: SlideDocument): Array<SdmIssue> {
  const issues: Array<SdmIssue> = [];
  const assets = document.assets ?? {};
  const seenIds = new Set<string>();

  collectPaintIssues(document.background, '/background', assets, issues);

  const visit = (elements: Array<Element>, basePath: string) => {
    elements.forEach((element, index) => {
      const path = `${basePath}/${index}`;
      if (seenIds.has(element.id)) {
        issues.push({
          path: `${path}/id`,
          message: `duplicate element id "${element.id}"`,
        });
      }
      seenIds.add(element.id);

      switch (element.type) {
        case 'text':
        case 'shape':
          collectPaintIssues(element.fill, `${path}/fill`, assets, issues);
          break;
        case 'image':
          if (!Object.hasOwn(assets, element.assetId)) {
            issues.push({
              path: `${path}/assetId`,
              message: `missing asset "${element.assetId}"`,
            });
          }
          break;
        case 'table':
          element.rows.forEach((row, rowIndex) => {
            row.cells.forEach((cell, cellIndex) => {
              collectPaintIssues(
                cell.fill,
                `${path}/rows/${rowIndex}/cells/${cellIndex}/fill`,
                assets,
                issues,
              );
            });
          });
          break;
        case 'group':
          visit(element.children, `${path}/children`);
          break;
        case 'line':
        case 'widget':
          break;
      }
    });
  };
  visit(document.elements, '/elements');

  return issues;
}

export function parseSlideDocument(input: unknown): ParseSlideDocumentResult {
  const futureVersion = probeUnsupportedVersion(input);
  if (futureVersion !== undefined) {
    return { ok: false, reason: 'unsupportedVersion', version: futureVersion };
  }

  if (!isSlideDocument(input)) {
    const issues = [...Value.Errors(SlideDocumentSchema, input)].flatMap(
      expandSchemaError,
    );
    return { ok: false, reason: 'invalid', issues };
  }

  const issues = collectSemanticIssues(input);
  if (issues.length > 0) {
    return { ok: false, reason: 'invalid', issues };
  }

  return { ok: true, document: input };
}
