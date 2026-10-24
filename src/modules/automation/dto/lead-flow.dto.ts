import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsUrl,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ToStrictBoolean } from '../../../common/utils/strict-boolean';

export class LeadFlowChoiceDeliveryDto {
  @IsString()
  @IsNotEmpty()
  option!: string;

  @IsIn(['document', 'video', 'link'])
  type!: 'document' | 'video' | 'link';

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  filename?: string;
}

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

  @IsOptional()
  @IsBoolean()
  nativeButtons?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => LeadFlowChoiceDeliveryDto)
  deliveries?: LeadFlowChoiceDeliveryDto[];
}

export class LeadFlowCompletionMediaDto {
  @IsIn(['image', 'document', 'audio', 'video'])
  type!: 'image' | 'document' | 'audio' | 'video';

  // A completion attachment can come from either a public URL or a dashboard file upload.
  // Uploaded files are stored as data URLs in `base64`, so `url` must stay optional.
  @IsOptional()
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  base64?: string;

  @IsOptional()
  @IsString()
  mimetype?: string;

  @IsOptional()
  @IsString()
  filename?: string;
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
  @ToStrictBoolean()
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
  @ToStrictBoolean()
  @IsBoolean()
  enabled?: boolean;
}
