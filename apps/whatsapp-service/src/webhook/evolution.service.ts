import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

@Injectable()
export class EvolutionService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
    this.apiKey = this.config.get<string>('EVOLUTION_API_KEY', '');
    this.instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
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

    console.log('Enviando a Evolution:', { numero: number, url, body });

    try {
      const response = await axios.post(url, body, {
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      console.log('Respuesta Evolution:', response.data);
    } catch (err) {
      const error = err as AxiosError;
      console.error('Error Evolution API (intento 1):', {
        status: error.response?.status,
        data: error.response?.data,
        numero: number,
      });

      // Retry único después de 2 segundos
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log('Reintentando envío a Evolution...');

      const retryResponse = await axios.post(url, body, {
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      console.log('Respuesta Evolution (retry):', retryResponse.data);
    }
  }
}
