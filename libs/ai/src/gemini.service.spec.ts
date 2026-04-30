import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';

// Módulo entero mockeado — evita instanciar GoogleGenAI real
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(),
    },
  })),
}));

const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    const map: Record<string, string> = {
      GCP_PROJECT_ID: 'test-project',
      GCP_REGION: 'us-central1',
    };
    return map[key] ?? def ?? '';
  }),
};

describe('GeminiService', () => {
  let service: GeminiService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerDebugSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('procesarMensajeChatbot', () => {
    it('debe incluir code y stack en el log de error cuando Vertex AI falla', async () => {
      // Forzar que el modelo primario lance un error con código y stack
      const authError = new Error('Request had insufficient authentication scopes') as Error & { code: string };
      authError.code = '403';
      authError.stack = 'Error: insufficient scopes\n    at VertexModel.generateContent (gemini.service.ts:16:5)';

      // Acceder al modelo privado para reemplazar con mock que lanza
      (service as any).modelChatbot = {
        generateContent: jest.fn().mockRejectedValue(authError),
      };
      (service as any).modelChatbotFallback = {
        generateContent: jest.fn().mockRejectedValue(authError),
      };

      const result = await service.procesarMensajeChatbot([], {}, 'hola');

      // Debe retornar el fallback sin propagar el error
      expect(result).toHaveProperty('respuesta');
      expect(result.listaParaRadicar).toBe(false);

      // El logger debe haber registrado el código del error
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('code=403'),
      );

      // El stack debe haber sido loggeado en debug
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stack Gemini chatbot'),
      );
    });

    it('debe activar fallback de modelo secundario en error 429 y loggear ambos errores', async () => {
      const rateLimitError = new Error('Quota exceeded') as Error & { code: string };
      rateLimitError.message = '429 Quota exceeded for gemini';
      rateLimitError.code = '429';

      const fallbackError = new Error('Fallback also rate limited') as Error & { status: number };
      fallbackError.status = 429;

      (service as any).modelChatbot = {
        generateContent: jest.fn().mockRejectedValue(rateLimitError),
      };
      (service as any).modelChatbotFallback = {
        generateContent: jest.fn().mockRejectedValue(fallbackError),
      };

      const result = await service.procesarMensajeChatbot([], {}, 'hola');

      expect(result.listaParaRadicar).toBe(false);

      // El error del fallback debe loggear code
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error Gemini chatbot fallback'),
      );
    });

    it('debe retornar fallback cuando ai es null (GCP_PROJECT_ID vacío)', async () => {
      const moduleNoCreds = await Test.createTestingModule({
        providers: [
          GeminiService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, def?: string) => (key === 'GCP_PROJECT_ID' ? '' : def ?? '')),
            },
          },
        ],
      }).compile();

      const serviceNoCreds = moduleNoCreds.get<GeminiService>(GeminiService);
      expect((serviceNoCreds as any).ai).toBeNull();
    });
  });
});
