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

@Entity('ai_bot_configs')
export class AiBotConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_ai_bot_configs_sessionId')
  @Column({ type: 'varchar', unique: true })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 30, default: 'gemini' })
  provider!: 'gemini' | 'openai';

  @Column({ type: 'text', default: '' })
  apiKey!: string;

  @Column({ type: 'varchar', length: 100, default: 'gemini-1.5-flash' })
  model!: string;

  @Column({ type: 'text', nullable: true })
  systemPrompt!: string | null;

  @Column({ type: 'text', nullable: true })
  knowledgeBase!: string | null;

  @Column({ type: 'int', default: 10 })
  cooldownSeconds!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
