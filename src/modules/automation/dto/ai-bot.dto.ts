import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ToStrictBoolean, ToStrictNumber } from '../../../common/utils/strict-boolean';

export class UpdateAiBotConfigDto {
  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['gemini', 'openai'])
  provider?: 'gemini' | 'openai';

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  knowledgeBase?: string;

  @IsOptional()
  @ToStrictNumber()
  @IsNumber()
  cooldownSeconds?: number;
}

export class TestAiBotPromptDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  agentId?: string;
}

export class ExtractDocumentDto {
  @IsString()
  filename!: string;

  @IsString()
  contentBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

