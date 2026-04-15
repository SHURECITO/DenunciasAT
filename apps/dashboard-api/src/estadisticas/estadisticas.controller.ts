import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EstadisticasService } from './estadisticas.service';

@ApiTags('estadisticas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('estadisticas')
export class EstadisticasController {
  constructor(private readonly estadisticasService: EstadisticasService) {}

  @Get('resumen')
  @ApiOperation({ summary: 'Resumen general con métricas clave' })
  @ApiQuery({ name: 'desde', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'hasta', required: false, example: '2026-12-31' })
  getResumen(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.estadisticasService.getResumen(desde, hasta);
  }

  @Get('por-dependencia')
  @ApiOperation({ summary: 'Denuncias agrupadas por dependencia asignada' })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  getPorDependencia(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.estadisticasService.getPorDependencia(desde, hasta);
  }

  @Get('por-periodo')
  @ApiOperation({ summary: 'Denuncias agrupadas por semana o mes' })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'agrupacion', enum: ['semana', 'mes'], required: false })
  getPorPeriodo(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('agrupacion') agrupacion?: 'semana' | 'mes',
  ) {
    return this.estadisticasService.getPorPeriodo(desde, hasta, agrupacion);
  }

  @Get('exportar-excel')
  @ApiOperation({ summary: 'Exportar listado de denunciantes en .xlsx' })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  async exportarExcel(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Res() res?: Response,
  ) {
    await this.estadisticasService.exportarExcel(desde, hasta, res!);
  }

  @Get('exportar-pdf')
  @ApiOperation({ summary: 'Exportar informe ejecutivo en PDF' })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  async exportarPdf(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Res() res?: Response,
  ) {
    await this.estadisticasService.exportarPdf(desde, hasta, res!);
  }
}
