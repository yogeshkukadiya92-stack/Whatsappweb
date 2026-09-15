import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

export enum SubscriptionStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum SubscriptionPlan {
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 190 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: UserRole.USER,
  })
  role!: UserRole;

  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionStatus.TRIAL,
  })
  subscriptionStatus!: SubscriptionStatus;

  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionPlan.STARTER,
  })
  plan!: SubscriptionPlan;

  @Column({ type: 'int', default: 1 })
  maxSessions!: number;

  @Column({ type: 'datetime', nullable: true })
  subscriptionExpiresAt!: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /**
   * Dedicated API key tied to this user account for transparent gateway proxying
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  apiKeyId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
