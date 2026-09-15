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

export interface LeadFlowStep {
  key: string;
  question: string;
  /** Empty/absent means a free-text answer; 2+ entries are sent as a single-choice poll. */
  options?: string[];
}

export interface LeadFlowCompletionMedia {
  type: 'image' | 'document' | 'audio' | 'video';
  url: string;
  caption?: string;
  base64?: string;
}

@Entity('lead_flows')
export class LeadFlow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_lead_flows_sessionId')
  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  // Stored as JSON array of triggers e.g. ["hi", "hello", "inquiry"]
  @Column({ type: jsonColumnType() })
  triggers!: string[];

  // Stored as JSON array of LeadFlowStep objects
  @Column({ type: jsonColumnType() })
  steps!: LeadFlowStep[];

  @Column({ type: 'text' })
  completionMessage!: string;

  @Column({ type: jsonColumnType(), nullable: true })
  completionMedia!: LeadFlowCompletionMedia[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
