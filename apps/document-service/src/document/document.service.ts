import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { GeminiService, InferenciasService } from '@app/ai';
import { GcsStorageService } from '@app/storage';
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
    private readonly inferencias: InferenciasService,
    private readonly gemini: GeminiService,
    private readonly storage: GcsStorageService,
    private readonly config: ConfigService,
  ) {
    this.bucketDocumentos = this.config.get<string>('GCS_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
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

    // Declarado fuera del try para que el bloque finally pueda limpiar el archivo temporal
    let rutaArchivo: string | null = null;
    let archivoSubido = false;

    try {
      const dependencia = denuncia.dependenciaAsignada ?? 'la entidad competente';
      const resumen     = denuncia.descripcionResumen ?? denuncia.descripcion.substring(0, 200);
      const inferencia = this.inferencias.resolverCaso(denuncia.descripcion, {
        dependenciaActual: dependencia,
        descripcionActual: denuncia.descripcion,
      });
      const admisibilidad = this.inferencias.evaluarAdmisibilidad({
        inputUsuario: denuncia.descripcion,
        descripcion: denuncia.descripcion,
        ubicacion: denuncia.ubicacion,
        direccion: denuncia.ubicacion,
        barrio: denuncia.barrio ?? undefined,
        comuna: denuncia.comuna ?? undefined,
        tipoCaso: inferencia.tipoCaso,
        confianza: inferencia.confianza,
        dependenciaPrincipal: inferencia.dependenciaPrincipal,
        dependenciaSecundaria: inferencia.dependenciaSecundaria,
      });

      if (!admisibilidad.esAdmisible && admisibilidad.bloquearRadicacion) {
        this.logger.warn(
          `Denuncia #${denunciaId} no admisible para documento: motivo=${admisibilidad.motivo}, bloquear=${admisibilidad.bloquearRadicacion}`,
        );
        await this.dashboardApi.notificarDocumentoError(
          denunciaId,
          `No admisible para documento: ${admisibilidad.motivo}`,
        );
        return;
      }

      if (!admisibilidad.esAdmisible) {
        this.logger.warn(
          `Denuncia #${denunciaId} no admisible, pero no bloquea: motivo=${admisibilidad.motivo}. Se continua con generacion.`,
        );
      }

      this.logger.log(`Denuncia #${denunciaId} — iniciando llamadas Gemini (hechos + asunto)`);
      const dependenciaPrincipal = inferencia.dependenciaPrincipal;
      const dependenciaSecundaria = inferencia.dependenciaSecundaria;
      const hayMultiple = !!dependenciaSecundaria;
      const normativaAplicable = inferencia.normativaAplicable;

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
          descripcion:     denuncia.descripcion,
          ubicacion:       denuncia.ubicacion,
          nombreCiudadano: denuncia.nombreCiudadano,
          esAnonimo:       denuncia.esAnonimo,
          direccion:       denuncia.ubicacion,
          barrio:          denuncia.barrio ?? '',
          comuna:          denuncia.comuna ?? '',
          dependenciaPrincipal,
          dependenciaSecundaria,
          normativaAplicable,
        }),
        asuntoEstructurado
          ? Promise.resolve(asuntoEstructurado)
          : this.gemini.generarAsunto({ descripcionResumen: resumen, dependencia: dependenciaPrincipal }),
      ]);
      const asunto = asuntoGenerado;
      this.logger.log(`Denuncia #${denunciaId} — Gemini completado. Construyendo .docx`);

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
      rutaArchivo        = join(DOCS_DIR, `${denuncia.radicado}.docx`);
      const objectName   = `${denuncia.radicado}.docx`;
      await this.builder.construir({
        denuncia,
        hechos,
        asunto,
        solicitudAdicional: denuncia.solicitudAdicional ?? undefined,
        imagenes,
        rutaDestino: rutaArchivo,
        dependenciaSecundaria,
        dependenciasEstructuradas,
      });

      // Leer buffer y validar integridad antes de subir a GCS
      this.logger.log(`Denuncia #${denunciaId} — .docx construido. Validando e iniciando subida a GCS`);
      const docxBuffer  = await readFile(rutaArchivo);
      const validacion  = this.validarDocx(docxBuffer, denuncia);
      if (!validacion.ok) {
        this.logger.error(`Documento inválido para denuncia #${denunciaId}: ${validacion.reason}`);
        await this.dashboardApi.notificarDocumentoError(
          denunciaId,
          `Documento inválido: ${validacion.reason}`,
        );
        return; // finally se encarga de eliminar rutaArchivo
      }

      // Subir .docx a GCS
      await this.storage.uploadBuffer(this.bucketDocumentos, objectName, docxBuffer, DOCX_CONTENT_TYPE);
      archivoSubido = true;

      // Notificar a dashboard-api con el object name (bucket implícito en la config)
      this.rutasGeneradas.set(denunciaId, objectName);
      await this.dashboardApi.notificarDocumentoOk(denunciaId, objectName);
      this.logger.log(`Documento generado y subido a GCS: ${this.bucketDocumentos}/${objectName}`);
    } catch (err) {
      const reason = this.formatErrorReason(err);
      this.logger.error(`Error generando documento para denuncia #${denunciaId}: ${reason}`);
      await this.dashboardApi.notificarDocumentoError(denunciaId, reason);
    } finally {
      // Eliminar archivo temporal siempre, tanto en éxito como en error
      if (rutaArchivo) {
        await unlink(rutaArchivo).catch((e) => {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            this.logger.warn(`No se pudo eliminar archivo temporal ${rutaArchivo}: ${(e as Error).message}`);
          }
        });
        if (archivoSubido) {
          this.logger.debug(`Archivo temporal eliminado tras subida exitosa: ${rutaArchivo}`);
        }
      }
    }
  }

  private formatErrorReason(err: unknown): string {
    if (!err) return 'Error desconocido';
    if (err instanceof Error) {
      const code = (err as NodeJS.ErrnoException).code;
      const msg = err.message || 'Error desconocido';
      return code ? `${msg} (code: ${code})` : msg;
    }
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Error desconocido';
    }
  }

  async generarDesdeDescripcion(dto: {
    denunciaId: number;
    descripcion: string;
    ubicacion: string;
    barrio?: string;
    esEspecial: boolean;
    generarDocumento: boolean;
  }): Promise<{ dependenciaDetectada: string | null; documentoGenerado: boolean }> {
    let dependenciaDetectada = 'Alcaldía de Medellín';
    let documentoGenerado = dto.generarDocumento;
    
    if (dto.generarDocumento) {
      const inferencia = this.inferencias.resolverCaso(dto.descripcion, {
        descripcionActual: dto.descripcion,
      });
      const admisibilidad = this.inferencias.evaluarAdmisibilidad({
        inputUsuario: dto.descripcion,
        descripcion: dto.descripcion,
        ubicacion: dto.ubicacion,
        direccion: dto.ubicacion,
        barrio: dto.barrio,
        tipoCaso: inferencia.tipoCaso,
        confianza: inferencia.confianza,
        dependenciaPrincipal: inferencia.dependenciaPrincipal,
        dependenciaSecundaria: inferencia.dependenciaSecundaria,
      });

      if (!admisibilidad.esAdmisible && admisibilidad.bloquearRadicacion) {
        this.logger.warn(
          `Denuncia #${dto.denunciaId} no admisible para generación manual: motivo=${admisibilidad.motivo}, bloquear=${admisibilidad.bloquearRadicacion}`,
        );
        documentoGenerado = false;
      } else if (!admisibilidad.esAdmisible) {
        this.logger.warn(
          `Denuncia #${dto.denunciaId} no admisible, pero no bloquea: motivo=${admisibilidad.motivo}. Se continua con generacion manual.`,
        );
      }

      if (inferencia.tipoCaso !== 'nulo') {
        dependenciaDetectada = inferencia.dependenciaSecundaria
          ? `${inferencia.dependenciaPrincipal}, ${inferencia.dependenciaSecundaria}`
          : inferencia.dependenciaPrincipal;
      }

      try {
        if (inferencia.tipoCaso === 'nulo') {
          const fallback = await this.gemini.clasificarDenuncia(dto.descripcion);
          dependenciaDetectada = fallback.dependencia;
        }
      } catch (err) {
        this.logger.error('Error clasificando dependencia', err);
        try {
          const fallback = await this.gemini.clasificarDenuncia(dto.descripcion);
          dependenciaDetectada = fallback.dependencia;
        } catch (e) {}
      }
      
      try {
        await this.dashboardApi.updateDenuncia(dto.denunciaId, { 
          dependenciaAsignada: dependenciaDetectada,
          documentoGeneradoOk: false,
          documentoPendiente: documentoGenerado
        });
      } catch (e) {
        this.logger.warn(`No se pudo actualizar dependencia para denuncia ${dto.denunciaId}`);
      }
      
      if (documentoGenerado) {
        this.generarDocumento(dto.denunciaId).catch(() => {});
      }
    }

    return {
      dependenciaDetectada,
      documentoGenerado
    };
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
        this.rutasGeneradas.set(denunciaId, denuncia.documentoUrl);
        return denuncia.documentoUrl;
      }
    } catch {
      // ignorar
    }
    return null;
  }
}
