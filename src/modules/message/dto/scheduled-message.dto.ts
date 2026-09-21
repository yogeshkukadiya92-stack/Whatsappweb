import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn, IsObject, IsDateString, Matches } from 'class-validator';
import type {
  ScheduledMessageDetails,
  ScheduledMessageRecurrence,
  ScheduledRecipientType,
} from '../entities/scheduled-message.entity';

export class CreateScheduledMessageDto {
  @ApiPropertyOptional({ description: 'Idempotency key for importing a browser-only schedule' })
  @IsOptional()
  @Matches(/^sched_[a-zA-Z0-9_]{1,100}$/)
  clientId?: string;

  @ApiProperty({ description: 'Recipient phone number or WhatsApp group JID (e.g. 120363...@g.us)', example: '628123456789@c.us' })
  @IsString()
  @IsNotEmpty()
  recipient!: string;

  @ApiPropertyOptional({ description: 'Recipient type: personal or group', enum: ['personal', 'group'], default: 'personal' })
  @IsOptional()
  @IsIn(['personal', 'group'])
  recipientType?: ScheduledRecipientType;

  @ApiProperty({ description: 'Message type (text, poll, image, video, audio, document, sticker, location, contact, forward, bulk)', example: 'poll' })
  @IsString()
  @IsNotEmpty()
  messageType!: string;

  @ApiProperty({ description: 'Scheduled dispatch ISO timestamp', example: '2026-10-01T10:00:00.000Z' })
  @IsDateString()
  @IsNotEmpty()
  scheduledAt!: string;

  @ApiPropertyOptional({ description: 'Short preview text for calendar and queue summaries' })
  @IsOptional()
  @IsString()
  previewText?: string;

  @ApiProperty({ description: 'Type-specific parameters (poll question/options, media file/url, content, etc.)' })
  @IsObject()
  @IsNotEmpty()
  details!: ScheduledMessageDetails;

  @ApiPropertyOptional({ description: 'Recurrence rule (frequency, time, days, endDate)' })
  @IsOptional()
  @IsObject()
  recurrence?: ScheduledMessageRecurrence;
}

export class UpdateScheduledMessageDto {
  @ApiPropertyOptional({ description: 'Recipient phone number or WhatsApp group JID' })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiPropertyOptional({ description: 'Recipient type: personal or group', enum: ['personal', 'group'] })
  @IsOptional()
  @IsIn(['personal', 'group'])
  recipientType?: ScheduledRecipientType;

  @ApiPropertyOptional({ description: 'Message type' })
  @IsOptional()
  @IsString()
  messageType?: string;

  @ApiPropertyOptional({ description: 'Scheduled dispatch ISO timestamp' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ description: 'Short preview text' })
  @IsOptional()
  @IsString()
  previewText?: string;

  @ApiPropertyOptional({ description: 'Type-specific parameters' })
  @IsOptional()
  @IsObject()
  details?: ScheduledMessageDetails;

  @ApiPropertyOptional({ description: 'Recurrence rule' })
  @IsOptional()
  @IsObject()
  recurrence?: ScheduledMessageRecurrence;

  @ApiPropertyOptional({ description: 'Status update (e.g. cancelled)', enum: ['pending', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending', 'cancelled'])
  status?: string;
}
