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

  @ApiPropertyOptional({ example: '1234567890' })
  @IsString()
  @IsOptional()
  @Length(6, 12)
  cedula?: string;

  @ApiProperty({ example: '3001234567' })
  @IsString()
  @IsNotEmpty()
  telefono: string;

  @ApiProperty({ example: 'Calle 44 #52-49' })
  @IsString()
  @IsNotEmpty()
  ubicacion: string;

  @ApiPropertyOptional({ example: 'El Poblado' })
  @IsString()
  @IsOptional()
  barrio?: string;

  @ApiPropertyOptional({ example: 'Comuna 14' })
  @IsString()
  @IsOptional()
  comuna?: string;

  @ApiProperty({ example: 'Descripción detallada del problema...' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({ example: 'Resumen breve generado por IA' })
  @IsString()
  @IsOptional()
  descripcionResumen?: string;

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
  esAnonimo?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  documentoPendiente?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  incompleta?: boolean;
}
