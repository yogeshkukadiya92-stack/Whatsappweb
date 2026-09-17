import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';
import { jsonColumnType } from '../../../common/utils/column-types';

export interface StudioStep {
  id: string;
  type:
    | 'variable'
    | 'filter'
    | 'http'
    | 'reply'
    | 'router'
    | 'delay'
    | 'iterator'
    | 'aggregator'
    | 'website'
    | 'ai'
    | 'mcp'
    | 'google_calendar';
  label: string;
  config: Record<string, string>;
}
export interface StudioDefinition {
  keywords: string[];
  audience: 'all' | 'direct' | 'groups' | 'specific_numbers' | 'specific_groups';
  targetChats?: string[];
  cooldownSeconds: number;
  steps: StudioStep[];
  trigger?: { type: 'whatsapp' | 'webhook' | 'schedule'; chatId?: string; intervalMinutes?: number; startAt?: string };
}
@Entity('studio_workflows')
export class StudioWorkflow {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ type: 'varchar' }) sessionId!: string;
  @ManyToOne(() => Session, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'sessionId' }) session!: Session;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'boolean', default: false }) enabled!: boolean;
  @Column({ type: jsonColumnType() }) definition!: StudioDefinition;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
  @Column({ type: 'varchar', nullable: true }) nextScheduleAt!: string | null;
  @Column({ type: 'varchar', nullable: true, select: false }) webhookTokenHash!: string | null;
  @Column({ type: 'boolean', default: false }) webhookEnabled!: boolean;
}

export interface StudioTrace {
  stepId: string;
  label: string;
  status: 'success' | 'stopped' | 'failed' | 'waiting' | 'retrying' | 'continued';
  output: string;
  durationMs: number;
}
@Entity('studio_executions')
export class StudioExecution {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ type: 'varchar' }) sessionId!: string;
  @Column({ type: 'varchar' }) workflowId!: string;
  @Column({ type: 'varchar', length: 100 }) workflowName!: string;
  @Column({ type: 'varchar' }) status!: string;
  @Column({ type: 'boolean' }) test!: boolean;
  @Column({ type: 'varchar', nullable: true }) chatId!: string | null;
  @Column({ type: jsonColumnType() }) trace!: StudioTrace[];
  @Column({ type: 'int' }) durationMs!: number;
  @CreateDateColumn() createdAt!: Date;
}

export interface StudioLoop {
  start: number;
  end: number;
  items: unknown[];
  index: number;
  results: string[];
  alias: string;
  previousItem?: unknown;
}
export interface StudioRunState {
  cursor: number;
  values: Record<string, unknown>;
  trace: StudioTrace[];
  replies: string[];
  loops: StudioLoop[];
  attempts: Record<string, number>;
  operations: number;
  sending?: boolean;
  aiCalls?: number;
  websiteCalls?: number;
  mcpCalls?: number;
}
@Entity('studio_jobs')
export class StudioJob {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ type: 'varchar' }) sessionId!: string;
  @ManyToOne(() => Session, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'sessionId' }) session!: Session;
  @Column({ type: 'varchar' }) workflowId!: string;
  @Column({ type: 'varchar' }) executionId!: string;
  @Column({ type: jsonColumnType(), nullable: true }) definition!: StudioDefinition | null;
  @Column({ type: jsonColumnType(), nullable: true }) state!: StudioRunState | null;
  @Column({ type: 'varchar' }) chatId!: string;
  @Index() @Column({ type: 'varchar' }) status!: string;
  @Column({ type: 'varchar' }) nextRunAt!: string;
  @Column({ type: 'varchar', nullable: true }) leaseUntil!: string | null;
  @Column({ type: 'varchar', nullable: true }) leaseOwner!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
