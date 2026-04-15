import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class UpdateUsuarioDto {
  @ApiPropertyOptional({ example: 'María López' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;

  @ApiPropertyOptional({ example: 'maria@denunciasat.co' })
  @IsEmail()
  @IsOptional()
  email?: string;
}
