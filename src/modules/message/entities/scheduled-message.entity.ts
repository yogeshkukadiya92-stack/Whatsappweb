import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';

export enum ScheduledMessageStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export type ScheduledMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contact'
  | 'sticker'
  | 'poll';

@Entity('scheduled_messages')
@Index(['sessionId', 'status', 'scheduledAt'])
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  sessionId!: string;

  @Column()
  chatId!: string;

  @Column({ type: 'varchar' })
  type!: ScheduledMessageType;

  @Column({ type: jsonColumnType() })
  payload!: Record<string, unknown>;

  @Column()
  scheduledAt!: Date;

  @Column({ type: 'varchar', default: ScheduledMessageStatus.PENDING })
  status!: ScheduledMessageStatus;

  @Column({ nullable: true })
  sentMessageId?: string;

  @Column({ nullable: true })
  error?: string;

  @Column({ nullable: true })
  sentAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
