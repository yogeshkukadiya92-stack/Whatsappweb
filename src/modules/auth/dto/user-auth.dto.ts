import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, MaxLength } from 'class-validator';

export class RegisterUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'Account email address' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({ description: 'Optional login username', example: 'rahul.sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string;

  @ApiPropertyOptional({ description: 'Optional mobile number including country code', example: '+919876543210' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ example: 'SecurePassword123!', description: 'Account password (minimum 8 characters)' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsNotEmpty()
  password!: string;

  @ApiProperty({ example: 'John Doe', description: 'User full name or business name' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class LoginUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email, username or mobile number (legacy field name)' })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Authentication JWT token' })
  token!: string;

  @ApiProperty({ description: 'User account details' })
  user!: {
    id: string;
    email: string;
    name: string;
    role: string;
    subscriptionStatus: string;
    plan: string;
    maxSessions: number;
    apiKey: string;
  };
}
