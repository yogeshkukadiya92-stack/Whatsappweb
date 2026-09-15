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

export type AiAgentRole = 'sales' | 'support' | 'billing' | 'inquiry' | 'custom';
export type AiAgentAudience = 'all' | 'numbers' | 'groups';

@Entity('ai_agents')
export class AiAgent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_ai_agents_sessionId')
  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'sessionId' })
  session?: Session;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 50, default: 'sales' })
  role!: AiAgentRole;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Priority for matching: higher priority evaluated first */
  @Column({ type: 'int', default: 0 })
  priority!: number;

  /** Keywords/phrases that trigger this agent (stored as JSON array) */
  @Column({ type: jsonColumnType() })
  triggerKeywords!: string[];

  @Column({ type: jsonColumnType(), nullable: true })
  targetNumbers!: string[] | null;

  @Column({ type: 'varchar', length: 20, default: 'all' })
  audience!: AiAgentAudience;

  @Column({ type: jsonColumnType(), nullable: true })
  messageTypes!: string[] | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  systemPrompt!: string;

  @Column({ type: 'text', nullable: true })
  knowledgeBase!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
