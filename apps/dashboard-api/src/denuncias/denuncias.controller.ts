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
import { UpdateDenunciaDto } from './dto/update-denuncia.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { DenunciaEstado } from './entities/denuncia.entity';

@ApiTags('denuncias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('denuncias')
export class DenunciasController {
  constructor(private readonly denunciasService: DenunciasService) {}

  @Post()
  @ApiOperation({ summary: 'Crear nueva denuncia (vía chatbot)' })
  create(@Body() dto: CreateDenunciaDto) {
    return this.denunciasService.create(dto);
  }

  @Post('manual')
  @ApiOperation({ summary: 'Crear denuncia manual (desde el dashboard)' })
  createManual(@Body() dto: CreateDenunciaDto) {
    return this.denunciasService.createManual(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar denuncias con filtro opcional por estado' })
  @ApiQuery({ name: 'estado', enum: DenunciaEstado, required: false })
  findAll(@Query('estado') estado?: DenunciaEstado) {
    return this.denunciasService.findAll(estado);
  }

  @Get('especiales')
  @ApiOperation({ summary: 'Listar denuncias marcadas como especiales' })
  findEspeciales() {
    return this.denunciasService.findEspeciales();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de una denuncia' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.denunciasService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar campos de una denuncia' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDenunciaDto,
  ) {
    return this.denunciasService.update(id, dto);
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
