import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ToStrictBoolean, ToStrictNumber } from '../../../common/utils/strict-boolean';
import { type AiAgentAudience, type AiAgentRole } from '../entities/ai-agent.entity';

const VALID_ROLES: AiAgentRole[] = ['sales', 'support', 'billing', 'inquiry', 'custom'];

export class CreateAiAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(VALID_ROLES)
  role?: AiAgentRole;

  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ToStrictNumber()
  @IsNumber()
  priority?: number;

  @IsArray()
  @IsString({ each: true })
  triggerKeywords!: string[];

  @IsOptional() @IsIn(['all', 'numbers', 'groups', 'non_contacts', 'selected_groups']) audience?: AiAgentAudience;
  @IsOptional() @IsArray() @IsString({ each: true }) targetNumbers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) messageTypes?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) similarMessages?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  systemPrompt!: string;

  @IsOptional()
  @IsString()
  knowledgeBase?: string;
}

export class UpdateAiAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(VALID_ROLES)
  role?: AiAgentRole;

  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ToStrictNumber()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerKeywords?: string[];

  @IsOptional() @IsIn(['all', 'numbers', 'groups', 'non_contacts', 'selected_groups']) audience?: AiAgentAudience;
  @IsOptional() @IsArray() @IsString({ each: true }) targetNumbers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) messageTypes?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) similarMessages?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  knowledgeBase?: string;
}
