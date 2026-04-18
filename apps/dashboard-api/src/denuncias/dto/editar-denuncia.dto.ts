import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class EditarDenunciaDto {
  @ApiProperty({ description: 'Array de dependencias asignadas', type: [String] })
  @IsArray()
  @IsString({ each: true })
  dependenciasAsignadas: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ubicacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barrio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comuna?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  solicitudAdicional?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  regenerarDocumento?: boolean;
}
