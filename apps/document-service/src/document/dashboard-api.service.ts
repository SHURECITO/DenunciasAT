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
    this.internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '');
  }

  private get headers() {
    return { 'x-internal-key': this.internalKey, 'Content-Type': 'application/json' };
  }

  async getDenuncia(id: number): Promise<DenunciaData> {
    const res = await axios.get<DenunciaData>(`${this.baseUrl}/denuncias/${id}`, {
      headers: this.headers,
    });
    return res.data;
  }

  async notificarDocumentoOk(id: number, documentoUrl: string): Promise<void> {
    await axios.patch(
      `${this.baseUrl}/denuncias/${id}`,
      { documentoGeneradoOk: true, documentoPendiente: false, documentoUrl },
      { headers: this.headers },
    );
  }

  async notificarDocumentoError(id: number): Promise<void> {
    try {
      await axios.patch(
        `${this.baseUrl}/denuncias/${id}`,
        { documentoGeneradoOk: false, documentoPendiente: false },
        { headers: this.headers },
      );
    } catch (err) {
      this.logger.warn(`No se pudo notificar error de documento para ${id}: ${(err as Error).message}`);
    }
  }
}
