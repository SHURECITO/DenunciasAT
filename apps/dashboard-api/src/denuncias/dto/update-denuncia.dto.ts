import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateDenunciaDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dependenciaAsignada?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  documentoRevisado?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  esEspecial?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  documentoPendiente?: boolean;

  // Campos actualizados por document-service
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  documentoGeneradoOk?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  documentoUrl?: string;

  // Campos usados al completar una denuncia parcial (chatbot → PATCH)
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  nombreCiudadano?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  cedula?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ubicacion?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  barrio?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  comuna?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  descripcionResumen?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  esAnonimo?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  incompleta?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  solicitudAdicional?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  imagenesEvidencia?: string;

  // Seguimiento de respuestas cuando hay múltiples dependencias
  @ApiPropertyOptional({ type: 'array' })
  @IsArray()
  @IsOptional()
  respuestasPorDependencia?: RespuestaDependencia[];
}

export interface RespuestaDependencia {
  dependencia: string;
  respondio: boolean;
  fechaRespuesta: string | null;
  observacion: string | null;
}
