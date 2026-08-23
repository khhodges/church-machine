import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

import { decodeYamlValue } from './core/serialization';

const SDM_FILE = /\/src\/data\/slides\/([^/]+)\.sdm\.yaml$/;

export function sdmVitePlugin(): Plugin {
  return {
    name: 'sdm-documents',
    enforce: 'pre',

    transform(code, id) {
      if (!SDM_FILE.test(id.replace(/\\/g, '/'))) {
        return null;
      }
      const decoded = decodeYamlValue(code);
      if (!decoded.ok) {
        throw new Error(decoded.message);
      }

      return {
        code: `export default ${JSON.stringify(decoded.value)};`,
        map: null,
      };
    },

    handleHotUpdate(ctx) {
      const match = SDM_FILE.exec(ctx.file.replace(/\\/g, '/'));
      if (!match) {
        return;
      }
      const decoded = decodeYamlValue(readFileSync(ctx.file, 'utf8'));
      if (!decoded.ok) {
        return;
      }
      ctx.server.ws.send({
        type: 'custom',
        event: 'sdm:documentChanged',
        data: { slideId: match[1], document: decoded.value },
      });

      return [];
    },
  };
}
