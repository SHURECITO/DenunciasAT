import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { GeminiService } from '@app/ai';
import { DashboardApiService } from './dashboard-api.service';
import { DocumentBuilderService } from './document-builder.service';

const DOCS_DIR = join(process.cwd(), 'infrastructure', 'documentos');

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  // Map denunciaId → ruta del archivo ya generado (cache en memoria)
  private readonly rutasGeneradas = new Map<number, string>();

  constructor(
    private readonly dashboardApi: DashboardApiService,
    private readonly builder: DocumentBuilderService,
    private readonly gemini: GeminiService,
  ) {}

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
      this.logger.log(`Denuncia #${denunciaId} es especial — omitiendo generación de documento`);
      return;
    }

    try {
      // Generar sección HECHOS con Gemini (única llamada a IA)
      const hechos = await this.gemini.generarHechos({
        nombreCiudadano: denuncia.nombreCiudadano,
        esAnonimo: denuncia.esAnonimo,
        barrio: denuncia.barrio ?? '',
        comuna: denuncia.comuna ?? '',
        direccion: denuncia.ubicacion,
        descripcion: denuncia.descripcion,
        dependencia: denuncia.dependenciaAsignada ?? 'la entidad competente',
      });

      // Construir el .docx
      const rutaArchivo = join(DOCS_DIR, `${denuncia.radicado}.docx`);
      await this.builder.construir({
        denuncia,
        hechos,
        rutaDestino: rutaArchivo,
      });

      // Guardar ruta en cache y notificar a dashboard-api
      this.rutasGeneradas.set(denunciaId, rutaArchivo);
      await this.dashboardApi.notificarDocumentoOk(denunciaId, `${denuncia.radicado}.docx`);
      this.logger.log(`Documento generado: ${rutaArchivo}`);
    } catch (err) {
      this.logger.error(`Error generando documento para denuncia #${denunciaId}:`, err);
      await this.dashboardApi.notificarDocumentoError(denunciaId);
    }
  }

  async getRutaDocumento(denunciaId: number): Promise<string | null> {
    // Comprobar cache en memoria primero
    if (this.rutasGeneradas.has(denunciaId)) {
      return this.rutasGeneradas.get(denunciaId)!;
    }
    // Intentar reconstruir ruta desde la denuncia (tras reinicio del servicio)
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
