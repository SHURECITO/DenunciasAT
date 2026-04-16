import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class ChatbotClientService {
  private readonly chatbotUrl: string;

  constructor(private readonly config: ConfigService) {
    this.chatbotUrl = this.config.get<string>(
      'CHATBOT_SERVICE_URL',
      'http://chatbot-service:3002',
    );
  }

  async procesar(
    numero: string,
    mensaje: string,
    tipo: string,
  ): Promise<{ respuesta: string }> {
    const res = await axios.post<{ respuesta: string }>(
      `${this.chatbotUrl}/procesar`,
      { numero, mensaje, tipo },
    );
    return res.data;
  }
}
