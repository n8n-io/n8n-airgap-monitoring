import type { MigrationInterface, QueryRunner } from "@n8n/typeorm";

/**
 * SPIKE (API-463): months n8n acknowledged, so they are not pending any more.
 */
export class CreateReportSubmissions1792022400000 implements MigrationInterface {
  name = "CreateReportSubmissions1792022400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE report_submissions (
        -- YYYY-MM, e.g. 2026-09
        month       TEXT PRIMARY KEY NOT NULL,
        submittedAt TEXT NOT NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE report_submissions");
  }
}
