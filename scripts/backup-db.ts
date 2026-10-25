import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Hot backup of the bot database using SQLite's online backup API, so it is
 * safe to run while the bot is running (WAL and all).
 *
 *   DB_PATH=/var/lib/pnl-card-bot/pnl.sqlite \
 *   BACKUP_DIR=/var/backups/pnl-card-bot \
 *   BACKUP_KEEP_DAYS=14 npm run backup
 */
const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'pnl.sqlite');
const backupDir = process.env.BACKUP_DIR ?? path.join(path.dirname(dbPath), 'backups');
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 14);

if (!fs.existsSync(dbPath)) {
  console.error(`Database tidak ditemukan: ${dbPath}`);
  process.exit(1);
}
if (!Number.isFinite(keepDays) || keepDays <= 0) {
  console.error(`BACKUP_KEEP_DAYS tidak valid: ${process.env.BACKUP_KEEP_DAYS}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o750 });

const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
const target = path.join(backupDir, `pnl-${stamp}.sqlite`);

const source = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  await source.backup(target);
} finally {
  source.close();
}
// Verify the copy before calling it a backup, then leave it as a single
// self-contained file (no leftover -wal/-shm) that is easy to restore.
const copy = new Database(target);
try {
  const integrity = copy.pragma('integrity_check', { simple: true });
  const cards = (copy.prepare('SELECT COUNT(*) AS total FROM positions').get() as { total: number }).total;
  if (integrity !== 'ok') {
    console.error(`Backup rusak (${target}): ${String(integrity)}`);
    process.exit(1);
  }
  copy.pragma('journal_mode = DELETE');
  console.log(`Backup OK: ${target} (${cards} kartu)`);
} finally {
  copy.close();
}
for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
  if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
}
fs.chmodSync(target, 0o640);
console.log(`Ukuran: ${(fs.statSync(target).size / 1024).toFixed(1)} KB`);

// Retention: drop backups older than keepDays.
const cutoff = Date.now() - keepDays * 86_400_000;
let removed = 0;
for (const file of fs.readdirSync(backupDir)) {
  if (!/^pnl-.*\.sqlite$/.test(file)) continue;
  const filePath = path.join(backupDir, file);
  if (fs.statSync(filePath).mtimeMs < cutoff) {
    fs.unlinkSync(filePath);
    removed += 1;
  }
}
if (removed > 0) console.log(`Menghapus ${removed} backup lama (> ${keepDays} hari).`);
