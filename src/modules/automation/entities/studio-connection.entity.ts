import { Entity, Column, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Session } from '../../session/entities/session.entity';

@Entity('studio_connections')
export class StudioConnection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ type: 'varchar' }) sessionId!: string;
  @ManyToOne(() => Session, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'sessionId' }) session!: Session;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'varchar', default: 'api' }) kind!: 'api' | 'mcp';
  @Column({ type: 'simple-json', default: '[]' }) allowedTools!: string[];
  @Column({ type: 'varchar' }) baseUrl!: string;
  @Column({ type: 'varchar' }) auth!: 'none' | 'bearer' | 'apiKey' | 'basic' | 'oauth';
  @Column({ type: 'varchar', default: '' }) headerName!: string;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @Column({ type: 'text', nullable: true, select: false }) secret!: string | null;
}
