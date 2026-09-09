import { Column, Entity, Index, PrimaryGeneratedColumn } from "@n8n/typeorm";
import type { Metric } from "./instance-report.service";

/**
 * One stored report envelope. Maps onto the `instance_reports` table exactly
 * as the pre-ORM schema created it, so databases written by earlier releases
 * are read without any data migration.
 *
 * Every column names its SQL type explicitly: the build does not emit decorator
 * metadata (see tsconfig.json), so TypeORM cannot infer types from the
 * TypeScript annotations.
 */
@Entity({ name: "instance_reports" })
@Index("idx_instance_reports_batch", ["instanceId", "batchId"], { unique: true })
export class InstanceReportEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text", name: "instance_id" })
  instanceId!: string;

  @Column({ type: "text", name: "batch_id" })
  batchId!: string;

  @Column({ type: "text", nullable: true })
  label!: string | null;

  @Column({ type: "text", name: "n8n_version" })
  n8nVersion!: string;

  /** Stored as a JSON text column; TypeORM serialises on write and parses on read. */
  @Column({ type: "simple-json", name: "data" })
  dataPoints!: Metric[];

  @Column({ type: "text", name: "received_at" })
  receivedAt!: string;
}
