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
}
