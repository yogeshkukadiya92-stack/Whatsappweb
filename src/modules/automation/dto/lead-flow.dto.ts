import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeadFlowStep } from '../entities/lead-flow.entity';

export class CreateLeadFlowDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsArray()
  triggers!: string[];

  @IsArray()
  steps!: LeadFlowStep[];

  @IsString()
  completionMessage!: string;

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
  triggers?: string[];

  @IsOptional()
  @IsArray()
  steps?: LeadFlowStep[];

  @IsOptional()
  @IsString()
  completionMessage?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
