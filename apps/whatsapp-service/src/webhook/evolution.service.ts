import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
    this.apiKey = this.config.get<string>('EVOLUTION_API_KEY', '');
    this.instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
  }

  private maskNumber(number: string): string {
    const digits = number.replace(/\D/g, '');
    if (digits.length <= 4) return '****';
    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }

  async sendText(remoteJid: string, text: string): Promise<void> {
    // Para @s.whatsapp.net: extraer solo dígitos (ej. 573001234567)
    // Para @lid: pasar JID completo — Baileys lo acepta con el parche @lid
    // Para otros (@g.us, etc.): pasar JID completo también
    const number = remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid.replace(/@s\.whatsapp\.net$/, '')
      : remoteJid;

    const url = `${this.baseUrl}/message/sendText/${this.instance}`;
    const body = { number, text };
    const headers = { apikey: this.apiKey, 'Content-Type': 'application/json' };

    this.logger.debug(
      `Enviando mensaje a Evolution (numero=${this.maskNumber(number)}, endpoint=${url}, textoLen=${text.length})`,
    );

    for (let intento = 1; intento <= 3; intento++) {
      try {
        const response = await axios.post(url, body, { headers, timeout: 10_000 });
        this.logger.debug(`Mensaje enviado a Evolution en intento ${intento} (status=${response.status})`);
        return;
      } catch (err) {
        const error = err as AxiosError;
        this.logger.warn(
          `Error Evolution intento ${intento}/3 (status=${error.response?.status ?? 'timeout/network'}, numero=${this.maskNumber(number)}): ${error.message}`,
        );
        if (intento < 3) {
          await new Promise((r) => setTimeout(r, intento * 2000));
        }
      }
    }

    // Todos los intentos fallaron — loguear y continuar sin propagar la excepción.
    // El ciudadano no recibe respuesta en este mensaje, pero el webhook no crashea.
    this.logger.error(
      `No se pudo enviar mensaje a Evolution tras 3 intentos (numero=${this.maskNumber(number)}, textoLen=${text.length})`,
    );
  }
}
