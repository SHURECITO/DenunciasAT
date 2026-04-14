import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DenunciaEstado } from '../entities/denuncia.entity';

export class UpdateEstadoDto {
  @ApiProperty({ enum: DenunciaEstado })
  @IsEnum(DenunciaEstado)
  estado: DenunciaEstado;
}
