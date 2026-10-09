import type { MigrationInterface, QueryRunner } from "@n8n/typeorm";

/**
 * Stores the consumerId read from the license certificate with each report.
 * Nullable: token mode has no certificate, and earlier rows predate the column.
 */
export class AddConsumerIdToInstanceReports1791504000000 implements MigrationInterface {
  name = "AddConsumerIdToInstanceReports1791504000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE instance_reports ADD COLUMN consumerId TEXT");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE instance_reports DROP COLUMN consumerId");
  }
}
