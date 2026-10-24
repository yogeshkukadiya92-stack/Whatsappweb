import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Session } from '../../session/entities/session.entity';
import { jsonColumnType } from '../../../common/utils/column-types';
import type { LeadFlowChoiceDelivery } from './lead-flow.entity';

@Entity('cloud_menu_connections')
export class CloudMenuConnection {
  @PrimaryColumn({ type: 'varchar' }) id!: string;
  @Index('IDX_cloud_menu_session', { unique: true }) @Column({ type: 'varchar' }) sessionId!: string;
  @ManyToOne(() => Session, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'sessionId' }) session!: Session;
  @Index('IDX_cloud_menu_phone', { unique: true }) @Column({ type: 'varchar' }) phoneNumberId!: string;
  @Column({ type: 'varchar' }) apiVersion!: string;
  @Column({ type: 'boolean', default: false }) enabled!: boolean;
  @Column({ type: 'text', select: false }) secret!: string;
  @Column({ type: 'varchar', select: false }) verifyTokenHash!: string;
}

@Entity('cloud_menu_receipts')
@Index('IDX_cloud_menu_message', ['connectionId', 'messageId'], { unique: true })
export class CloudMenuReceipt {
  @PrimaryColumn({ type: 'varchar' }) id!: string;
  @Index('IDX_cloud_menu_connection') @Column({ type: 'varchar' }) connectionId!: string;
  @ManyToOne(() => CloudMenuConnection, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connectionId' })
  connection!: CloudMenuConnection;
  @Column({ type: 'varchar', length: 512 }) messageId!: string;
  @Column({ type: 'varchar' }) sender!: string;
  @Column({ type: 'varchar' }) status!: 'processing' | 'done' | 'failed';
  @Column({ type: 'varchar' }) leaseUntil!: string;
  @Column({ type: 'varchar', nullable: true }) responseId!: string | null;
  @Column({ type: 'varchar', nullable: true }) consumedBy!: string | null;
  @Column({ type: jsonColumnType(), nullable: true }) menu!: {
    flowId: string;
    revision: string;
    question: string;
    choices: LeadFlowChoiceDelivery[];
  } | null;
}
