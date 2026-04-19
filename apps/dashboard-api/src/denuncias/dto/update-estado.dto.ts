import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DenunciaEstado } from '../entities/denuncia.entity';

export class UpdateEstadoDto {
  @ApiProperty({ enum: DenunciaEstado })
  @IsEnum(DenunciaEstado)
  estado: DenunciaEstado;

  @ApiPropertyOptional({ description: 'Texto de la respuesta de la administración (solo para CON_RESPUESTA)' })
  @IsString()
  @IsOptional()
  respuesta?: string;
}
