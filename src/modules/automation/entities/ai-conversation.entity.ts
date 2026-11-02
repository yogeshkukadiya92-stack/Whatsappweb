import { Column, Entity, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';

@Entity('ai_conversations')
export class AiConversation {
  @PrimaryColumn({ type: 'varchar' }) sessionId!: string;
  @PrimaryColumn({ type: 'varchar' }) chatId!: string;
  @Column({ type: 'varchar' }) agentId!: string;
  @Column({ type: 'int', default: 0 }) replyCount!: number;
  @Column({ type: 'boolean', default: false }) busy!: boolean;
  @Column({ type: jsonColumnType() }) history!: { role: 'user' | 'assistant'; content: string }[];
}
