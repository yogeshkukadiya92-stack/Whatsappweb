import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'Account email address' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email!: string;

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
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
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
