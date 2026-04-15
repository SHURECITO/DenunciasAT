import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { DireccionMensaje, TipoMensaje } from '../entities/mensaje.entity';

export class CreateMensajeDto {
  @ApiProperty({ example: 'Hola, quiero reportar un problema' })
  @IsString()
  @IsNotEmpty()
  contenido: string;

  @ApiProperty({ enum: TipoMensaje })
  @IsEnum(TipoMensaje)
  tipo: TipoMensaje;

  @ApiProperty({ enum: DireccionMensaje })
  @IsEnum(DireccionMensaje)
  direccion: DireccionMensaje;
}
