import { IsOptional, IsString } from 'class-validator';

export class ClasificarDto {
  @IsString()
  descripcion: string;

  @IsString()
  @IsOptional()
  ubicacion?: string;
}
