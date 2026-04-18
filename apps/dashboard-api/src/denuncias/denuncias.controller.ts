import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import axios from 'axios';
import { MinioService } from '@app/storage';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EitherAuthGuard } from '../auth/guards/either-auth.guard';
import { SkipJwt } from '../auth/decorators/skip-jwt.decorator';
import { DenunciasService } from './denuncias.service';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { CreateIncompletaDto } from './dto/create-incompleta.dto';
import { CreateParcialDto } from './dto/create-parcial.dto';
import { UpdateDenunciaDto } from './dto/update-denuncia.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { EditarDenunciaDto } from './dto/editar-denuncia.dto';
import { DenunciaEstado } from './entities/denuncia.entity';

@ApiTags('denuncias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('denuncias')
export class DenunciasController {
  private readonly bucketDocumentos: string;

  constructor(
    private readonly denunciasService: DenunciasService,
    private readonly config: ConfigService,
    private readonly minio: MinioService,
  ) {
    this.bucketDocumentos = this.config.get<string>('MINIO_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
  }

  @Post()
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Crear nueva denuncia (JWT del dashboard o x-internal-key del chatbot)' })
  create(@Body() dto: CreateDenunciaDto) {
    return this.denunciasService.create(dto);
  }

  @Post('manual')
  @ApiOperation({ summary: 'Crear denuncia manual (desde el dashboard)' })
  createManual(@Body() dto: CreateDenunciaDto) {
    return this.denunciasService.createManual(dto);
  }

  @Post('incompleta')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Guardar denuncia incompleta (chatbot — datos parciales del ciudadano)' })
  createIncompleta(@Body() dto: CreateIncompletaDto) {
    return this.denunciasService.createIncompleta(dto);
  }

  @Post('parcial')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Upsert denuncia parcial (chatbot IA — actualiza si ya existe una incompleta del mismo teléfono)' })
  upsertParcial(@Body() dto: CreateParcialDto) {
    return this.denunciasService.upsertParcial(dto);
  }

  @Get('dependencias')
  @ApiOperation({ summary: 'Listar dependencias disponibles' })
  getDependencias() {
    return this.denunciasService.getDependencias();
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

  @Get('usuario/:telefono')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Obtener datos de usuario por teléfono (chatbot — para personalizar bienvenida)' })
  findUsuarioPorTelefono(@Param('telefono') telefono: string) {
    return this.denunciasService.findDatosUsuarioPorTelefono(telefono);
  }

  @Get('parcial/telefono/:telefono')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Buscar denuncia parcial (incompleta) por teléfono — devuelve null si no existe' })
  findParcialPorTelefono(@Param('telefono') telefono: string) {
    return this.denunciasService.findParcialPorTelefono(telefono);
  }

  @Get(':id')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Obtener detalle de una denuncia (JWT dashboard o x-internal-key document-service)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.denunciasService.findOne(id);
  }

  @Patch(':id/editar')
  @ApiOperation({ summary: 'Editar denuncia manual y regenerar documento' })
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarDenunciaDto,
    @Req() req: any,
  ) {
    const updated = await this.denunciasService.editarDenuncia(id, dto, req.user);
    
    if (dto.regenerarDocumento) {
      const docServiceUrl = this.config.get<string>('DOCUMENT_SERVICE_URL', 'http://document-service:3004');
      const internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '');
      
      axios
        .post(`${docServiceUrl}/generar/${id}`, {}, { headers: { 'x-internal-key': internalKey } })
        .catch(() => { /* error silencioso */ });
    }
    
    return updated;
  }

  @Patch(':id')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Actualizar campos de una denuncia (JWT dashboard o x-internal-key document-service)' })
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

  @Post(':id/generar')
  @ApiOperation({ summary: 'Reintentar generación de documento (dispara document-service)' })
  async generarDocumento(@Param('id', ParseIntPipe) id: number) {
    const docServiceUrl = this.config.get<string>('DOCUMENT_SERVICE_URL', 'http://document-service:3004');
    const internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '');

    const updated = await this.denunciasService.marcarDocumentoPendiente(id);

    // Fire-and-forget — no esperamos la respuesta del document-service
    axios
      .post(`${docServiceUrl}/generar/${id}`, {}, { headers: { 'x-internal-key': internalKey } })
      .catch(() => { /* document-service actualizará el estado vía PATCH */ });

    return updated;
  }

  @Get(':id/documento')
  @ApiOperation({ summary: 'Descargar .docx de la denuncia desde MinIO' })
  async descargarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    let denuncia: { radicado: string; documentoUrl: string | null };
    try {
      denuncia = await this.denunciasService.findOne(id);
    } catch {
      throw new HttpException('Denuncia no encontrada', 404);
    }

    if (!denuncia.documentoUrl) {
      throw new HttpException('Documento no disponible', 404);
    }

    // documentoUrl contiene solo el object name dentro del bucket (ej. "DAT-000001.docx")
    const objectName = denuncia.documentoUrl;
    try {
      const buffer = await this.minio.downloadBuffer(this.bucketDocumentos, objectName);
      const filename = `${denuncia.radicado}.docx`;
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
      });
      res.send(buffer);
    } catch {
      throw new HttpException('Documento no disponible', 503);
    }
  }
}
