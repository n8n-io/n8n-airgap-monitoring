import type Database from "better-sqlite3";
import type { Metric } from "./instance-report.service";

/** One row to append, with every value the caller has already decided on. */
export interface InstanceReport {
  instanceId: string;
  label?: string;
  n8nVersion: string;
  dataPoints: Metric[];
  receivedAt: string;
}

/** One stored event, as read back. */
export interface InstanceReportRow {
  instanceId: string;
  label: string | null;
  n8nVersion: string;
  dataPoints: Metric[];
  receivedAt: string;
}

/** The shape rows come back in, before the JSON column is parsed. */
interface StoredRow {
  instance_id: string;
  label: string | null;
  n8n_version: string;
  data: string;
  received_at: string;
}

function toInstanceReportRow(row: StoredRow): InstanceReportRow {
  return {
    instanceId: row.instance_id,
    label: row.label,
    n8nVersion: row.n8n_version,
    dataPoints: JSON.parse(row.data) as Metric[],
    receivedAt: row.received_at,
  };
}

/**
 * Data access for the instance report event store. Holds no business rules: callers decide
 * what to store, this only decides how it is written.
 */
export class InstanceReportRepository {
  readonly #insertEvent: Database.Statement;
  readonly #findAll: Database.Statement;
  readonly #findByInstanceId: Database.Statement;

  constructor(db: Database.Database) {
    // Prepared once per process: the daily report burst reuses the same plan.
    this.#insertEvent = db.prepare(
      `INSERT INTO instance_reports (instance_id, label, n8n_version, data, received_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    // Ordered by id, not received_at: id is a strictly monotonic insertion-order
    // primitive, while received_at is wall-clock and could in principle collide
    // or skew. Callers rely on this order to fold events into current state.
    this.#findAll = db.prepare(
      `SELECT instance_id, label, n8n_version, data, received_at
       FROM instance_reports
       ORDER BY instance_id ASC, id ASC`,
    );

    // Scoped to one instance, so a metric-history lookup doesn't deserialize
    // the entire event store. Ordered the same way as findAll, for the same
    // reason: id is strictly monotonic insertion order, received_at is not.
    this.#findByInstanceId = db.prepare(
      `SELECT instance_id, label, n8n_version, data, received_at
       FROM instance_reports
       WHERE instance_id = ?
       ORDER BY id ASC`,
    );
  }

  /** Appends one event and returns its id. */
  insert(event: InstanceReport): number {
    const { lastInsertRowid } = this.#insertEvent.run(
      event.instanceId,
      // better-sqlite3 rejects undefined bindings, so an absent label is stored
      // as SQL NULL.
      event.label ?? null,
      event.n8nVersion,
      JSON.stringify(event.dataPoints),
      event.receivedAt,
    );

    return Number(lastInsertRowid);
  }

  /** Every event ever received, oldest-first per instance. */
  findAll(): InstanceReportRow[] {
    const rows = this.#findAll.all() as StoredRow[];

    return rows.map(toInstanceReportRow);
  }

  /** Every event ever received for one instance, oldest-first. */
  findByInstanceId(instanceId: string): InstanceReportRow[] {
    const rows = this.#findByInstanceId.all(instanceId) as StoredRow[];

    return rows.map(toInstanceReportRow);
  }
}
