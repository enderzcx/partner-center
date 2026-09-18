import { acquireProcessLock } from '../src/lock.ts';

const path = process.argv[2];
if (!path) throw new Error('missing lock path');
const lock = acquireProcessLock(path);
console.log('HELD');
const holdMs = Number(process.argv[3] ?? '30000');
await Bun.sleep(Number.isFinite(holdMs) ? holdMs : 30_000);
lock.release();
