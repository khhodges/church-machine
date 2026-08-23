import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const SlideKindSchema = Type.Union([Type.Literal('jsx'), Type.Literal('sdm')]);
const nonBlankString = Type.String({ pattern: '\\S' });
const slideManifestEntryProperties = {
  id: Type.String(),
  position: Type.Integer({ minimum: 1 }),
  kind: Type.Optional(SlideKindSchema),
  filepath: Type.String(),
  title: Type.String(),
  description: Type.String(),
  speakerNotes: Type.Optional(Type.String()),
};
const renderableSlideManifestEntryProperties = {
  ...slideManifestEntryProperties,
  id: nonBlankString,
  filepath: nonBlankString,
  title: nonBlankString,
  description: nonBlankString,
};

export const SlideManifestEntrySchema = Type.Object(
  slideManifestEntryProperties,
);
export const SlidesManifestSchema = Type.Array(SlideManifestEntrySchema);

const RenderableSlideManifestSchema = Type.Array(
  Type.Object(renderableSlideManifestEntryProperties),
);
const AuthoredSlideManifestSchema = Type.Array(
  Type.Object(renderableSlideManifestEntryProperties, {
    additionalProperties: false,
  }),
);

export type SlideManifestEntry = Static<typeof SlideManifestEntrySchema>;

export type SlideManifestIssue = {
  path: string;
  message: string;
};

export type SlideManifestParseResult =
  | { ok: true; entries: Array<SlideManifestEntry> }
  | { ok: false; issues: Array<SlideManifestIssue> };

function issuesFor(
  schema:
    | typeof RenderableSlideManifestSchema
    | typeof AuthoredSlideManifestSchema,
  input: unknown,
): Array<SlideManifestIssue> {
  return [...Value.Errors(schema, input)].map((error) => ({
    path: error.path,
    message: error.message,
  }));
}

function normalizeEntry(entry: SlideManifestEntry): SlideManifestEntry {
  return {
    ...entry,
    id: entry.id.trim(),
    filepath: entry.filepath.trim(),
    title: entry.title.trim(),
    description: entry.description.trim(),
    ...(entry.speakerNotes === undefined
      ? {}
      : { speakerNotes: entry.speakerNotes.trim() }),
  };
}

export function isSlidesManifest(
  input: unknown,
): input is Array<SlideManifestEntry> {
  return Value.Check(SlidesManifestSchema, input);
}

export function parseSlidesManifest(input: unknown): SlideManifestParseResult {
  if (!Value.Check(RenderableSlideManifestSchema, input)) {
    return {
      ok: false,
      issues: issuesFor(RenderableSlideManifestSchema, input),
    };
  }

  return { ok: true, entries: input.map(normalizeEntry) };
}

export function validateSlidesManifest(
  input: unknown,
): SlideManifestParseResult {
  if (!Value.Check(AuthoredSlideManifestSchema, input)) {
    return { ok: false, issues: issuesFor(AuthoredSlideManifestSchema, input) };
  }

  return { ok: true, entries: input.map(normalizeEntry) };
}
