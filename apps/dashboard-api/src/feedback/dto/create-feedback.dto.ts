import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFeedbackDto {
  @ApiProperty({ description: 'ID de la denuncia evaluada' })
  @IsNumber()
  denunciaId: number;

  @ApiProperty({ description: 'Dependencia que asignó la IA' })
  @IsString()
  @IsNotEmpty()
  dependenciaOriginal: string;

  @ApiPropertyOptional({ description: 'Corrección del abogado si la dependencia fue incorrecta' })
  @IsOptional()
  @IsString()
  dependenciaCorregida?: string;

  @ApiProperty({ description: '¿La dependencia asignada fue correcta?' })
  @IsBoolean()
  dependenciaCorrecta: boolean;

  @ApiProperty({ description: 'Calidad de la redacción de los HECHOS (1–5)', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  calidadHechos: number;

  @ApiPropertyOptional({ description: 'Comentario sobre los HECHOS' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comentarioHechos?: string;

  @ApiProperty({ description: '¿El ASUNTO fue apropiado?' })
  @IsBoolean()
  asuntoCorrect: boolean;

  @ApiPropertyOptional({ description: 'Corrección del ASUNTO si fue incorrecto' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  asuntoCorregido?: string;

  @ApiPropertyOptional({ description: 'Observaciones adicionales del abogado' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  feedbackLibre?: string;
}
