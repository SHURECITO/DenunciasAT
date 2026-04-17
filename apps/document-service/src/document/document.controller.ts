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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
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
  private readonly docsDir: string;

  constructor(
    private readonly documentService: DocumentService,
    private readonly config: ConfigService,
  ) {
    this.internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '');
    this.docsDir = join(process.cwd(), 'infrastructure', 'documentos');
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

  /** Descarga el .docx generado */
  @Get('documento/:denunciaId')
  async descargar(
    @Param('denunciaId', ParseIntPipe) denunciaId: number,
    @Headers('x-internal-key') key: string,
    @Res() res: Response,
  ) {
    this.checkAuth(key);
    const ruta = await this.documentService.getRutaDocumento(denunciaId);
    if (!ruta || !existsSync(ruta)) {
      throw new NotFoundException('Documento no generado todavía');
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${ruta.split(/[\\/]/).pop()}"`);
    res.sendFile(ruta);
  }
}
