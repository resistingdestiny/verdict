import * as fs from "fs";
import * as path from "path";
import { hashscanTransaction, transactionEvidence } from "./hashscan";

/**
 * The evidence ledger for the hand-run testnet scripts.
 *
 * Every paid step goes through `Ledger.step`, which records its outcome in the checkpoint file
 * `packages/hardhat/.testnet-run.json` the moment the transaction is mined. A rerun after a crash
 * sees the checkpoint and skips the step, so no HBAR is spent twice. `flush` then turns each
 * recorded step into one row in `docs/EVIDENCE.md` (step, HashScan link, transaction id, date) and
 * one in `docs/COSTS.md` (step, gas used, HBAR charged), looking the transaction up on the mirror
 * node. A step whose mirror lookup is still pending stays in the checkpoint and is written on the
 * next flush, so a lagging mirror node never loses a row.
 *
 * Rows go into a dedicated "run log" table at the end of each file. The docs stream owns the
 * template tables above it; this code never edits those.
 */

const HARDHAT_DIR = path.join(__dirname, "..", "..");
const DOCS_DIR = path.join(HARDHAT_DIR, "..", "..", "docs");

export const CHECKPOINT_PATH = path.join(HARDHAT_DIR, ".testnet-run.json");
export const EVIDENCE_PATH = path.join(DOCS_DIR, "EVIDENCE.md");
export const COSTS_PATH = path.join(DOCS_DIR, "COSTS.md");
export const DECISIONS_PATH = path.join(DOCS_DIR, "DECISIONS.md");

const EVIDENCE_SECTION = "## Testnet run log";
const EVIDENCE_HEADER = "| Step | HashScan | Transaction id | Date |";
const COSTS_SECTION = "## Measured on the testnet run";
const COSTS_HEADER = "| Step | Gas used | HBAR charged | Transaction id |";
const LEDGER_SECTION = "## HBAR ledger";
const LEDGER_HEADER = "| Date | Step | HBAR | Running total |";

export const TINYBARS_PER_HBAR = 100_000_000n;

/** Formats tinybars as HBAR with 8 decimals. */
export function formatHbar(tinybars: bigint): string {
  const sign = tinybars < 0n ? "-" : "";
  const abs = tinybars < 0n ? -tinybars : tinybars;
  const whole = abs / TINYBARS_PER_HBAR;
  const frac = (abs % TINYBARS_PER_HBAR).toString().padStart(8, "0");
  return `${sign}${whole}.${frac}`;
}

/** What a step hands back to the ledger. */
export type StepOutcome = {
  /** EVM transaction hash when the step sent a transaction. */
  txHash?: string;
  /** HashScan link for the evidence row. Defaults to the transaction link. */
  link?: string;
  /** Values the step wants to keep for later steps or the summary. Strings only, so the JSON stays plain. */
  data?: Record<string, string | undefined>;
  /** Leave out the cost row (for steps that paid nothing, such as a balance reading). */
  noCost?: boolean;
  /** Checkpoint only: write no docs rows at all. */
  noEvidence?: boolean;
  /** Already-known mirror values, for a transaction this account did not send (a scheduled execution). */
  transactionId?: string;
  gasUsed?: number;
  chargedTinybars?: string;
};

export type StepRecord = StepOutcome & {
  key: string;
  title: string;
  completedAt: string;
  /** Filled by the mirror lookup on flush. */
  recordCount?: number;
  /** True once the rows exist in the docs. */
  written: boolean;
};

type Checkpoint = {
  version: 1;
  network: string;
  deployer: string;
  startedAt: string;
  steps: Record<string, StepRecord>;
};

export class Ledger {
  private checkpoint: Checkpoint;

  constructor(
    private readonly network: string,
    private readonly deployer: string,
    private readonly checkpointPath = CHECKPOINT_PATH,
  ) {
    this.checkpoint = this.load();
  }

