import { Type } from 'class-transformer';
import { ToStrictBoolean } from '../../../common/utils/strict-boolean';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
export class StudioTriggerDto {
  @IsIn(['whatsapp', 'webhook', 'schedule']) type!: 'whatsapp' | 'webhook' | 'schedule';
  @IsOptional() @IsString() @MaxLength(128) chatId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(43200) intervalMinutes?: number;
  @IsOptional() @IsString() @MaxLength(64) startAt?: string;
}
export class StudioStepDto {
  @IsString() @MinLength(1) @MaxLength(64) id!: string;
  @IsIn(['variable', 'filter', 'http', 'reply', 'router', 'delay', 'iterator', 'aggregator', 'website', 'ai', 'mcp'])
  type!:
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
    | 'mcp';
  @IsString() @MaxLength(100) label!: string;
  @IsObject() config!: Record<string, string>;
}

export class StudioDefinitionDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) keywords!: string[];
  @IsIn(['all', 'direct', 'groups', 'specific_numbers', 'specific_groups'])
  audience!: 'all' | 'direct' | 'groups' | 'specific_numbers' | 'specific_groups';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) targetChats?: string[];
  @IsInt() @Min(10) @Max(86400) cooldownSeconds!: number;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => StudioStepDto) steps!: StudioStepDto[];
  @IsOptional() @ValidateNested() @Type(() => StudioTriggerDto) trigger?: StudioTriggerDto;
}
export class SaveStudioWorkflowDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ToStrictBoolean()
  @IsBoolean() enabled!: boolean;
  @ValidateNested() @Type(() => StudioDefinitionDto) @IsObject() definition!: StudioDefinitionDto;
}
export class TestStudioWorkflowDto {
  @IsString() @MaxLength(8000) message!: string;
  @IsOptional() @IsString() @MaxLength(128) chatId?: string;
  @IsOptional() @IsObject() webhook?: Record<string, unknown>;
}
