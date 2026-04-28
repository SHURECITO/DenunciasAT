import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  Req,
  Delete,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response, Request } from 'express';
import { randomUUID } from 'crypto';
import { FileInterceptor } from '@nestjs/platform-express';
import axios from 'axios';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EitherAuthGuard } from '../auth/guards/either-auth.guard';
import { SkipJwt } from '../auth/decorators/skip-jwt.decorator';
import { GcsStorageService } from '@app/storage';
import { DenunciasService } from './denuncias.service';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { CreateIncompletaDto } from './dto/create-incompleta.dto';
import { CreateParcialDto } from './dto/create-parcial.dto';
import { UpdateDenunciaDto } from './dto/update-denuncia.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { EditarDenunciaDto } from './dto/editar-denuncia.dto';
import { GenerarManualDto } from './dto/generar-manual.dto';
import { DenunciaEstado } from './entities/denuncia.entity';

@ApiTags('denuncias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('denuncias')
export class DenunciasController {
  private readonly bucketDocumentos: string;
  private readonly dashboardToDocumentKey: string;

  constructor(
    private readonly denunciasService: DenunciasService,
    private readonly storage: GcsStorageService,
    private readonly config: ConfigService,
  ) {
    this.bucketDocumentos = this.config.get<string>('GCS_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
    const scoped = this.config.get<string>('DASHBOARD_TO_DOCUMENT_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.dashboardToDocumentKey = scoped || fallback;
  }

  private getDocumentServiceHeaders(): Record<string, string> {
    return {
      'x-internal-key': this.dashboardToDocumentKey,
      'x-internal-service': 'dashboard',
    };
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
  async createManual(@Body() dto: CreateDenunciaDto) {
    const denuncia = await this.denunciasService.createManual(dto);
    // Disparar clasificación + generación de documento automáticamente para denuncias no especiales
    if (!denuncia.esEspecial) {
      const docServiceUrl = this.config.get<string>('DOCUMENT_SERVICE_URL', 'http://document-service:3004');
      axios
        .post(
          `${docServiceUrl}/generar-desde-descripcion`,
          {
            denunciaId: denuncia.id,
            descripcion: denuncia.descripcion,
            ubicacion: denuncia.ubicacion,
            barrio: denuncia.barrio ?? undefined,
            esEspecial: false,
            generarDocumento: true,
          },
          { headers: this.getDocumentServiceHeaders() },
        )
        .catch(() => {});
    }
    return denuncia;
  }

  @Post('evidencias/upload')
  @UseInterceptors(FileInterceptor('file', {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    storage: require('multer').memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: 'Subir imagen de evidencia para denuncia manual (JPG/PNG, máx 10 MB)' })
  async uploadEvidencia(@UploadedFile() file: any) {
    if (!file) throw new HttpException('Archivo requerido', 400);
    const allowed = ['image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype as string)) {
      throw new HttpException('Solo se aceptan imágenes JPG o PNG', 400);
    }
    const ext = (file.mimetype as string) === 'image/png' ? 'png' : 'jpg';
    const objectName = `manual/${Date.now()}-${randomUUID()}.${ext}`;
    const bucket = this.config.get<string>('GCS_BUCKET_EVIDENCIAS', 'denunciasat-evidencias');
    await this.storage.uploadBuffer(bucket, objectName, file.buffer as Buffer, file.mimetype as string);
    return { url: `gs://${bucket}/${objectName}` };
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
    @Req() req: Request,
  ) {
    const updated = await this.denunciasService.editarDenuncia(id, dto, req.user);
    
    if (dto.regenerarDocumento) {
      const docServiceUrl = this.config.get<string>('DOCUMENT_SERVICE_URL', 'http://document-service:3004');
      axios
        .post(`${docServiceUrl}/generar/${id}`, {}, { headers: this.getDocumentServiceHeaders() })
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
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Reintentar generación de documento (dispara document-service)' })
  async generarDocumento(@Param('id', ParseIntPipe) id: number) {
    const docServiceUrl = this.config.get<string>('DOCUMENT_SERVICE_URL', 'http://document-service:3004');

    const updated = await this.denunciasService.marcarDocumentoPendiente(id);

    // Fire-and-forget — no esperamos la respuesta del document-service
    axios
      .post(`${docServiceUrl}/generar/${id}`, {}, { headers: this.getDocumentServiceHeaders() })
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

    const objectName = denuncia.documentoUrl;
    try {
      const signedUrl = await this.storage.getSignedUrl(this.bucketDocumentos, objectName);
      const response = await axios.get<ArrayBuffer>(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const buffer = Buffer.from(response.data);
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

  @Post(':id/eliminar')
  @ApiOperation({ summary: 'Eliminar una denuncia completamente de la DB' })
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.denunciasService.eliminarDenuncia(id);
  }

  @Post(':id/cancelar-parcial')
  @SkipJwt()
  @UseGuards(EitherAuthGuard)
  @ApiOperation({ summary: 'Eliminar una denuncia parcial (incompleta) desde flujo interno' })
  async cancelarParcial(@Param('id', ParseIntPipe) id: number) {
    return this.denunciasService.cancelarParcial(id);
  }

  // Soporte para verbo DELETE nativo
  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una denuncia completamente de la DB' })
  async deleteNative(@Param('id', ParseIntPipe) id: number) {
    return this.denunciasService.eliminarDenuncia(id);
  }

  @Post('generar-manual')
  @ApiOperation({ summary: 'Genera documento pasándolo al document-service' })
  async generarManual(@Body() body: GenerarManualDto) {
    const documentServiceUrl = this.config.get<string>('DOCUMENT_SERVICE_URL', 'http://document-service:3004');

    try {
      const res = await axios.post(`${documentServiceUrl}/generar-desde-descripcion`, body, {
        headers: this.getDocumentServiceHeaders(),
      });
      return res.data;
    } catch (e: any) {
      throw new HttpException(e.response?.data?.message || 'Error en document-service', e.response?.status || 500);
    }
  }
}
