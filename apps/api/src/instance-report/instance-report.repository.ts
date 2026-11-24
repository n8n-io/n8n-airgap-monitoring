import { DataSource, QueryFailedError, type QueryRunner, type Repository } from "@n8n/typeorm";
import { InstanceReportEntity } from "./instance-report.entity";
import type { Metric, ReportFilter } from "./instance-report.service";

/** One row to append, with every value the caller has already decided on. */
export interface InstanceReport {
  instanceId: string;
  batchId: string;
  label?: string;
  n8nVersion: string;
  dataPoints: Metric[];
  receivedAt: string;
  consumerId: string | null;
}

/** One stored event, read back with its JSON `data` column already parsed. */
export interface InstanceReportRow {
  instanceId: string;
  batchId: string;
  label: string | null;
  n8nVersion: string;
  dataPoints: Metric[];
  receivedAt: string;
  consumerId: string | null;
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
 * Reads that belong to one download. {@link ReportSnapshot.close} ends the snapshot.
 */
export interface ReportSnapshot {
  findConsumerIds(filter: ReportFilter): Promise<string[]>;
  findInstanceIds(instanceIds?: string[]): Promise<string[]>;
  findByInstanceId(instanceId: string): Promise<InstanceReportRow[]>;
  close(): Promise<void>;
}

/**
 * Data access for the instance report event store. Holds no business rules: callers decide
 * what to store, this only decides how it is written.
 */
export class InstanceReportRepository {
  readonly #dataSource: DataSource;
  readonly #reports: Repository<InstanceReportEntity>;

  constructor(dataSource: DataSource) {
    this.#dataSource = dataSource;
    this.#reports = dataSource.getRepository(InstanceReportEntity);
  }

  /**
   * Opens a second SQLite connection and a deferred transaction so every read in
   * one download sees the same WAL snapshot. The writer keeps the main connection
   * and can commit while that download is still streaming.
   */
  async openReadSnapshot(): Promise<ReportSnapshot> {
    const database = this.#dataSource.options.database;
    if (typeof database !== "string") {
      throw new Error("A report snapshot needs the SQLite file path");
    }

    const snapshot = new DataSource({
      type: "sqlite",
      database,
      enableWAL: true,
      entities: [InstanceReportEntity],
      synchronize: false,
      logging: false,
    });
    await snapshot.initialize();

    try {
      const queryRunner = snapshot.createQueryRunner();
      await queryRunner.startTransaction();
      return new ReadSnapshot(snapshot, queryRunner);
    } catch (error) {
      await snapshot.destroy();
      throw error;
    }
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
        consumerId: event.consumerId,
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

  findInstanceIds(instanceIds?: string[]): Promise<string[]> {
    return readInstanceIds(this.#reports, instanceIds);
  }

  findConsumerIds(filter: ReportFilter): Promise<string[]> {
    return readConsumerIds(this.#reports, filter);
  }

  findByInstanceId(instanceId: string): Promise<InstanceReportRow[]> {
    return readInstanceRows(this.#reports, instanceId);
  }
}

async function readInstanceIds(reports: Repository<InstanceReportEntity>, instanceIds?: string[]): Promise<string[]> {
  const query = reports
    .createQueryBuilder("report")
    .select("report.instanceId", "instanceId")
    .distinct(true)
    .orderBy("report.instanceId", "ASC");

  if (instanceIds !== undefined) {
    query.where("report.instanceId IN (:...instanceIds)", { instanceIds });
  }

  const rows = await query.getRawMany<{ instanceId: string }>();
  return rows.map((row) => row.instanceId);
}

async function readConsumerIds(reports: Repository<InstanceReportEntity>, filter: ReportFilter): Promise<string[]> {
  const query = reports
    .createQueryBuilder("report")
    .select("report.consumerId", "consumerId")
    .distinct(true)
    .where("report.consumerId IS NOT NULL");

  if (filter.instanceIds !== undefined) {
    query.andWhere("report.instanceId IN (:...instanceIds)", { instanceIds: filter.instanceIds });
  }
  if (filter.start !== undefined) {
    query.andWhere("substr(report.receivedAt, 1, 10) >= :start", { start: filter.start });
  }
  if (filter.end !== undefined) {
    query.andWhere("substr(report.receivedAt, 1, 10) <= :end", { end: filter.end });
  }

  query.orderBy("report.consumerId", "ASC");

  const rows = await query.getRawMany<{ consumerId: string }>();
  return rows.map((row) => row.consumerId);
}

function readInstanceRows(reports: Repository<InstanceReportEntity>, instanceId: string): Promise<InstanceReportRow[]> {
  return reports.find({
    where: { instanceId },
    order: {
      receivedAt: "ASC",
      id: "ASC",
    },
  });
}

class ReadSnapshot implements ReportSnapshot {
  readonly #dataSource: DataSource;
  readonly #queryRunner: QueryRunner;
  #closed = false;

  constructor(dataSource: DataSource, queryRunner: QueryRunner) {
    this.#dataSource = dataSource;
    this.#queryRunner = queryRunner;
  }

  findConsumerIds(filter: ReportFilter): Promise<string[]> {
    return readConsumerIds(this.#reports(), filter);
  }

  findInstanceIds(instanceIds?: string[]): Promise<string[]> {
    return readInstanceIds(this.#reports(), instanceIds);
  }

  findByInstanceId(instanceId: string): Promise<InstanceReportRow[]> {
    return readInstanceRows(this.#reports(), instanceId);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    try {
      if (this.#queryRunner.isTransactionActive) {
        await this.#queryRunner.rollbackTransaction();
      }
    } finally {
      await this.#dataSource.destroy();
    }
  }

  #reports(): Repository<InstanceReportEntity> {
    return this.#queryRunner.manager.getRepository(InstanceReportEntity);
  }
}
