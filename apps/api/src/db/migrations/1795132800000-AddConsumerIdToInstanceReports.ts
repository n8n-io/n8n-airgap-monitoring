import type { MigrationInterface, QueryRunner } from "@n8n/typeorm";

/**
 * Stores the license consumerId that authenticated the report.
 * Nullable: token-mode reports and rows written before this column have none.
 */
export class AddConsumerIdToInstanceReports1795132800000 implements MigrationInterface {
  name = "AddConsumerIdToInstanceReports1795132800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE instance_reports ADD COLUMN consumerId TEXT");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE instance_reports DROP COLUMN consumerId");
  }
}
