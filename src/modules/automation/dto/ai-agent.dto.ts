import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { type AiAgentRole } from '../entities/ai-agent.entity';

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
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsArray()
  @IsString({ each: true })
  triggerKeywords!: string[];

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
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerKeywords?: string[];

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
