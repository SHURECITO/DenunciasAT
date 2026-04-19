import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type WhatsappEstado = 'open' | 'close' | 'connecting';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly evolutionUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;
  private readonly whatsappServiceUrl: string;
  private readonly qrInternalKey: string;

  constructor(private readonly config: ConfigService) {
    this.evolutionUrl = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
    this.apiKey = this.config.get<string>('EVOLUTION_API_KEY', '');
    this.instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
    this.whatsappServiceUrl = this.config.get<string>('WHATSAPP_SERVICE_URL', 'http://whatsapp-service:3003');
    const scopedQrKey = this.config.get<string>('WHATSAPP_QR_INTERNAL_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.qrInternalKey = scopedQrKey || fallback;
  }

  private get headers() {
    return { apikey: this.apiKey };
  }

  async getEstado(): Promise<{ estado: WhatsappEstado }> {
    try {
      const res = await axios.get<{ instance?: { state?: string } }>(
        `${this.evolutionUrl}/instance/connectionState/${this.instance}`,
        { headers: this.headers, timeout: 5000 },
      );
      const state = (res.data?.instance?.state as WhatsappEstado) ?? 'close';
      return { estado: state };
    } catch (err) {
      this.logger.warn(`No se pudo obtener estado de Evolution API: ${(err as Error).message}`);
      return { estado: 'close' };
    }
  }

  // El QR ya no se lee de Evolution API directamente — Evolution API lo envía
  // via webhook qrcode.updated → whatsapp-service lo guarda en Redis (TTL 90s)
  // → aquí lo leemos desde whatsapp-service
  async getQr(): Promise<{ qr?: string; disponible: boolean }> {
    try {
      const res = await axios.get<{ qr?: string; disponible: boolean }>(
        `${this.whatsappServiceUrl}/qr`,
        {
          timeout: 5000,
          headers: {
            'x-internal-key': this.qrInternalKey,
            'x-internal-service': 'dashboard',
          },
        },
      );
      return res.data;
    } catch (err) {
      this.logger.warn(`No se pudo leer QR desde whatsapp-service: ${(err as Error).message}`);
      return { disponible: false };
    }
  }

  // Elimina la instancia completamente y la recrea desde cero.
  // Esto limpia las credenciales de Baileys y fuerza un nuevo QR.
  async reconectar(): Promise<{ ok: boolean; mensaje: string }> {
    // 1. Eliminar instancia existente (ignore 404 si ya no existe)
    try {
      await axios.delete(
        `${this.evolutionUrl}/instance/delete/${this.instance}`,
        { headers: this.headers, timeout: 10000 },
      );
      this.logger.log(`Instancia ${this.instance} eliminada`);
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        this.logger.warn(`Error al eliminar instancia: ${err?.message}`);
      }
    }

    // 2. Esperar 2s para que Evolution API limpie el estado interno
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Crear instancia nueva con QR habilitado y webhook por instancia
    // IMPORTANTE: el webhook GLOBAL de Evolution API v2.2.3 usa isURL() sin require_tld:false,
    // por lo que falla silenciosamente con hostnames Docker (sin TLD).
    // El webhook POR INSTANCIA usa isURL({require_tld:false}) y sí acepta hostnames Docker.
    const webhookBase = this.whatsappServiceUrl;
    try {
      await axios.post(
        `${this.evolutionUrl}/instance/create`,
        {
          instanceName: this.instance,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          webhook: {
            url: `${webhookBase}/webhook`,
            byEvents: true,
            base64: false,
            enabled: true,
            events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
          },
        },
        { headers: this.headers, timeout: 10000 },
      );
      this.logger.log(`Instancia ${this.instance} creada, esperando QR via webhook...`);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error desconocido';
      this.logger.error(`Error al crear instancia: ${msg}`);
      return { ok: false, mensaje: `Error al crear instancia: ${msg}` };
    }

    return { ok: true, mensaje: 'Instancia recreada. El QR estará disponible en unos segundos.' };
  }
}
