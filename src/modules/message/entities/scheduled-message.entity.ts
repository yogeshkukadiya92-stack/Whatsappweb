import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { jsonColumnType, dateColumnType } from '../../../common/utils/column-types';

export enum ScheduledMessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export type ScheduledRecipientType = 'personal' | 'group';

export interface ScheduledMessageRecurrence {
  frequency: 'none' | 'daily' | 'weekly';
  time: string;
  days?: number[];
  endDate?: string;
}

export interface ScheduledMessageDetails {
  content?: string;
  mediaUrl?: string;
  mediaFile?: { base64: string; mimetype: string; filename: string } | null;
  pollQuestion?: string;
  pollOptions?: string[];
  allowMultipleAnswers?: boolean;
  latitude?: string;
  longitude?: string;
  locationDescription?: string;
  locationAddress?: string;
  contactName?: string;
  contactNumber?: string;
  forwardFrom?: string;
  forwardTo?: string;
  forwardMessageId?: string;
  bulkRecipients?: string;
  bulkDelay?: string;
}

@Entity('scheduled_messages')
@Index('IDX_scheduled_messages_session_status', ['sessionId', 'status'])
@Index('IDX_scheduled_messages_status_scheduled_at', ['status', 'scheduledAt'])
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id' })
  sessionId!: string;

  @Column({ name: 'recipient' })
  recipient!: string;

  @Column({ name: 'recipient_type', type: 'varchar', default: 'personal' })
  recipientType!: ScheduledRecipientType;

  @Column({ name: 'message_type', type: 'varchar' })
  messageType!: string;

  @Column({ type: 'varchar', default: ScheduledMessageStatus.PENDING })
  status!: ScheduledMessageStatus;

  @Column({ name: 'preview_text', type: 'text', nullable: true })
  previewText?: string;

  @Column({ type: jsonColumnType() })
  details!: ScheduledMessageDetails;

  @Column({ type: jsonColumnType(), nullable: true })
  recurrence?: ScheduledMessageRecurrence;

  @Column({ name: 'scheduled_at', type: dateColumnType(), transformer: DateTransformer })
  scheduledAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'sent_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  sentAt?: Date | null;

  @Column({ name: 'error', type: 'text', nullable: true })
  error?: string | null;
}
