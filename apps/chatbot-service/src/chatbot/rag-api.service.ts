import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface DependenciaClasificada {
  nombre: string;
  justificacion: string;
  solicitudEspecifica: string;
}

interface ClasificacionRagResponse {
  esEspecial: boolean;
  dependencias: DependenciaClasificada[];
  asunto: string;
}

@Injectable()
export class RagApiService {
  private readonly logger = new Logger(RagApiService.name);
  private readonly ragServiceUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://rag-service:3006');
    const dedicated = this.config.get<string>('RAG_API_INTERNAL_KEY', '').trim();
    const dashboardScoped = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    const chatbotScoped = this.config.get<string>('CHATBOT_API_INTERNAL_KEY', '').trim();
    this.internalKey = dedicated || dashboardScoped || chatbotScoped;
  }

  private get headers() {
    return {
      'x-internal-key': this.internalKey,
      'x-internal-service': 'chatbot',
      'Content-Type': 'application/json',
    };
  }

  async clasificar(
    descripcion: string,
    ubicacion?: string,
  ): Promise<ClasificacionRagResponse | null> {
    if (!descripcion.trim()) return null;

    try {
      const res = await axios.post<ClasificacionRagResponse>(
        `${this.ragServiceUrl}/clasificar`,
        { descripcion, ubicacion },
        { headers: this.headers, timeout: 20000 },
      );
      return res.data;
    } catch (err) {
      this.logger.warn(
        `No se pudo clasificar con rag-service: ${(err as Error).message?.substring(0, 120)}`,
      );
      return null;
    }
  }
}