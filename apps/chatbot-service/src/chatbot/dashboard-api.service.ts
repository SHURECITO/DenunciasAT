import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface CreateDenunciaPayload {
  nombreCiudadano: string;
  cedula: string;
  telefono: string;
  ubicacion: string;
  descripcion: string;
  dependenciaAsignada?: string;
  esEspecial?: boolean;
  documentoPendiente?: boolean;
  barrio?: string;
  comuna?: string;
  descripcionResumen?: string;
  esAnonimo?: boolean;
  solicitudAdicional?: string;
  imagenesEvidencia?: string;
}

interface UpsertParcialPayload {
  nombreCiudadano: string;
  telefono: string;
  cedula?: string;
  barrio?: string;
  comuna?: string;
  direccion?: string;
  descripcion?: string;
}

interface GuardarMensajePayload {
  contenido: string;
  tipo: 'TEXTO' | 'AUDIO_TRANSCRITO' | 'IMAGEN' | 'PDF';
  direccion: 'ENTRANTE' | 'SALIENTE';
}

export interface ParcialExistente {
  id: number;
  radicado: string;
  telefono: string;
  incompleta: boolean;
}

interface CompletarDenunciaPayload {
  nombreCiudadano?: string;
  cedula?: string;
  ubicacion?: string;
  descripcion?: string;
  barrio?: string;
  comuna?: string;
  descripcionResumen?: string;
  dependenciaAsignada?: string;
  esAnonimo?: boolean;
  solicitudAdicional?: string;
  imagenesEvidencia?: string;
  documentoPendiente?: boolean;
  incompleta?: boolean;
}

@Injectable()
export class DashboardApiService {
  private readonly logger = new Logger(DashboardApiService.name);
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('DASHBOARD_API_URL', 'http://dashboard-api:3000');
    const serviceKey = this.config.get<string>('CHATBOT_API_INTERNAL_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.internalKey = serviceKey || fallback;
  }

  private get headers() {
    return {
      'x-internal-key': this.internalKey,
      'x-internal-service': 'chatbot',
      'Content-Type': 'application/json',
    };
  }

  async crearDenuncia(payload: CreateDenunciaPayload): Promise<{ id: number; radicado: string }> {
    const res = await axios.post<{ id: number; radicado: string }>(
      `${this.baseUrl}/denuncias`,
      payload,
      { headers: this.headers },
    );
    return res.data;
  }

  async upsertParcial(payload: UpsertParcialPayload): Promise<{ id: number; radicado: string }> {
    const res = await axios.post<{ id: number; radicado: string }>(
      `${this.baseUrl}/denuncias/parcial`,
      payload,
      { headers: this.headers },
    );
    return res.data;
  }

  async buscarUsuarioPorTelefono(telefono: string): Promise<{ nombreCiudadano: string; cedula: string; esAnonimo: boolean } | null> {
    try {
      const res = await axios.get<{ nombreCiudadano: string; cedula: string; esAnonimo: boolean } | null>(
        `${this.baseUrl}/denuncias/usuario/${telefono}`,
        { headers: this.headers },
      );
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Busca una denuncia parcial (incompleta) del mismo teléfono.
   * Retorna null si no hay. Usado para evitar duplicar registros
   * cuando un ciudadano ya había guardado datos parciales.
   */
  async buscarParcialPorTelefono(telefono: string): Promise<ParcialExistente | null> {
    try {
      const res = await axios.get<ParcialExistente | null>(
        `${this.baseUrl}/denuncias/parcial/telefono/${telefono}`,
        { headers: this.headers },
      );
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Completa una denuncia parcial: actualiza todos los campos y marca incompleta:false.
   * El radicado ya asignado al crear la parcial se conserva.
   */
  async completarDenuncia(
    id: number,
    payload: CompletarDenunciaPayload,
  ): Promise<{ id: number; radicado: string }> {
    const res = await axios.patch<{ id: number; radicado: string }>(
      `${this.baseUrl}/denuncias/${id}`,
      { ...payload, incompleta: false },
      { headers: this.headers },
    );
    return { id: res.data.id, radicado: res.data.radicado };
  }

  async guardarMensaje(denunciaId: number, payload: GuardarMensajePayload): Promise<void> {
    await axios.post(
      `${this.baseUrl}/mensajes/${denunciaId}`,
      payload,
      { headers: this.headers },
    );
  }

  async eliminarDenuncia(id: number): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/denuncias/${id}/cancelar-parcial`, {}, { headers: this.headers });
    } catch (err) {
      if ((err as any).response?.status !== 404) {
        throw err;
      }
    }
  }

  async triggerDocumentacion(denunciaId: number): Promise<void> {
    await axios.post(
      `${this.baseUrl}/denuncias/${denunciaId}/generar`,
      {},
      { headers: this.headers },
    );
  }
}
