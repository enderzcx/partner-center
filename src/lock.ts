import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ProcessLock = {
  heartbeat(): void;
  release(): void;
  token: string;
};

type LockFile = {
  pid: number;
  token: string;
  heartbeat: number;
  startedAt: number;
};

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function readLock(path: string): LockFile | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockFile;
  } catch {
    return null;
  }
}

export function acquireProcessLock(
  path: string,
  opts?: { staleMs?: number; now?: () => number },
): ProcessLock {
  const staleMs = opts?.staleMs ?? 90_000;
  const now = opts?.now ?? Date.now;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = crypto.randomUUID();

  const writeExclusive = () => {
    const body: LockFile = {
      pid: process.pid,
      token,
      heartbeat: now(),
      startedAt: now(),
    };
    writeFileSync(path, JSON.stringify(body), { flag: 'wx', mode: 0o600 });
  };

  try {
    writeExclusive();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const existing = readLock(path);
    if (!existing) {
      try {
        unlinkSync(path);
      } catch {
        /* retry below */
      }
      try {
        writeExclusive();
      } catch {
        throw new Error('结算进程锁正在被占用。');
      }
    } else {
      const alive = pidAlive(existing.pid);
      const stale = now() - existing.heartbeat > staleMs;
      if (alive) {
        throw new Error(
          stale
            ? `结算进程锁由 pid ${existing.pid} 持有（心跳过期但进程仍在，拒绝抢占）。`
            : `结算进程锁由 pid ${existing.pid} 持有。`,
        );
      }
      if (!stale) {
        throw new Error(`结算进程锁由 pid ${existing.pid} 持有。`);
      }
      try {
        unlinkSync(path);
      } catch {
        /* raced */
      }
      try {
        writeExclusive();
      } catch {
        throw new Error('结算进程锁在过期回收时发生竞争，请重试。');
      }
    }
  }

  return {
    token,
    heartbeat() {
      const current = readLock(path);
      if (!current || current.token !== token) {
        throw new Error('结算进程锁已丢失。');
      }
      writeFileSync(
        path,
        JSON.stringify({ ...current, heartbeat: now(), pid: process.pid }),
        { mode: 0o600 },
      );
    },
    release() {
      if (!existsSync(path)) return;
      const current = readLock(path);
      if (current?.token === token) {
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
      }
    },
  };
}
