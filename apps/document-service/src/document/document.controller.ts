import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UnauthorizedException,
  Headers,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { MinioService } from '@app/storage';
import { DocumentService } from './document.service';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'document-service', timestamp: new Date() };
  }
}

@Controller()
export class DocumentController {
  private readonly internalKey: string;
  private readonly bucketDocumentos: string;

  constructor(
    private readonly documentService: DocumentService,
    private readonly minio: MinioService,
    private readonly config: ConfigService,
  ) {
    this.internalKey      = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '');
    this.bucketDocumentos = this.config.get<string>('MINIO_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
  }

  private checkAuth(key: string | undefined) {
    if (!this.internalKey || key !== this.internalKey) {
      throw new UnauthorizedException('x-internal-key requerido');
    }
  }

  /** Inicia la generación del documento de forma asíncrona */
  @Post('generar/:denunciaId')
  @HttpCode(202)
  async generar(
    @Param('denunciaId', ParseIntPipe) denunciaId: number,
    @Headers('x-internal-key') key: string,
  ) {
    this.checkAuth(key);
    // No bloquear la respuesta — la generación puede tardar varios segundos
    this.documentService.generarDocumento(denunciaId).catch(() => {/* errores ya logueados */});
    return { mensaje: 'Generando documento', denunciaId };
  }

  @Post('generar-desde-descripcion')
  async generarDesdeDescripcion(
    @Body() dto: {
      denunciaId: number;
      descripcion: string;
      ubicacion: string;
      barrio: string;
      esEspecial: boolean;
      generarDocumento: boolean;
    },
    @Headers('x-internal-key') key: string,
  ) {
    this.checkAuth(key);
    
    if (!dto.generarDocumento || dto.esEspecial) {
      return { dependenciaDetectada: null, documentoGenerado: false };
    }
    
    return this.documentService.generarDesdeDescripcion(dto);
  }

  /** Descarga el .docx generado desde MinIO */
  @Get('documento/:denunciaId')
  async descargar(
    @Param('denunciaId', ParseIntPipe) denunciaId: number,
    @Headers('x-internal-key') key: string,
    @Res() res: Response,
  ) {
    this.checkAuth(key);
    const objectName = await this.documentService.getRutaDocumento(denunciaId);
    if (!objectName) {
      throw new NotFoundException('Documento no generado todavía');
    }
    try {
      const buffer = await this.minio.downloadBuffer(this.bucketDocumentos, objectName);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${objectName}"`,
        'Content-Length': buffer.length,
      });
      res.send(buffer);
    } catch {
      throw new NotFoundException('Documento no disponible en almacenamiento');
    }
  }
}