  private load(): Checkpoint {
    if (fs.existsSync(this.checkpointPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.checkpointPath, "utf8")) as Checkpoint;
      if (parsed.deployer.toLowerCase() !== this.deployer.toLowerCase() || parsed.network !== this.network) {
        throw new Error(
          `${this.checkpointPath} belongs to ${parsed.deployer} on ${parsed.network}, not ${this.deployer} on ${this.network}. ` +
            "Move it aside to start a fresh run.",
        );
      }
      return parsed;
    }
    return {
      version: 1,
      network: this.network,
      deployer: this.deployer,
      startedAt: new Date().toISOString(),
      steps: {},
    };
  }

  private save(): void {
    fs.writeFileSync(this.checkpointPath, `${JSON.stringify(this.checkpoint, null, 2)}\n`);
  }

  /** The record of a completed step, or null. */
  get(key: string): StepRecord | null {
    return this.checkpoint.steps[key] ?? null;
  }

  has(key: string): boolean {
    return key in this.checkpoint.steps;
  }

  /** A value a completed step stored under `data`, or throws naming the step. */
  value(key: string, name: string): string {
    const record = this.get(key);
    const value = record?.data?.[name];
    if (value === undefined) throw new Error(`Step "${key}" has no "${name}" in the checkpoint`);
    return value;
  }

  /** Every completed step, in completion order. */
  records(): StepRecord[] {
    return Object.values(this.checkpoint.steps).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  /**
   * Runs `fn` once. When the checkpoint already holds `key` the step is skipped and the stored record
   * returned, so a rerun never repeats a paid transaction.
   */
  async step(key: string, title: string, fn: () => Promise<StepOutcome>): Promise<StepRecord> {
    const existing = this.get(key);
    if (existing) {
      console.log(`[skip] ${title} (done ${existing.completedAt}${existing.txHash ? `, ${existing.txHash}` : ""})`);
      return existing;
    }
    console.log(`[run ] ${title}`);
    const outcome = await fn();
    const record: StepRecord = {
      ...outcome,
      key,
      title,
      link: outcome.link ?? (outcome.txHash ? hashscanTransaction(outcome.txHash) : undefined),
      completedAt: new Date().toISOString(),
      written: false,
    };
    this.checkpoint.steps[key] = record;
    this.save();
    console.log(`[done] ${title}${record.link ? `  ${record.link}` : ""}`);
    return record;
  }

  /**
   * Writes the docs rows for every step not yet written. Mirror lookups that fail keep the step
   * pending unless `force` is set, in which case the row is written with the hash alone.
   */
  async flush(force = false): Promise<void> {
    for (const record of this.records()) {
      if (record.written) continue;
      if (record.noEvidence) {
        record.written = true;
        this.save();
        continue;
      }
      if (record.txHash && !record.transactionId) {
        try {
          const evidence = await transactionEvidence(record.txHash);
          record.transactionId = evidence.transactionId;
          record.gasUsed = evidence.gasUsed;
          record.chargedTinybars = evidence.chargedTinybars.toString();
          record.recordCount = evidence.recordCount;
          if (evidence.result !== "SUCCESS") {
            console.log(`[warn] ${record.title}: mirror node reports ${evidence.result}`);
          }
        } catch (e) {
          console.log(`[wait] ${record.title}: mirror lookup pending (${e instanceof Error ? e.message : String(e)})`);
          if (!force) continue;
        }
      }
      this.writeRows(record);
      record.written = true;
      this.save();
    }
  }

  private writeRows(record: StepRecord): void {
    const date = record.completedAt.slice(0, 10);
    const link = record.link ? `[link](${record.link})` : "none";
    const txId = record.transactionId ?? (record.txHash ? `hash ${record.txHash}` : "no transaction");
    appendTableRow(
      EVIDENCE_PATH,
      EVIDENCE_SECTION,
      EVIDENCE_HEADER,
      `| ${record.title} | ${link} | ${txId} | ${date} |`,
    );
    if ((record.txHash || record.transactionId) && !record.noCost) {
      const gas = record.gasUsed !== undefined ? record.gasUsed.toLocaleString("en-US") : "pending";
      const hbar = record.chargedTinybars !== undefined ? formatHbar(BigInt(record.chargedTinybars)) : "pending";
      const records = record.recordCount && record.recordCount > 1 ? ` (${record.recordCount} records)` : "";
      appendTableRow(
        COSTS_PATH,
        COSTS_SECTION,
        COSTS_HEADER,
        `| ${record.title} | ${gas} | ${hbar}${records} | ${txId} |`,
      );
    }
  }

  /** Sum of tinybars charged across every written step. */
  totalCharged(): bigint {
    return this.records().reduce((sum, r) => sum + (r.chargedTinybars ? BigInt(r.chargedTinybars) : 0n), 0n);
  }

  /** Appends one row to the HBAR ledger in docs/DECISIONS.md and returns the new running total. */
  recordSpend(step: string, tinybars: bigint): bigint {
    const previous = lastRunningTotal();
    const total = previous + tinybars;
    const date = new Date().toISOString().slice(0, 10);
    appendTableRow(
      DECISIONS_PATH,
      LEDGER_SECTION,
      LEDGER_HEADER,
      `| ${date} | ${step} | ${formatHbar(tinybars)} | ${formatHbar(total)} |`,
    );
    return total;
  }

  /** Prints every step with its link and cost. */
  printSummary(): void {
    console.log("");
    console.log("Summary");
    for (const r of this.records()) {
      const cost = r.chargedTinybars ? `${formatHbar(BigInt(r.chargedTinybars))} HBAR` : r.txHash ? "cost pending" : "";
      const gas = r.gasUsed !== undefined ? `, ${r.gasUsed.toLocaleString("en-US")} gas` : "";
      console.log(`  ${r.title}: ${r.link ?? "no link"}${cost ? `  (${cost}${gas})` : ""}`);
    }
    console.log(`  Total charged on recorded transactions: ${formatHbar(this.totalCharged())} HBAR`);
  }
}

