import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BuscarDto {
  @IsString()
  descripcion: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  top_k?: number;
}
