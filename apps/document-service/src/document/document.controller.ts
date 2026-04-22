import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UnauthorizedException,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Response } from 'express';
import axios from 'axios';
import { GcsStorageService } from '@app/storage';
import { DocumentService } from './document.service';
import { GenerarDesdeDescripcionDto } from './dto/generar-desde-descripcion.dto';

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
    private readonly storage: GcsStorageService,
    private readonly config: ConfigService,
  ) {
    const scoped = this.config.get<string>('DASHBOARD_TO_DOCUMENT_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.internalKey = scoped || fallback;
    this.bucketDocumentos = this.config.get<string>('GCS_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
  }

  private secureCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  private checkAuth(key: string | undefined, service: string | undefined) {
    if (
      !this.internalKey ||
      !key ||
      !this.secureCompare(key, this.internalKey) ||
      service !== 'dashboard'
    ) {
      throw new UnauthorizedException('Credenciales internas inválidas');
    }
  }

  /** Inicia la generación del documento de forma asíncrona */
  @Post('generar/:denunciaId')
  @HttpCode(202)
  async generar(
    @Param('denunciaId', ParseIntPipe) denunciaId: number,
    @Headers('x-internal-key') key: string,
    @Headers('x-internal-service') service: string | undefined,
  ) {
    this.checkAuth(key, service);
    // No bloquear la respuesta — la generación puede tardar varios segundos
    this.documentService.generarDocumento(denunciaId).catch(() => {/* errores ya logueados */});
    return { mensaje: 'Generando documento', denunciaId };
  }

  @Post('generar-desde-descripcion')
  async generarDesdeDescripcion(
    @Body() dto: GenerarDesdeDescripcionDto,
    @Headers('x-internal-key') key: string,
    @Headers('x-internal-service') service: string | undefined,
  ) {
    this.checkAuth(key, service);
    
    if (!dto.generarDocumento || dto.esEspecial) {
      return { dependenciaDetectada: null, documentoGenerado: false };
    }
    
    return this.documentService.generarDesdeDescripcion(dto);
  }

  /** Descarga el .docx generado desde GCS */
  @Get('documento/:denunciaId')
  async descargar(
    @Param('denunciaId', ParseIntPipe) denunciaId: number,
    @Headers('x-internal-key') key: string,
    @Headers('x-internal-service') service: string | undefined,
    @Res() res: Response,
  ) {
    this.checkAuth(key, service);
    const objectName = await this.documentService.getRutaDocumento(denunciaId);
    if (!objectName) {
      throw new NotFoundException('Documento no generado todavía');
    }
    try {
      const signedUrl = await this.storage.getSignedUrl(this.bucketDocumentos, objectName);
      const response = await axios.get<ArrayBuffer>(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const buffer = Buffer.from(response.data);
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
