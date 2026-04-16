import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateParcialDto {
  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty()
  nombreCiudadano: string;

  @ApiProperty({ example: '573001234567' })
  @IsString()
  @IsNotEmpty()
  telefono: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsString()
  @IsOptional()
  cedula?: string;

  @ApiPropertyOptional({ example: 'El Poblado' })
  @IsString()
  @IsOptional()
  barrio?: string;

  @ApiPropertyOptional({ example: 'Comuna 14' })
  @IsString()
  @IsOptional()
  comuna?: string;

  @ApiPropertyOptional({ example: 'Calle 44 #52-49' })
  @IsString()
  @IsOptional()
  direccion?: string;

  @ApiPropertyOptional({ example: 'Descripción parcial...' })
  @IsString()
  @IsOptional()
  descripcion?: string;
}
