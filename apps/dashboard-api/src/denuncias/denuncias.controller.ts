import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DenunciasService } from './denuncias.service';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { DenunciaEstado } from './entities/denuncia.entity';

@ApiTags('denuncias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('denuncias')
export class DenunciasController {
  constructor(private readonly denunciasService: DenunciasService) {}

  @Post()
  @ApiOperation({ summary: 'Crear nueva denuncia' })
  create(@Body() dto: CreateDenunciaDto) {
    return this.denunciasService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar denuncias con filtro opcional por estado' })
  @ApiQuery({ name: 'estado', enum: DenunciaEstado, required: false })
  findAll(@Query('estado') estado?: DenunciaEstado) {
    return this.denunciasService.findAll(estado);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de una denuncia' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.denunciasService.findOne(id);
  }

  @Patch(':id/estado')
  @ApiOperation({ summary: 'Cambiar estado de una denuncia (solo avanza)' })
  updateEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEstadoDto,
  ) {
    return this.denunciasService.updateEstado(id, dto);
  }
}
