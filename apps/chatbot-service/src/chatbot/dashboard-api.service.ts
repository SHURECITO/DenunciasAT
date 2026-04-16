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
    return {
      'x-internal-key': this.internalKey,
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

  async guardarMensaje(denunciaId: number, payload: GuardarMensajePayload): Promise<void> {
    await axios.post(
      `${this.baseUrl}/mensajes/${denunciaId}`,
      payload,
      { headers: this.headers },
    );
  }
}
