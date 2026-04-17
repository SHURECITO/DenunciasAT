import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
}
