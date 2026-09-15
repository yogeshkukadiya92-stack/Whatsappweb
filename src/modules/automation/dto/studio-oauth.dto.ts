import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteStudioOAuthDto {
  @IsString() @MaxLength(512) state!: string;
  @IsString() @MaxLength(2000) iss!: string;
  @IsOptional() @IsString() @MaxLength(2048) code?: string;
  @IsOptional() @IsIn(['access_denied']) error?: string;
}
