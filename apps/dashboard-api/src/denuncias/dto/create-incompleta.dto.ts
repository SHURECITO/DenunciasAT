import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateIncompletaDto {
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

  @ApiPropertyOptional({ example: 'Barrio El Poblado, Medellín' })
  @IsString()
  @IsOptional()
  ubicacion?: string;

  @ApiPropertyOptional({ example: 'Descripción parcial...' })
  @IsString()
  @IsOptional()
  descripcion?: string;
}
