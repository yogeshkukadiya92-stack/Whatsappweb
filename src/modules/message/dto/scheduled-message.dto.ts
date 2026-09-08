import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ScheduledMessageStatus } from '../entities/scheduled-message.entity';
import type { ScheduledMessageType } from '../entities/scheduled-message.entity';

export const SCHEDULED_MESSAGE_TYPES: ScheduledMessageType[] = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'location',
  'contact',
  'sticker',
  'poll',
];

export class ScheduleMessageDto {
  @ApiProperty({ description: 'Chat ID (phone@c.us or groupId@g.us)' })
  @IsString()
  @IsNotEmpty()
  chatId!: string;

  @ApiProperty({ enum: SCHEDULED_MESSAGE_TYPES })
  @IsIn(SCHEDULED_MESSAGE_TYPES)
  type!: ScheduledMessageType;

  @ApiProperty({ description: 'The same body you would send to the matching send-* route, without chatId.' })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiProperty({ description: 'ISO date/time when the message should be sent.' })
  @IsDateString()
  scheduledAt!: string;
}

export class ScheduledMessageResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty()
  chatId!: string;

  @ApiProperty({ enum: SCHEDULED_MESSAGE_TYPES })
  type!: ScheduledMessageType;

  @ApiProperty()
  scheduledAt!: string;

  @ApiProperty({ enum: Object.values(ScheduledMessageStatus) })
  status!: ScheduledMessageStatus;

  @ApiPropertyOptional()
  sentMessageId?: string;

  @ApiPropertyOptional()
  error?: string;

  @ApiPropertyOptional()
  sentAt?: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
