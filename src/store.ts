import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { PositionSnapshot } from './card/types.js';

export interface StoredPosition {
  snapshot: PositionSnapshot;
  png: Buffer;
}

interface PositionRow {
  snapshot_json: string;
  png: Buffer;
}

/**
 * Closed positions are written once and read back verbatim: the stored PNG is
 * what gets re-sent, so a regenerated card can never drift from the original.
 */
export class PositionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        telegram_user_id TEXT,
        snapshot_json TEXT NOT NULL,
        png BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS positions_user_created
        ON positions (telegram_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_brands (
        telegram_user_id TEXT PRIMARY KEY,
        brand TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS calendar_cache (
        cache_key TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        caption TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  save(snapshot: PositionSnapshot, png: Buffer, telegramUserId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO positions (id, telegram_user_id, snapshot_json, png, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(snapshot.id, telegramUserId, JSON.stringify(snapshot), png, snapshot.createdAt);
  }

  get(id: string): StoredPosition | null {
    const row = this.db
      .prepare('SELECT snapshot_json, png FROM positions WHERE id = ?')
      .get(id) as PositionRow | undefined;
    if (!row) return null;
    return { snapshot: JSON.parse(row.snapshot_json) as PositionSnapshot, png: Buffer.from(row.png) };
  }

  list(telegramUserId: string, limit = 5): PositionSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT snapshot_json FROM positions
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(telegramUserId, limit) as Array<{ snapshot_json: string }>;
    return rows.map((row) => JSON.parse(row.snapshot_json) as PositionSnapshot);
  }

  /** Every closed position of one user, newest close first. */
  listClosed(telegramUserId: string): PositionSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT snapshot_json FROM positions
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(telegramUserId) as Array<{ snapshot_json: string }>;
    return rows
      .map((row) => JSON.parse(row.snapshot_json) as PositionSnapshot)
      .filter((position) => position.status === 'closed');
  }

  /** Changes whenever a position is added, so calendar caches invalidate themselves. */
  calendarVersion(telegramUserId: string): string {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total, MAX(created_at) AS newest FROM positions
         WHERE telegram_user_id = ?`,
      )
      .get(telegramUserId) as { total: number; newest: string | null };
    return `${row.total}:${row.newest ?? '-'}`;
  }

  getCalendarCache(cacheKey: string): { fileId: string; caption: string } | null {
    const row = this.db
      .prepare('SELECT file_id, caption FROM calendar_cache WHERE cache_key = ?')
      .get(cacheKey) as { file_id: string; caption: string } | undefined;
    return row ? { fileId: row.file_id, caption: row.caption } : null;
  }

  setCalendarCache(cacheKey: string, fileId: string, caption: string): void {
    this.db
      .prepare(
        `INSERT INTO calendar_cache (cache_key, file_id, caption, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET file_id = excluded.file_id, caption = excluded.caption`,
      )
      .run(cacheKey, fileId, caption, new Date().toISOString());
  }

  /** Drops cached calendar images for a user (called after a new card is saved). */
  clearCalendarCache(telegramUserId: string): void {
    this.db.prepare('DELETE FROM calendar_cache WHERE cache_key LIKE ?').run(`${telegramUserId}|%`);
  }

  /** Card brand chosen with /setname; null means "use the Telegram name". */
  getBrand(telegramUserId: string): string | null {
    const row = this.db
      .prepare('SELECT brand FROM user_brands WHERE telegram_user_id = ?')
      .get(telegramUserId) as { brand: string } | undefined;
    return row?.brand ?? null;
  }

  setBrand(telegramUserId: string, brand: string): void {
    this.db
      .prepare(
        `INSERT INTO user_brands (telegram_user_id, brand, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET brand = excluded.brand, updated_at = excluded.updated_at`,
      )
      .run(telegramUserId, brand, new Date().toISOString());
  }

  /** Drops the custom brand so the Telegram name is used again. */
  clearBrand(telegramUserId: string): void {
    this.db.prepare('DELETE FROM user_brands WHERE telegram_user_id = ?').run(telegramUserId);
  }

  close(): void {
    this.db.close();
  }
}
