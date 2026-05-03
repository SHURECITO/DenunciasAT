import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

@Injectable()
export class EvolutionService implements OnModuleInit {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
    this.apiKey = this.config.get<string>('EVOLUTION_API_KEY', '');
    this.instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
  }

  async onModuleInit(): Promise<void> {
    // Retry webhook configuration up to 5 times with exponential backoff.
    // Evolution API may not be ready immediately when this service starts.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.configureWebhook();
        return;
      } catch (err) {
        const waitMs = attempt * 3000;
        this.logger.warn(
          `Webhook config attempt ${attempt}/5 failed: ${(err as Error).message} — retrying in ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    this.logger.error('Could not configure Evolution webhook after 5 attempts — messages will not be received');
  }

  private async configureWebhook(): Promise<void> {
    const webhookUrl = this.config.get<string>('WHATSAPP_SERVICE_URL', 'http://whatsapp-service:3003');
    const url = `${this.baseUrl}/webhook/set/${this.instance}`;
    const body = {
      webhook: {
        enabled: true,
        url: `${webhookUrl}/webhook`,
        webhook_by_events: true,
        webhook_base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    };
    const headers = { apikey: this.apiKey, 'Content-Type': 'application/json' };
    const response = await axios.post(url, body, { headers, timeout: 5000 });
    this.logger.log(`Evolution webhook configured: ${response.data?.url ?? webhookUrl}/webhook`);
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
