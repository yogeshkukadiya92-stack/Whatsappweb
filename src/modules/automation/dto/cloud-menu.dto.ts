import { ToStrictBoolean } from '../../../common/utils/strict-boolean';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
export class SaveCloudMenuDto {
  @Matches(/^\d{5,30}$/) phoneNumberId!: string;
  @Matches(/^v\d{1,2}\.\d{1,2}$/) apiVersion!: string;
  @ToStrictBoolean() @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() @MaxLength(8000) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(200) appSecret?: string;
}
