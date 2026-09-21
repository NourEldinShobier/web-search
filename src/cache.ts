/** Disk cache so repeated searches and reads (often from parallel subagents) cost nothing. */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let db: Database | null | undefined;

function open(): Database | null {
  if (db !== undefined) return db;
  try {
    const dir = process.env.WEB_SEARCH_CACHE_DIR ?? join(homedir(), '.cache', 'web-search');
    mkdirSync(dir, { recursive: true });
    db = new Database(join(dir, 'cache.db'));
    db.run('PRAGMA journal_mode = WAL');
    db.run('CREATE TABLE IF NOT EXISTS c (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER NOT NULL)');
    // Prune week-old entries on ~2% of runs. Add a size cap if the file ever grows large.
    if (Math.random() < 0.02) db.run('DELETE FROM c WHERE t < ?', [Date.now() - 7 * 86_400_000]);
  } catch {
    db = null; // a broken cache must never break a search
  }
  return db;
}

export async function cached<T>(key: string, ttlMs: number, fresh: boolean, fn: () => Promise<T>): Promise<T> {
  const d = open();
  const k = Bun.hash(key).toString(36);
  if (d && !fresh) {
    const row = d.query('SELECT v, t FROM c WHERE k = ?').get(k) as { v: string; t: number } | null;
    if (row && Date.now() - row.t < ttlMs) return JSON.parse(row.v) as T;
  }
  const value = await fn();
  try {
    d?.run('INSERT OR REPLACE INTO c (k, v, t) VALUES (?, ?, ?)', [k, JSON.stringify(value), Date.now()]);
  } catch {}
  return value;
}
