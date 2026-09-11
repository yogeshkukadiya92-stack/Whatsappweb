import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAiBotConfigDto {
  @IsOptional()
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
  @IsNumber()
  cooldownSeconds?: number;
}

export class TestAiBotPromptDto {
  @IsString()
  message!: string;
}