/** The last running total in the DECISIONS HBAR ledger, in tinybars. */
function lastRunningTotal(): bigint {
  if (!fs.existsSync(DECISIONS_PATH)) return 0n;
  const lines = fs.readFileSync(DECISIONS_PATH, "utf8").split("\n");
  const start = lines.indexOf(LEDGER_SECTION);
  if (start < 0) return 0n;
  let total = 0n;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const cells = line.split("|").map(c => c.trim());
    if (cells.length < 6 || cells[1] === "Date" || cells[1].startsWith("---")) continue;
    const parsed = parseHbar(cells[4]);
    if (parsed !== null) total = parsed;
  }
  return total;
}

function parseHbar(text: string): bigint | null {
  const match = text.replace(/,/g, "").match(/^(-?)(\d+)(?:\.(\d{1,8}))?$/);
  if (!match) return null;
  const whole = BigInt(match[2]) * TINYBARS_PER_HBAR;
  const frac = match[3] ? BigInt(match[3].padEnd(8, "0")) : 0n;
  return match[1] === "-" ? -(whole + frac) : whole + frac;
}

/**
 * Appends `row` to the table under `section` in a markdown file. Creates the file, the section and
 * the table header when missing. The row goes after the table's last row, so later sections are
 * left alone.
 */
export function appendTableRow(file: string, section: string, header: string, row: string): void {
  const title = path.basename(file, ".md");
  const divider = `|${header
    .split("|")
    .slice(1, -1)
    .map(() => " --- ")
    .join("|")}|`;
  let lines = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n")
    : [`# ${title[0]}${title.slice(1).toLowerCase()}`, ""];
  let sectionAt = lines.indexOf(section);
  if (sectionAt < 0) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines = [...lines, "", section, "", header, divider];
    sectionAt = lines.indexOf(section);
  }
  let headerAt = -1;
  for (let i = sectionAt + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    if (lines[i].trim() === header) {
      headerAt = i;
      break;
    }
  }
  if (headerAt < 0) {
    lines.splice(sectionAt + 1, 0, "", header, divider);
    headerAt = sectionAt + 2;
  }
  let last = headerAt + 1;
  while (last + 1 < lines.length && lines[last + 1].startsWith("|")) last++;
  lines.splice(last + 1, 0, row);
  fs.writeFileSync(file, `${lines.join("\n").replace(/\n*$/, "")}\n`);
}
