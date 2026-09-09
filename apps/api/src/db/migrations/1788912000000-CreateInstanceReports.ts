import type { MigrationInterface, QueryRunner } from "@n8n/typeorm";

/**
 * Baseline: the schema of the first TypeORM-based release.
 *
 * Deliberately not IF NOT EXISTS. A database file written before this release
 * has the same table with different column names, and starting against it
 * must fail here, loudly, rather than pass and break on the first insert.
 * Such files are from the beta phase and are discarded, not migrated.
 */
export class CreateInstanceReports1788912000000 implements MigrationInterface {
  name = "CreateInstanceReports1788912000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE instance_reports (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        instanceId TEXT NOT NULL,
        batchId    TEXT NOT NULL,
        label      TEXT,
        n8nVersion TEXT NOT NULL,
        data       TEXT NOT NULL,
        receivedAt TEXT NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_instance_reports_batch
        ON instance_reports (instanceId, batchId)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX idx_instance_reports_batch");
    await queryRunner.query("DROP TABLE instance_reports");
  }
}
