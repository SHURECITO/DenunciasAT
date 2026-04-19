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

    this.logger.debug(
      `Enviando mensaje a Evolution (numero=${this.maskNumber(number)}, endpoint=${url}, textoLen=${text.length})`,
    );

    try {
      const response = await axios.post(url, body, {
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      this.logger.debug(`Mensaje enviado a Evolution (status=${response.status})`);
    } catch (err) {
      const error = err as AxiosError;
      this.logger.warn(
        `Error Evolution intento 1 (status=${error.response?.status ?? 'unknown'}, numero=${this.maskNumber(number)})`,
      );

      // Retry único después de 2 segundos
      await new Promise((resolve) => setTimeout(resolve, 2000));
      this.logger.warn(`Reintentando envío a Evolution (numero=${this.maskNumber(number)})`);

      const retryResponse = await axios.post(url, body, {
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      this.logger.debug(`Mensaje enviado a Evolution en retry (status=${retryResponse.status})`);
    }
  }
}
