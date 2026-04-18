import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChatbotClientService } from './chatbot-client.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChatbotClientService', () => {
  let service: ChatbotClientService;

  const mockConfig = {
    get: jest.fn((key: string, defaultVal?: string) => {
      const map: Record<string, string> = {
        CHATBOT_SERVICE_URL: 'http://chatbot-service:3002',
      };
      return map[key] ?? defaultVal;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotClientService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ChatbotClientService>(ChatbotClientService);
    jest.clearAllMocks();
  });

  describe('procesar', () => {
    it('debe llamar al chatbot-service con los parámetros correctos', async () => {
      const respuestaEsperada = { respuesta: 'Hola, ¿cuál es tu nombre?' };
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue({ data: respuestaEsperada });

      const resultado = await service.procesar(
        '573001234567',
        'Hola',
        'conversation',
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://chatbot-service:3002/procesar',
        { numero: '573001234567', mensaje: 'Hola', tipo: 'conversation' },
      );
      expect(resultado).toEqual(respuestaEsperada);
    });

    it('debe retornar la respuesta del chatbot', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { respuesta: 'Bienvenido al sistema de denuncias' },
      });

      const resultado = await service.procesar('573001234567', 'inicio', 'conversation');

      expect(resultado.respuesta).toBe('Bienvenido al sistema de denuncias');
    });

    it('debe propagar el error si chatbot-service no responde', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.procesar('573001234567', 'Hola', 'conversation'),
      ).rejects.toThrow('Connection refused');
    });
  });
});
