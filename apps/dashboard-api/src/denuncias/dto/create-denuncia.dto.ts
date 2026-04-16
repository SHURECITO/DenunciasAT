import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateDenunciaDto {
  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty()
  nombreCiudadano: string;

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 12)
  cedula: string;

  @ApiProperty({ example: '3001234567' })
  @IsString()
  @IsNotEmpty()
  telefono: string;

  @ApiProperty({ example: 'Barrio El Poblado, Medellín' })
  @IsString()
  @IsNotEmpty()
  ubicacion: string;

  @ApiProperty({ example: 'Descripción detallada del problema...' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({ example: 'Secretaría de Movilidad' })
  @IsString()
  @IsOptional()
  dependenciaAsignada?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  esEspecial?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  documentoPendiente?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  incompleta?: boolean;
}
