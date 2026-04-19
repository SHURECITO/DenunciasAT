import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class GenerarDesdeDescripcionDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  @Min(1)
  denunciaId: number;

  @ApiProperty({ example: 'Descripción de la denuncia para clasificar dependencia.' })
  @IsString()
  @Length(10, 5000)
  descripcion: string;

  @ApiProperty({ example: 'Calle 44 #52-49' })
  @IsString()
  @Length(4, 200)
  ubicacion: string;

  @ApiProperty({ example: 'El Poblado', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  barrio?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  esEspecial: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  generarDocumento: boolean;
}
