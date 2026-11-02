// Plan morning-digest § 1. The contract every part of § 2 starts against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string; // ISO 8601 with the log's own offset; never converted to UTC
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job in a night.
export type DigestRow = {
  job: string;
  owner: string | null; // null is kept; views render it as "—"
  runs: number; // lines for this job
  retries: number; // lines with status "retry"
  lastStatus: RunStatus;
  lastError: string | null; // the most recent error seen for this job
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse; counted, never thrown
  counts: Record<RunStatus, number>; // lines per status, for the board
};

// Returns null when runs/<night>.jsonl does not exist (routes answer 404).
// An empty file returns a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;

// Rows that need a reader's eye on the page.
export const RETRY_MARK_AT = 3;
