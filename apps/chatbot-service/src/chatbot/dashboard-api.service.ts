import { Injectable } from '@nestjs/common';
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
}

interface CreateIncompletaPayload {
  nombreCiudadano: string;
  telefono: string;
  cedula?: string;
  ubicacion?: string;
  descripcion?: string;
}

@Injectable()
export class DashboardApiService {
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'DASHBOARD_API_URL',
      'http://dashboard-api:3000',
    );
    this.internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '');
  }

  async crearDenuncia(payload: CreateDenunciaPayload): Promise<{ id: number; radicado: string }> {
    const res = await axios.post<{ id: number; radicado: string }>(
      `${this.baseUrl}/denuncias`,
      { ...payload, documentoPendiente: true },
      {
        headers: {
          'x-internal-key': this.internalKey,
          'Content-Type': 'application/json',
        },
      },
    );
    return res.data;
  }

  async crearIncompleta(payload: CreateIncompletaPayload): Promise<{ id: number; radicado: string }> {
    const res = await axios.post<{ id: number; radicado: string }>(
      `${this.baseUrl}/denuncias/incompleta`,
      payload,
      {
        headers: {
          'x-internal-key': this.internalKey,
          'Content-Type': 'application/json',
        },
      },
    );
    return res.data;
  }
}
