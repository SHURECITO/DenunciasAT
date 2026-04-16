import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export enum PasoConversacion {
  INICIO = 'INICIO',
  ESPERANDO_NOMBRE = 'ESPERANDO_NOMBRE',
  ESPERANDO_CEDULA = 'ESPERANDO_CEDULA',
  ESPERANDO_UBICACION = 'ESPERANDO_UBICACION',
  ESPERANDO_DESCRIPCION = 'ESPERANDO_DESCRIPCION',
  ESPERANDO_EVIDENCIA = 'ESPERANDO_EVIDENCIA',
  ESPERANDO_CONFIRMACION = 'ESPERANDO_CONFIRMACION',
  FINALIZADO = 'FINALIZADO',
}

export interface DatosConversacion {
  nombre?: string;
  cedula?: string;
  telefono: string;
  ubicacion?: string;
  descripcion?: string;
  dependencia?: string;
  esEspecial?: boolean;
  imagenes?: string[];
  pdfs?: string[];
  parcialId?: number;
}

export interface EstadoConversacion {
  paso: PasoConversacion;
  datos: DatosConversacion;
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

  async getEstado(numero: string): Promise<EstadoConversacion | null> {
    const raw = await this.redis.get(this.key(numero));
    if (!raw) return null;
    return JSON.parse(raw) as EstadoConversacion;
  }

  async setEstado(numero: string, estado: EstadoConversacion): Promise<void> {
    await this.redis.setex(
      this.key(numero),
      TTL_SEGUNDOS,
      JSON.stringify(estado),
    );
  }

  async clearEstado(numero: string): Promise<void> {
    await this.redis.del(this.key(numero));
  }
}
