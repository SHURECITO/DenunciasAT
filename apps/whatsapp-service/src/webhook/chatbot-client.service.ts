import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class ChatbotClientService {
  private readonly chatbotUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.chatbotUrl = this.config.get<string>(
      'CHATBOT_SERVICE_URL',
      'http://chatbot-service:3002',
    );
    const serviceKey = this.config.get<string>('WHATSAPP_TO_CHATBOT_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.internalKey = serviceKey || fallback;
  }

  async procesar(
    numero: string,
    mensaje: string,
    tipo: string,
    mediaUrl?: string,
  ): Promise<{ respuesta: string }> {
    const res = await axios.post<{ respuesta: string }>(
      `${this.chatbotUrl}/procesar`,
      { numero, mensaje, tipo, mediaUrl },
      {
        headers: {
          'x-internal-key': this.internalKey,
          'x-internal-service': 'whatsapp',
        },
        timeout: 15000,
      },
    );
    return res.data;
  }
}
