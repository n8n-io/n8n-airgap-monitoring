import { type DataSource, QueryFailedError, type Repository } from "@n8n/typeorm";
import { InstanceReportEntity } from "./instance-report.entity";
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

/**
 * `(instanceId, batchId)` is the only unique index on the table, so this code
 * identifies the collision on its own.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === "SQLITE_CONSTRAINT" &&
    error.message.includes("UNIQUE constraint failed")
  );
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
  readonly #reports: Repository<InstanceReportEntity>;

  constructor(dataSource: DataSource) {
    this.#reports = dataSource.getRepository(InstanceReportEntity);
  }

  /** Appends one event and returns its id. Throws {@link DuplicateBatchError} for a repeated batchId. */
  async insert(event: InstanceReport): Promise<number> {
    try {
      const { identifiers } = await this.#reports.insert({
        instanceId: event.instanceId,
        batchId: event.batchId,
        // An absent label is stored as SQL NULL, not as the string "undefined".
        label: event.label ?? null,
        n8nVersion: event.n8nVersion,
        dataPoints: event.dataPoints,
        receivedAt: event.receivedAt,
      });

      return Number(identifiers[0].id);
    } catch (error) {
      // The only place that knows about driver error codes, so callers can act
      // on the collision without depending on the database layer.
      if (isUniqueConstraintViolation(error)) {
        throw new DuplicateBatchError(event.instanceId, event.batchId);
      }

      throw error;
    }
  }

  async findInstanceIds(): Promise<string[]> {
    const rows = await this.#reports
      .createQueryBuilder("report")
      .select("report.instanceId", "instanceId")
      .distinct(true)
      .orderBy("report.instanceId", "ASC")
      .getRawMany<{ instanceId: string }>();

    return rows.map((row) => row.instanceId);
  }

  async findByInstanceId(instanceId: string): Promise<InstanceReportRow[]> {
    return this.#reports.find({
      where: { instanceId },
      order: {
        receivedAt: "ASC",
        id: "ASC",
      },
    });
  }
}
