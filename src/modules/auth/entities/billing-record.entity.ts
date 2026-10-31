import { Entity, PrimaryColumn, Column } from 'typeorm';
@Entity('billing_records')
export class BillingRecord {
  @PrimaryColumn({ type: 'varchar', length: 100 }) id!: string;
  @Column({ type: 'text' }) payload!: string;
}
