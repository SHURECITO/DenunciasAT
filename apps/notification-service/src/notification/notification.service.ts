import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface NotificarRespuestaDto {
  denunciaId: number;
  telefono: string;
  radicado: string;
  dependencia: string;
  contenidoRespuesta: string;
}

export interface ResultadoNotificacion {
  enviado: boolean;
  timestamp: Date;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
    this.apiKey  = this.config.get<string>('EVOLUTION_API_KEY', '');
    this.instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
  }

  async notificarRespuesta(dto: NotificarRespuestaDto): Promise<ResultadoNotificacion> {
    const texto =
      `📬 Respuesta a su denuncia *${dto.radicado}*\n\n` +
      `El despacho del concejal Andrés Felipe Tobón Villada le informa que la administración ha dado respuesta a su solicitud ante ${dto.dependencia}.\n\n` +
      `${dto.contenidoRespuesta}\n\n` +
      `Para más información puede contactar directamente al equipo del concejal.`;

    const url  = `${this.baseUrl}/message/sendText/${this.instance}`;
    const body = { number: dto.telefono, text: texto };

    for (let intento = 1; intento <= 3; intento++) {
      try {
        await axios.post(url, body, {
          headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
          timeout: 10000,
        });
        this.logger.log(`Notificación enviada a ${dto.telefono.slice(-4)} para denuncia ${dto.radicado}`);
        return { enviado: true, timestamp: new Date() };
      } catch (err) {
        this.logger.warn(`Intento ${intento}/3 fallido para ${dto.radicado}: ${(err as Error).message}`);
        if (intento < 3) await new Promise((r) => setTimeout(r, 5000));
      }
    }

    this.logger.error(`No se pudo notificar al ciudadano para denuncia ${dto.radicado} tras 3 intentos`);
    return { enviado: false, timestamp: new Date() };
  }
}
