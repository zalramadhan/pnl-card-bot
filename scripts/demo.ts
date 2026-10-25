import fs from 'node:fs';
import path from 'node:path';
import { renderCardPng } from '../src/card/render.js';
import { config } from '../src/config.js';
import { sampleSnapshot } from '../src/sample.js';

const samples = [
  { name: 'demo-profit', snapshot: sampleSnapshot() },
  {
    name: 'demo-loss',
    snapshot: sampleSnapshot({
      pair: 'BONK/SOL',
      closeReason: 'Stop Loss',
      dex: 'Robinhood',
      entryMcapUsd: 1_200_000,
      exitMcapUsd: 1_100_000,
      initialUsd: 200,
      receivedUsd: 188.8,
      durationSeconds: 8_700,
      range: '-20%',
      side: 'SOL',
      strategy: 'Bid/Ask',
      brand: 'BUDI',
    }),
  },
  {
    // Open position: unrealized label, no Exit MCAP row, missing values as N/A.
    name: 'demo-open',
    snapshot: sampleSnapshot({
      pair: 'WIF/SOL',
      closeReason: 'Manual',
      dex: 'Meteora',
      status: 'open',
      entryMcapUsd: null,
      initialUsd: 320,
      receivedUsd: 358.4,
      durationSeconds: 93_600,
      range: '+20% to -20%',
      side: 'Dual',
      strategy: 'Curve',
      currency: 'USD',
      brand: 'RANI',
    }),
  },
];

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const outDir = path.join(config.root, 'out');
fs.mkdirSync(outDir, { recursive: true });

for (const sample of samples) {
  const png = await renderCardPng(sample.snapshot);
  const file = path.join(outDir, `${sample.name}.png`);
  fs.writeFileSync(file, png);
  const { width, height } = pngSize(png);
  console.log(`${path.relative(config.root, file)}  ${width}x${height}  ${(png.length / 1024).toFixed(1)} KB`);
}
