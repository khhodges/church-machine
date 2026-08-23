import { createElement, type ComponentType } from 'react';
import manifestJson from '@/data/slides-manifest.json';
import { sdmSlideDocumentFilename } from '@/.sdm/core/serialization';
import {
  parseSlidesManifest,
  type SlideManifestEntry as SlideEntry,
} from '@/.sdm/core/slidesManifest';
import { SdmSlide } from '@/.sdm/SdmSlide';

export interface LoadedSlide extends SlideEntry {
  Component: ComponentType;
}

const slideModules: Record<string, { default: ComponentType }> =
  import.meta.glob('./pages/slides/*.tsx', { eager: true });

const sdmModules: Record<string, { default: unknown }> = import.meta.glob(
  './data/slides/*.sdm.yaml',
  { eager: true },
);

function loadManifestSlides(): SlideEntry[] {
  const parsed = parseSlidesManifest(manifestJson);
  if (parsed.ok) {
    return parsed.entries;
  }

  const firstIssue = parsed.issues[0];
  const issuePath = firstIssue?.path
    ? firstIssue.path.slice(1).replaceAll('/', '.')
    : 'manifest';
  throw new Error(
    `Invalid slide manifest. Run "pnpm run validate-slides" for details. ` +
      `Invalid manifest at ${issuePath}: ${firstIssue?.message}`,
  );
}

function errorSlide(entry: SlideEntry, message: string) {
  return function ErrorSlide() {
    return createElement(
      'div',
      {
        style: {
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          background: '#1a1a1a',
          color: '#fca5a5',
          fontFamily: 'monospace',
          fontSize: 16,
          textAlign: 'center',
          border: '4px solid #fca5a5',
          boxSizing: 'border-box',
        },
        'data-sdm-slide-id': entry.id,
      },
      message,
    );
  };
}

const manifestSlides = loadManifestSlides();

export const slides: LoadedSlide[] = [...manifestSlides]
  .sort((a, b) => a.position - b.position)
  .map((entry) => {
    if (entry.kind === 'sdm') {
      const filename = sdmSlideDocumentFilename(entry.id);
      const expectedPath = `src/data/slides/${filename}`;
      const key = `./data/slides/${filename}`;
      const mod = sdmModules[key];
      if (entry.filepath !== expectedPath || !mod) {
        return {
          ...entry,
          Component: errorSlide(
            entry,
            `Slide "${entry.id}" references a missing or inconsistent SDM document. Expected ${expectedPath}. ` +
              'Run "pnpm run validate-slides" for details.',
          ),
        };
      }
      const Component = () =>
        createElement(SdmSlide, {
          slideId: entry.id,
          initialDocument: mod.default,
        });

      return { ...entry, Component };
    }

    const filename = entry.filepath.split('/').pop();
    if (!filename) {
      return {
        ...entry,
        Component: errorSlide(
          entry,
          `Slide "${entry.title}" has an invalid filepath: "${entry.filepath}".`,
        ),
      };
    }

    const key = `./pages/slides/${filename}`;
    const mod = slideModules[key];

    if (!mod) {
      const available = Object.keys(slideModules).join(', ');

      return {
        ...entry,
        Component: errorSlide(
          entry,
          `Slide "${entry.title}" references missing file: ${entry.filepath}. ` +
            `Available modules: ${available}`,
        ),
      };
    }

    return {
      ...entry,
      Component: mod.default,
    };
  });
