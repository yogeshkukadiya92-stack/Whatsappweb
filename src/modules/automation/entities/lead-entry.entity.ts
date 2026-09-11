import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';
import { jsonColumnType } from '../../../common/utils/column-types';

@Entity('lead_entries')
export class LeadEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_lead_entries_sessionId')
  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Index('IDX_lead_entries_session_chat')
  @Column({ type: 'varchar' })
  chatId!: string;

  @Column({ type: 'varchar', nullable: true })
  flowId!: string | null;

  @Column({ type: 'int', default: 0 })
  currentStepIndex!: number;

  @Column({ type: 'varchar', length: 30, default: 'in_progress' })
  status!: 'in_progress' | 'completed';

  @Column({ type: jsonColumnType(), nullable: true })
  collectedData!: Record<string, string> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
