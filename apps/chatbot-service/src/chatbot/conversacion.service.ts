import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
  identidadPendienteConfirmacion?: boolean;
  identidadReutilizada?: boolean;
  telefono: string;
  barrio?: string;
  comuna?: string;
  direccion?: string;
  direccionConfirmada?: boolean;
  descripcion?: string;
  descripcionResumen?: string;
  dependencia?: string;
  esEspecial?: boolean;
  clasificacionRagTexto?: string;
  imagenes?: string[];
  pdfs?: string[];
  solicitudAdicional?: string;
  etapa: 'recopilando' | 'esperando_solicitud' | 'confirmando' | 'finalizado' | 'especial_cerrado' | 'cancelado';
}

export interface EstadoConversacionIA {
  historial: MensajeHistorial[];
  datosConfirmados: DatosConfirmados;
  intentosFallidos: number;
  turnosSinNuevosDatos?: number;
  ultimoMensaje?: string;
  contadorRepeticiones?: number;
  parcialId?: number;
}

const TTL_SEGUNDOS = 60 * 60 * 24; // 24 horas

@Injectable()
export class ConversacionService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(ConversacionService.name);

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://redis:6379');
    this.redis = new Redis(redisUrl, {
      commandTimeout: 3000,
      connectTimeout: 5000,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 5) return null; // dejar de reintentar tras 5 fallos consecutivos
        return Math.min(times * 300, 2000);
      },
      reconnectOnError: (err) => {
        // Reconectar solo en errores de red, no en errores de autenticación
        const targetErrors = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    // Usar la instancia de logger de clase — evita crear múltiples Logger en cada evento
    this.redis.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
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
    try {
      return JSON.parse(raw) as EstadoConversacionIA;
    } catch (err) {
      // JSON corrupto en Redis — resetear la sesión en lugar de propagar el error
      this.logger.warn(`Estado Redis corrupto para ${numero}, iniciando sesión nueva: ${(err as Error).message}`);
      await this.redis.del(this.key(numero)).catch(() => {});
      return null;
    }
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
      turnosSinNuevosDatos: 0,
    };
  }
}
