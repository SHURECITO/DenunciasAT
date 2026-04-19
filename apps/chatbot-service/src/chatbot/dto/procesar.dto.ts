import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';

export class ProcesarDto {
  @ApiProperty({ example: '573001234567' })
  @IsString()
  @Matches(/^\d{7,15}$/)
  numero: string;

  @ApiProperty({ example: 'Hola, quiero denunciar...' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 4000)
  mensaje: string;

  @ApiProperty({ example: 'conversation' })
  @IsString()
  @IsIn(['conversation', 'extendedTextMessage', 'imageMessage', 'documentMessage', 'audioMessage'])
  tipo: string;

  @ApiPropertyOptional({ example: 'http://evolution-api:8080/media/...' })
  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false })
  mediaUrl?: string;
}
