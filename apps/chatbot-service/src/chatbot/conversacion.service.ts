import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface MensajeHistorial {
  rol: 'user' | 'assistant';
  contenido: string;
  timestamp: string;
}

export interface DatosConfirmados {
  nombre?: string;
  esAnonimo?: boolean;
  cedula?: string;
  telefono: string;
  barrio?: string;
  comuna?: string;
  direccion?: string;
  direccionConfirmada?: boolean;
  descripcion?: string;
  descripcionResumen?: string;
  dependencia?: string;
  esEspecial?: boolean;
  imagenes?: string[];
  pdfs?: string[];
  solicitudAdicional?: string;
  etapa: 'recopilando' | 'esperando_solicitud' | 'confirmando' | 'finalizado' | 'especial_cerrado';
}

export interface EstadoConversacionIA {
  historial: MensajeHistorial[];
  datosConfirmados: DatosConfirmados;
  intentosFallidos: number;
  ultimoMensaje?: string;
  contadorRepeticiones?: number;
  parcialId?: number;
}

const TTL_SEGUNDOS = 60 * 60 * 24; // 24 horas

@Injectable()
export class ConversacionService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://redis:6379');
    this.redis = new Redis(redisUrl);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(numero: string) {
    return `chatbot:conv:${numero}`;
  }

  async getEstado(numero: string): Promise<EstadoConversacionIA | null> {
    const raw = await this.redis.get(this.key(numero));
    if (!raw) return null;
    return JSON.parse(raw) as EstadoConversacionIA;
  }

  async setEstado(numero: string, estado: EstadoConversacionIA): Promise<void> {
    await this.redis.setex(this.key(numero), TTL_SEGUNDOS, JSON.stringify(estado));
  }

  async clearEstado(numero: string): Promise<void> {
    await this.redis.del(this.key(numero));
  }

  crearEstadoNuevo(telefono: string): EstadoConversacionIA {
    return {
      historial: [],
      datosConfirmados: { telefono, etapa: 'recopilando' },
      intentosFallidos: 0,
    };
  }
}
