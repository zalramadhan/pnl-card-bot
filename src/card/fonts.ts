import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface LoadedFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 700;
  style: 'normal';
}

let cache: LoadedFont[] | null = null;

const FILES: Array<{ file: string; weight: 400 | 500 | 700 }> = [
  { file: 'JetBrainsMono-Regular.ttf', weight: 400 },
  { file: 'JetBrainsMono-Medium.ttf', weight: 500 },
  { file: 'JetBrainsMono-Bold.ttf', weight: 700 },
];

/** Loads the bundled JetBrains Mono faces once per process. */
export function loadFonts(): LoadedFont[] {
  if (cache) return cache;
  const fonts = FILES.map(({ file, weight }) => {
    const filePath = path.join(config.fontsDir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing font ${filePath}. Run "npm run fonts" to download JetBrains Mono.`);
    }
    return { name: 'JetBrains Mono', data: fs.readFileSync(filePath), weight, style: 'normal' as const };
  });
  cache = fonts;
  return fonts;
}
