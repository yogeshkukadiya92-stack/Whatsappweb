import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ai_query_captures')
export class AiQueryCapture {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ type: 'varchar' }) sessionId!: string;
  @Index() @Column({ type: 'varchar' }) agentId!: string;
  @Column({ type: 'varchar', length: 160, nullable: true }) groupId!: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) groupName!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) senderPhone!: string | null;
  @Column({ type: 'text' }) query!: string;
  @CreateDateColumn() createdAt!: Date;
}
