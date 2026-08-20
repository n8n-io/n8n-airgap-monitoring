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

/**
 * Data access for the instance report event store. Holds no business rules: callers decide
 * what to store, this only decides how it is written.
 */
export class InstanceReportRepository {
  readonly #insertEvent: Database.Statement;

  constructor(db: Database.Database) {
    // Prepared once per process: the daily report burst reuses the same plan.
    this.#insertEvent = db.prepare(
      `INSERT INTO instance_reports (instance_id, label, n8n_version, data, received_at)
       VALUES (?, ?, ?, ?, ?)`,
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
}
