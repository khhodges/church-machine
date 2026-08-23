import type { WidgetModule } from './render';

export const SDM_BASE_URL: string = import.meta.env.BASE_URL;

export const sdmWidgetModules: Record<string, WidgetModule> =
  import.meta.glob<WidgetModule>('../widgets/**/*.tsx', { eager: true });
