import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

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
    await axios.post(
      `${this.baseUrl}/message/sendText/${this.instance}`,
      {
        number: remoteJid,
        text,
      },
      {
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
