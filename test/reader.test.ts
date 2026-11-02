import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives 5 jobs, sorted, and 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.badLines).toBe(1);
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts runs, retries and last status per job', () => {
    const byJob = Object.fromEntries(night!.rows.map((r) => [r.job, r]));
    expect(byJob['fixtures/refresh']).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob['lane/sync']).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held', owner: 'rook' });
    expect(byJob['notes/backup']).toMatchObject({ runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(byJob['rig/rotate-logs']).toMatchObject({ runs: 1, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00' });
  });

  it('keeps a null owner', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });

  it('counts valid lines per status', () => {
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight on a temp runs dir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('gives a night with no rows for an empty file', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps a null owner and skips blank lines', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00-05:00","job":"a","status":"ok","owner":null}',
      '',
      '{"at":"2026-01-03T02:00:00-05:00","job":"a","status":"fail","owner":null,"error":"boom"}',
      '',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\n'));
    const night = readNight(dir, '2026-01-03')!;
    expect(night.badLines).toBe(0);
    expect(night.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 2,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'boom',
        firstAt: '2026-01-03T01:00:00-05:00',
        lastAt: '2026-01-03T02:00:00-05:00',
      },
    ]);
  });

  it('counts invalid lines as bad, never throws', () => {
    const lines = [
      'not json',
      '[1,2]',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"maybe","owner":"x"}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok"}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok","owner":3}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok","owner":"x","error":42}',
      '{"at":"2026-01-04T01:00:00Z","job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-04T02:00:00Z","job":"a","sta',
    ];
    writeFileSync(join(dir, '2026-01-04.jsonl'), lines.join('\n'));
    const night = readNight(dir, '2026-01-04')!;
    expect(night.badLines).toBe(7);
    expect(night.rows).toHaveLength(1);
    expect(night.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });
});
