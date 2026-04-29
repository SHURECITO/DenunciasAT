import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface DenunciaData {
  id: number;
  radicado: string;
  nombreCiudadano: string;
  cedula: string;
  telefono: string;
  ubicacion: string;
  barrio: string | null;
  comuna: string | null;
  descripcion: string;
  descripcionResumen: string | null;
  dependenciaAsignada: string | null;
  esAnonimo: boolean;
  esEspecial: boolean;
  documentoUrl: string | null;
  documentoGeneradoOk: boolean;
  documentoPendiente: boolean;
  fechaCreacion: string;
  solicitudAdicional: string | null;
  imagenesEvidencia: string | null;
}

@Injectable()
export class DashboardApiService {
  private readonly logger = new Logger(DashboardApiService.name);
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('DASHBOARD_API_URL', 'http://dashboard-api:3000');
    const scoped = this.config.get<string>('DOCUMENT_API_INTERNAL_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.internalKey = scoped || fallback;
  }

  private get headers() {
    return {
      'x-internal-key': this.internalKey,
      'x-internal-service': 'document',
      'Content-Type': 'application/json',
    };
  }

  async getDenuncia(id: number): Promise<DenunciaData> {
    const res = await axios.get<DenunciaData>(`${this.baseUrl}/denuncias/${id}`, {
      headers: this.headers,
    });
    return res.data;
  }

  async updateDenuncia(id: number, data: Partial<DenunciaData>): Promise<void> {
    await axios.patch(`${this.baseUrl}/denuncias/${id}`, data, { headers: this.headers });
  }

  async notificarDocumentoOk(id: number, documentoUrl: string): Promise<void> {
    await axios.patch(
      `${this.baseUrl}/denuncias/${id}`,
      { documentoGeneradoOk: true, documentoPendiente: false, documentoUrl },
      { headers: this.headers },
    );
  }

  async notificarDocumentoError(id: number, reason?: string): Promise<void> {
    try {
      const reasonHeader = reason?.slice(0, 300);
      const headers = reasonHeader
        ? { ...this.headers, 'x-document-error': reasonHeader }
        : this.headers;
      await axios.patch(
        `${this.baseUrl}/denuncias/${id}`,
        { documentoGeneradoOk: false, documentoPendiente: false },
        { headers },
      );
    } catch (err) {
      this.logger.warn(`No se pudo notificar error de documento para ${id}: ${(err as Error).message}`);
    }
  }
}
