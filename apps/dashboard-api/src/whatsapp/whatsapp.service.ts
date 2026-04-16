import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type WhatsappEstado = 'open' | 'close' | 'connecting';

@Injectable()
export class WhatsappService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
    this.apiKey = this.config.get<string>('EVOLUTION_API_KEY', '');
    this.instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
  }

  private get headers() {
    return { apikey: this.apiKey };
  }

  async getEstado(): Promise<{ estado: WhatsappEstado; qr?: string }> {
    try {
      const res = await axios.get<{
        instance?: { state?: string };
        qrcode?: { base64?: string };
      }>(
        `${this.baseUrl}/instance/connectionState/${this.instance}`,
        { headers: this.headers },
      );
      const state = res.data?.instance?.state as WhatsappEstado ?? 'close';
      return { estado: state };
    } catch {
      return { estado: 'close' };
    }
  }

  async getQr(): Promise<{ qr?: string }> {
    try {
      const res = await axios.get<{ base64?: string; code?: string }>(
        `${this.baseUrl}/instance/connect/${this.instance}`,
        { headers: this.headers },
      );
      return { qr: res.data?.base64 ?? res.data?.code };
    } catch {
      return {};
    }
  }

  async reconectar(): Promise<{ ok: boolean }> {
    try {
      await axios.delete(
        `${this.baseUrl}/instance/logout/${this.instance}`,
        { headers: this.headers },
      );
    } catch {
      // Ignorar error si ya estaba desconectado
    }
    try {
      await axios.get(
        `${this.baseUrl}/instance/connect/${this.instance}`,
        { headers: this.headers },
      );
    } catch {
      // La instancia puede tardar en conectarse
    }
    return { ok: true };
  }
}
