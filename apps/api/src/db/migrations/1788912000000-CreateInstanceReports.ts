import type { MigrationInterface, QueryRunner } from "@n8n/typeorm";

/**
 * Baseline: the schema as it existed before migrations were introduced.
 *
 * Both statements use IF NOT EXISTS on purpose. A database created by an
 * earlier release already has this table and index, and the first start after
 * upgrading must record this migration as applied without touching them.
 */
export class CreateInstanceReports1788912000000 implements MigrationInterface {
  name = "CreateInstanceReports1788912000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS instance_reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        batch_id    TEXT NOT NULL,
        label       TEXT,
        n8n_version TEXT NOT NULL,
        data        TEXT NOT NULL,
        received_at TEXT NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_reports_batch
        ON instance_reports (instance_id, batch_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX IF EXISTS idx_instance_reports_batch");
    await queryRunner.query("DROP TABLE IF EXISTS instance_reports");
  }
}
