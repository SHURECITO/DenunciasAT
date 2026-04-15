import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateMensajeDto } from './dto/create-mensaje.dto';
import { MensajesService } from './mensajes.service';

@ApiTags('mensajes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mensajes')
export class MensajesController {
  constructor(private readonly mensajesService: MensajesService) {}

  @Get(':denunciaId')
  @ApiOperation({ summary: 'Obtener mensajes de una denuncia' })
  findByDenuncia(@Param('denunciaId', ParseIntPipe) denunciaId: number) {
    return this.mensajesService.findByDenuncia(denunciaId);
  }

  @Post(':denunciaId')
  @ApiOperation({ summary: 'Agregar mensaje a una denuncia' })
  create(
    @Param('denunciaId', ParseIntPipe) denunciaId: number,
    @Body() dto: CreateMensajeDto,
  ) {
    return this.mensajesService.create(denunciaId, dto);
  }
}
