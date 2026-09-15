import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ToStrictBoolean, ToStrictNumber } from '../../../common/utils/strict-boolean';

/**
 * The three keys the session service actually reads out of the opaque `config` column. Anything
 * else stored there is ignored (see docs/05-database-design.md), so this DTO is the whole tunable
 * surface rather than a subset of it.
 *
 * Omitting a key leaves it unchanged; sending `null` clears it back to the default. The null case
 * is not decoration: `maxReconnectAttempts` defaults to unlimited, which no in-range number can
 * express, so without it a session could never be returned to unlimited retries once capped.
 *
 * The bounds mirror resolveReconnectConfig's clamps exactly. Duplicating them as validation turns a
 * silent clamp into a 400 that names the real range — the clamp still runs at use time and remains
 * the authority for rows written before this endpoint existed.
 */
export class UpdateSessionConfigDto {
  @ApiPropertyOptional({
    description:
      'Auto-reject every incoming call as soon as it rings. The call.received event is still ' +
      'emitted first, so a webhook consumer sees the call regardless. Takes effect on the next ' +
      'incoming call — the session is not restarted.',
    example: true,
    nullable: true,
    // Explicit because the TypeScript type is a union: emitDecoratorMetadata reduces `boolean | null`
    // to `Object`, so without this the property publishes as `type: object`.
    type: Boolean,
  })
  @ToStrictBoolean()
  @IsOptional()
  @IsBoolean()
  autoRejectCalls?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Cap on consecutive reconnect attempts (`0` disables reconnect entirely). Send `null` for ' +
      'unlimited, which is the default. Applies on the next session start, not to a reconnect ' +
      'sequence already in flight.',
    minimum: 0,
    maximum: 20,
    example: 5,
    nullable: true,
    // Without an explicit type the union publishes as `type: object`, and JSON Schema ignores
    // minimum/maximum on a non-numeric type — so the range above would be inert as well as wrong.
    type: Number,
  })
  @ToStrictNumber()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  maxReconnectAttempts?: number | null;

  @ApiPropertyOptional({
    description:
      'Base delay of the reconnect backoff in milliseconds. Applies on the next session start, ' +
      'not to a reconnect sequence already in flight.',
    minimum: 1000,
    maximum: 300000,
    example: 5000,
    nullable: true,
    type: Number,
  })
  @ToStrictNumber()
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(300000)
  reconnectBaseDelay?: number | null;

  @ApiPropertyOptional({
    description: 'Whether automatic start/stop scheduling based on working hours is enabled for this session',
    example: true,
    nullable: true,
    type: Boolean,
  })
  @ToStrictBoolean()
  @IsOptional()
  @IsBoolean()
  scheduleEnabled?: boolean | null;

  @ApiPropertyOptional({
    description: 'Scheduled start time in HH:mm format (24-hour), e.g. "09:00"',
    example: '09:00',
    nullable: true,
    type: String,
  })
  @IsOptional()
  scheduleStartTime?: string | null;

  @ApiPropertyOptional({
    description: 'Scheduled end time in HH:mm format (24-hour), e.g. "19:00"',
    example: '19:00',
    nullable: true,
    type: String,
  })
  @IsOptional()
  scheduleEndTime?: string | null;

  @ApiPropertyOptional({
    description: 'Days of week when schedule is active (0=Sunday, 1=Monday ... 6=Saturday). Defaults to all days.',
    example: [1, 2, 3, 4, 5, 6],
    nullable: true,
    type: [Number],
  })
  @IsOptional()
  scheduleDays?: number[] | null;

  @ApiPropertyOptional({
    description: 'IANA timezone for the schedule, e.g. "Asia/Kolkata" or "UTC". Defaults to system timezone.',
    example: 'Asia/Kolkata',
    nullable: true,
    type: String,
  })
  @IsOptional()
  scheduleTimezone?: string | null;
}

/**
 * The effective configuration, not the stored blob. `config` is deliberately stripped from
 * SessionResponseDto because it is an opaque column an operator may have put anything into
 * (alongside the credential-bearing proxyUrl) — echoing it back would leak that. Reporting only
 * the recognised keys keeps that guarantee while still letting a caller confirm what landed.
 *
 * Values are resolved through resolveReconnectConfig, so what is reported is what the engine will
 * actually do, including for legacy rows whose stored values fall outside the accepted range.
 */
export class SessionConfigResponseDto {
  @ApiProperty({ description: 'Whether incoming calls are auto-rejected', example: false })
  autoRejectCalls!: boolean;

  @ApiProperty({
    description: 'Reconnect attempt cap; `null` means unlimited',
    example: 5,
    nullable: true,
    type: Number,
  })
  maxReconnectAttempts!: number | null;

  @ApiProperty({ description: 'Base reconnect backoff in milliseconds', example: 5000 })
  reconnectBaseDelay!: number;

  @ApiProperty({ description: 'Whether session working hours schedule is enabled', example: false })
  scheduleEnabled!: boolean;

  @ApiProperty({ description: 'Scheduled start time in HH:mm (24h)', example: '09:00', nullable: true, type: String })
  scheduleStartTime!: string | null;

  @ApiProperty({ description: 'Scheduled end time in HH:mm (24h)', example: '19:00', nullable: true, type: String })
  scheduleEndTime!: string | null;

  @ApiProperty({ description: 'Active days of week (0-6)', example: [1, 2, 3, 4, 5, 6], nullable: true, type: [Number] })
  scheduleDays!: number[] | null;

  @ApiProperty({ description: 'Schedule timezone', example: 'Asia/Kolkata', nullable: true, type: String })
  scheduleTimezone!: string | null;
}
