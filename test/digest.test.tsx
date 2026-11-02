import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { lane } from '../src/lane.js';

// Temp runs dir per test. runs/ is read-only and never touched here.
let runsDir: string;

const baseConfig = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

function appFor(dir: string) {
  return createApp({ ...baseConfig, runsDir: dir });
}

function night(name: string, body: string) {
  writeFileSync(join(runsDir, `${name}.jsonl`), body);
}

const line = (obj: Record<string, unknown>) => JSON.stringify(obj);

// Jobs written out of alphabetical order on purpose: notes, lane, fixtures.
// fixtures/refresh: 2 retries then ok. notes/backup: fail, owner null. lane/sync: one ok.
const FIXTURE_NIGHT = '2026-10-29';
const FIXTURE = [
  line({ at: '2026-10-29T04:00:01+01:00', job: 'notes/backup', status: 'fail', owner: null, error: 'quota exceeded' }),
  line({ at: '2026-10-29T02:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
  line({ at: '2026-10-29T01:30:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:31:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:37:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' }),
].join('\n') + '\n';

const FIXTURE_WITH_BAD_LINE = FIXTURE.replace(
  line({ at: '2026-10-29T02:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
  `{not json\n${line({ at: '2026-10-29T02:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' })}`,
);

// Job names in the order the page renders them, taken from the table body.
function pageJobOrder(html: string, jobs: string[]): string[] {
  const body = html.slice(html.indexOf('<tbody'), html.lastIndexOf('</tbody>'));
  return jobs
    .map((job) => ({ job, at: body.indexOf(job) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

function tbodyRowCount(html: string): number {
  const body = html.slice(html.indexOf('<tbody'), html.lastIndexOf('</tbody>'));
  return (body.match(/<tr[\s>]/g) ?? []).length;
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('answers 200 with the lane banner and one row per job', async () => {
    night(FIXTURE_NIGHT, FIXTURE);
    const res = await appFor(runsDir).request(`/digest/${FIXTURE_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(lane().id);
    expect(tbodyRowCount(html)).toBe(3);
    for (const job of ['fixtures/refresh', 'lane/sync', 'notes/backup']) {
      expect(html).toContain(job);
    }
    expect(html).toContain('+01:00');
    expect(html).toContain('—'); // owner null on notes/backup
  });

  it('answers 404 when no file exists for the night', async () => {
    const res = await appFor(runsDir).request('/digest/2001-01-01');
    expect(res.status).toBe(404);
  });

  it('answers 200 and "nothing ran" for an empty file', async () => {
    night('2026-10-30', '');
    const res = await appFor(runsDir).request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('answers 200 and renders the valid jobs when a line does not parse', async () => {
    night(FIXTURE_NIGHT, FIXTURE_WITH_BAD_LINE);
    const res = await appFor(runsDir).request(`/digest/${FIXTURE_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(tbodyRowCount(html)).toBe(3);
    expect(html).toContain('fixtures/refresh');
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
  });
});

describe('GET /api/digest/:night', () => {
  it('answers 200 with the rows sorted by job and the counts', async () => {
    night(FIXTURE_NIGHT, FIXTURE);
    const res = await appFor(runsDir).request(`/api/digest/${FIXTURE_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: FIXTURE_NIGHT,
      rows: [
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 3,
          retries: 2,
          lastStatus: 'ok',
          lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-29T02:00:00+01:00',
          lastAt: '2026-10-29T02:00:00+01:00',
        },
        {
          job: 'notes/backup',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00',
          lastAt: '2026-10-29T04:00:01+01:00',
        },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 2, fail: 1 },
    });
  });

  it('answers 404 when no file exists for the night', async () => {
    const res = await appFor(runsDir).request('/api/digest/2001-01-01');
    expect(res.status).toBe(404);
  });

  it('answers 200 with empty rows for an empty file', async () => {
    night('2026-10-30', '');
    const res = await appFor(runsDir).request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ night: '2026-10-30', rows: [], badLines: 0 });
  });

  it('counts a bad line and still returns the valid rows', async () => {
    night(FIXTURE_NIGHT, FIXTURE_WITH_BAD_LINE);
    const res = await appFor(runsDir).request(`/api/digest/${FIXTURE_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['fixtures/refresh', 'lane/sync', 'notes/backup']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    night(FIXTURE_NIGHT, FIXTURE);
    const app = appFor(runsDir);
    const page = await (await app.request(`/digest/${FIXTURE_NIGHT}`)).text();
    const json = (await (await app.request(`/api/digest/${FIXTURE_NIGHT}`)).json()) as {
      rows: { job: string }[];
    };
    const jsonJobs = json.rows.map((r) => r.job);
    expect(jsonJobs.length).toBeGreaterThanOrEqual(3);
    expect(jsonJobs).toEqual([...jsonJobs].sort());
    expect(pageJobOrder(page, jsonJobs)).toEqual(jsonJobs);
  });
});
