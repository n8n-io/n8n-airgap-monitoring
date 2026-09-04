import type Database from "better-sqlite3";
import type { Metric } from "./instance-report.service";

/** One row to append, with every value the caller has already decided on. */
export interface InstanceReport {
  instanceId: string;
  batchId: string;
  label?: string;
  n8nVersion: string;
  dataPoints: Metric[];
  receivedAt: string;
}

/** One stored event, read back with its JSON `data` column already parsed. */
export interface InstanceReportRow {
  instanceId: string;
  batchId: string;
  label: string | null;
  n8nVersion: string;
  dataPoints: Metric[];
  receivedAt: string;
}

/** The raw column shape a row comes back in, before the JSON column is parsed. */
interface StoredRow {
  instance_id: string;
  batch_id: string;
  label: string | null;
  n8n_version: string;
  data: string;
  received_at: string;
}

function toInstanceReportRow(row: StoredRow): InstanceReportRow {
  return {
    instanceId: row.instance_id,
    batchId: row.batch_id,
    label: row.label,
    n8nVersion: row.n8n_version,
    dataPoints: JSON.parse(row.data) as Metric[],
    receivedAt: row.received_at,
  };
}

/**
 * `(instance_id, batch_id)` is the only unique index on the table, so this code
 * identifies the collision on its own.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}

/**
 * A batchId already stored for this instance. Envelopes are immutable, so the
 * repeat is rejected.
 */
export class DuplicateBatchError extends Error {
  constructor(
    readonly instanceId: string,
    readonly batchId: string,
  ) {
    super(`Report ${batchId} has already been recorded for instance ${instanceId}`);
    this.name = "DuplicateBatchError";
  }
}

/**
 * Data access for the instance report event store. Holds no business rules: callers decide
 * what to store, this only decides how it is written.
 */
export class InstanceReportRepository {
  readonly #insertEvent: Database.Statement;
  readonly #findAll: Database.Statement<[], StoredRow>;

  constructor(db: Database.Database) {
    // Prepared once per process: the daily report burst reuses the same plan.
    this.#insertEvent = db.prepare(
      `INSERT INTO instance_reports (instance_id, batch_id, label, n8n_version, data, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    this.#findAll = db.prepare<[], StoredRow>(
      `SELECT instance_id, batch_id, label, n8n_version, data, received_at
       FROM instance_reports
       ORDER BY instance_id ASC, received_at ASC, id ASC`,
    );
  }

  /** Appends one event and returns its id. Throws {@link DuplicateBatchError} for a repeated batchId. */
  insert(event: InstanceReport): number {
    try {
      const { lastInsertRowid } = this.#insertEvent.run(
        event.instanceId,
        event.batchId,
        // better-sqlite3 rejects undefined bindings, so an absent label is stored
        // as SQL NULL.
        event.label ?? null,
        event.n8nVersion,
        JSON.stringify(event.dataPoints),
        event.receivedAt,
      );

      return Number(lastInsertRowid);
    } catch (error) {
      // The only place that knows about driver error codes, so callers can act
      // on the collision without depending on better-sqlite3.
      if (isUniqueConstraintViolation(error)) {
        throw new DuplicateBatchError(event.instanceId, event.batchId);
      }

      throw error;
    }
  }

  /** Every event ever received, grouped per instance and oldest-first within each. */
  findAll(): InstanceReportRow[] {
    return this.#findAll.all().map(toInstanceReportRow);
  }
}
