import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '@app/ai';
import { MinioService } from '@app/storage';
import { DashboardApiService, DenunciaData } from './dashboard-api.service';
import { DocumentBuilderService, DependenciaSolicitud } from './document-builder.service';

import AdmZip = require('adm-zip');

const DOCS_DIR = join(process.cwd(), 'infrastructure', 'documentos');
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  // Map denunciaId → ruta del archivo ya generado (cache en memoria)
  private readonly rutasGeneradas = new Map<number, string>();

  private readonly bucketDocumentos: string;

  constructor(
    private readonly dashboardApi: DashboardApiService,
    private readonly builder: DocumentBuilderService,
    private readonly gemini: GeminiService,
    private readonly minio: MinioService,
    private readonly config: ConfigService,
  ) {
    this.bucketDocumentos = this.config.get<string>('MINIO_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
  }

  async generarDocumento(denunciaId: number): Promise<void> {
    this.logger.log(`Iniciando generación de documento para denuncia #${denunciaId}`);

    let denuncia;
    try {
      denuncia = await this.dashboardApi.getDenuncia(denunciaId);
    } catch (err) {
      this.logger.error(`No se pudo obtener la denuncia #${denunciaId}: ${(err as Error).message}`);
      return;
    }

    // Denuncias especiales no generan documento
    if (denuncia.esEspecial) {
      this.logger.log(`Denuncia #${denunciaId} es especial — omitiendo generación`);
      return;
    }

    try {
      const dependencia = denuncia.dependenciaAsignada ?? 'la entidad competente';
      const resumen     = denuncia.descripcionResumen ?? denuncia.descripcion.substring(0, 200);
      const depList     = dependencia.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const hayMultiple = depList.length > 1;

      // Cuando hay múltiples dependencias, pedir a Gemini solicitudes específicas por cada una.
      // Si el resultado trae solicitudes → las usamos para construir la sección SOLICITUD por bloques.
      let dependenciasEstructuradas: DependenciaSolicitud[] | undefined;
      let asuntoEstructurado: string | undefined;
      if (hayMultiple) {
        const clasif = await this.gemini.clasificarDenunciaEstructurada(
          denuncia.descripcion,
          denuncia.ubicacion,
          denuncia.barrio ?? undefined,
        );
        if (clasif && clasif.dependencias.length > 1) {
          dependenciasEstructuradas = clasif.dependencias.map((d) => ({
            nombre:              d.nombre,
            solicitudEspecifica: d.solicitudEspecifica,
          }));
          if (clasif.asunto) asuntoEstructurado = clasif.asunto;
        }
      }

      // Generar HECHOS y ASUNTO en paralelo (ambos usan Gemini con el prompt jurídico)
      const [hechos, asuntoGenerado] = await Promise.all([
        this.gemini.generarHechos({
          nombreCiudadano: denuncia.nombreCiudadano,
          esAnonimo:       denuncia.esAnonimo,
          barrio:          denuncia.barrio ?? '',
          comuna:          denuncia.comuna ?? '',
          direccion:       denuncia.ubicacion,
          descripcion:     denuncia.descripcion,
          dependencia,
        }),
        asuntoEstructurado
          ? Promise.resolve(asuntoEstructurado)
          : this.gemini.generarAsunto({ descripcionResumen: resumen, dependencia }),
      ]);
      const asunto = asuntoGenerado;

      // Deserializar imágenes de evidencia (almacenadas como JSON string)
      let imagenes: string[] = [];
      if (denuncia.imagenesEvidencia) {
        try {
          imagenes = JSON.parse(denuncia.imagenesEvidencia) as string[];
        } catch {
          this.logger.warn(`imagenesEvidencia no es JSON válido para denuncia #${denunciaId}`);
        }
      }

      // Construir el .docx en disco temporal
      const rutaArchivo  = join(DOCS_DIR, `${denuncia.radicado}.docx`);
      const objectName   = `${denuncia.radicado}.docx`;
      await this.builder.construir({
        denuncia,
        hechos,
        asunto,
        solicitudAdicional: denuncia.solicitudAdicional ?? undefined,
        imagenes,
        rutaDestino: rutaArchivo,
        dependenciasEstructuradas,
      });

      // Leer buffer y validar integridad antes de subir a MinIO
      const docxBuffer  = await readFile(rutaArchivo);
      const validacion  = this.validarDocx(docxBuffer, denuncia);
      if (!validacion.ok) {
        this.logger.error(`Documento inválido para denuncia #${denunciaId}: ${validacion.reason}`);
        await unlink(rutaArchivo).catch(() => undefined);
        await this.dashboardApi.notificarDocumentoError(denunciaId);
        return;
      }

      // Subir .docx a MinIO y eliminar archivo temporal local
      await this.minio.uploadBuffer(this.bucketDocumentos, objectName, docxBuffer, DOCX_CONTENT_TYPE);
      await unlink(rutaArchivo).catch((err) =>
        this.logger.warn(`No se pudo eliminar archivo temporal ${rutaArchivo}: ${(err as Error).message}`),
      );

      // Notificar a dashboard-api con el object name (bucket implícito en la config)
      this.rutasGeneradas.set(denunciaId, objectName);
      await this.dashboardApi.notificarDocumentoOk(denunciaId, objectName);
      this.logger.log(`Documento generado y subido a MinIO: ${this.bucketDocumentos}/${objectName}`);
    } catch (err) {
      this.logger.error(`Error generando documento para denuncia #${denunciaId}:`, err);
      await this.dashboardApi.notificarDocumentoError(denunciaId);
    }
  }

  /**
   * Valida el .docx antes de subirlo a MinIO:
   * - ZIP válido con word/document.xml
   * - xmlns:r presente (indispensable para imágenes y headers/footers)
   * - FIRMA_NOMBRE y FIRMA_CARGO presentes (Mercurio los busca)
   * - sectPr con headerReference y footerReference (preserva membrete)
   * - El nombre del ciudadano NO aparece en la sección HECHOS
   */
  private validarDocx(buffer: Buffer, denuncia: DenunciaData): { ok: boolean; reason?: string } {
    let doc: string;
    try {
      const zip   = new AdmZip(buffer);
      const entry = zip.getEntry('word/document.xml');
      if (!entry) return { ok: false, reason: 'word/document.xml no encontrado' };
      doc = zip.readAsText('word/document.xml');
    } catch (err) {
      return { ok: false, reason: `ZIP inválido: ${(err as Error).message}` };
    }

    if (!doc.includes('xmlns:r=')) {
      return { ok: false, reason: 'namespace xmlns:r ausente' };
    }
    if (!doc.includes('FIRMA_NOMBRE') || !doc.includes('FIRMA_CARGO')) {
      return { ok: false, reason: 'placeholders FIRMA_NOMBRE/FIRMA_CARGO ausentes' };
    }
    if (!doc.includes('w:headerReference') || !doc.includes('w:footerReference')) {
      return { ok: false, reason: 'sectPr sin headerReference/footerReference' };
    }
    if (!denuncia.esAnonimo && denuncia.nombreCiudadano) {
      const hechosMatch = doc.match(/HECHOS[\s\S]*?SOLICITUD/);
      if (hechosMatch && hechosMatch[0].includes(denuncia.nombreCiudadano)) {
        return { ok: false, reason: 'nombre del ciudadano aparece en HECHOS' };
      }
    }
    return { ok: true };
  }

  async getRutaDocumento(denunciaId: number): Promise<string | null> {
    if (this.rutasGeneradas.has(denunciaId)) {
      return this.rutasGeneradas.get(denunciaId)!;
    }
    try {
      const denuncia = await this.dashboardApi.getDenuncia(denunciaId);
      if (denuncia.documentoUrl) {
        const ruta = join(DOCS_DIR, denuncia.documentoUrl);
        this.rutasGeneradas.set(denunciaId, ruta);
        return ruta;
      }
    } catch {
      // ignorar
    }
    return null;
  }
}
