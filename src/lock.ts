import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type ProcessLock = {
  release(): void;
};

function isBusy(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const message = err instanceof Error ? err.message : String(err);
  return code === 'SQLITE_BUSY' || /database is locked|SQLITE_BUSY/i.test(message);
}

export function acquireProcessLock(path: string): ProcessLock {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let db: Database;
  try {
    db = new Database(path, { create: true });
  } catch {
    throw new Error('结算进程锁无法使用。');
  }
  try {
    db.exec('PRAGMA busy_timeout = 0;');
    db.exec('PRAGMA journal_mode = DELETE;');
    db.exec('BEGIN EXCLUSIVE;');
    db.exec(
      'CREATE TABLE IF NOT EXISTS lock (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL);',
    );
    db.run('INSERT OR REPLACE INTO lock (id, pid) VALUES (1, ?)', [process.pid]);
  } catch (err) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    if (isBusy(err)) throw new Error('结算进程锁正在被占用。');
    throw new Error('结算进程锁无法使用。');
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}
