import type { MigrationInterface, QueryRunner } from "@n8n/typeorm";

/**
 * Adds the first table for this service: instance_reports
 */
export class CreateInstanceReports1788912000000 implements MigrationInterface {
  name = "CreateInstanceReports1788912000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE instance_reports (
        id         INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
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
