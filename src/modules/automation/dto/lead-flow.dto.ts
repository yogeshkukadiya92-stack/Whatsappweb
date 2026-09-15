import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LeadFlowStepDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class LeadFlowCompletionMediaDto {
  @IsIn(['image', 'document', 'audio', 'video'])
  type!: 'image' | 'document' | 'audio' | 'video';
  @IsString()
  @IsNotEmpty()
  url!: string;
  @IsOptional()
  @IsString()
  caption?: string;
}

export class CreateLeadFlowDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  triggers!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadFlowStepDto)
  steps!: LeadFlowStepDto[];

  @IsString()
  completionMessage!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadFlowCompletionMediaDto)
  completionMedia?: LeadFlowCompletionMediaDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateLeadFlowDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggers?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadFlowStepDto)
  steps?: LeadFlowStepDto[];

  @IsOptional()
  @IsString()
  completionMessage?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadFlowCompletionMediaDto)
  completionMedia?: LeadFlowCompletionMediaDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
