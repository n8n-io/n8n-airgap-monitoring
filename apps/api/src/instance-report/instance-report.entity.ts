import { Column, Entity, Index, PrimaryGeneratedColumn } from "@n8n/typeorm";
import type { Metric } from "./instance-report.service";

@Entity({ name: "instance_reports" })
@Index("idx_instance_reports_batch", ["instanceId", "batchId"], { unique: true })
export class InstanceReportEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  instanceId!: string;

  @Column({ type: "text" })
  batchId!: string;

  @Column({ type: "text", nullable: true })
  label!: string | null;

  @Column({ type: "text" })
  n8nVersion!: string;

  /**
   * Stored as a JSON text column; TypeORM serialises on write and parses on read.
   */
  @Column({ type: "simple-json", name: "data" })
  dataPoints!: Metric[];

  @Column({ type: "text" })
  receivedAt!: string;
}
