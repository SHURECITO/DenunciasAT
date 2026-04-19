import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class RagProxyService {
  private readonly ragServiceUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://rag-service:3006');
    this.internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
  }

  private get headers() {
    return {
      'x-internal-key': this.internalKey,
      'x-internal-service': 'dashboard',
      'Content-Type': 'application/json',
    };
  }

  async getDependencias() {
    const res = await axios.get(`${this.ragServiceUrl}/dependencias`, {
      headers: this.headers,
      timeout: 10000,
    });
    return res.data;
  }

  async reindexar() {
    const res = await axios.post(
      `${this.ragServiceUrl}/reindexar`,
      {},
      {
        headers: this.headers,
        timeout: 60000,
      },
    );
    return res.data;
  }
}
