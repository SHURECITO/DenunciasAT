import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateUsuarioDto {
  @ApiProperty({ example: 'María López' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'maria@denunciasat.co' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Temporal1234!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
