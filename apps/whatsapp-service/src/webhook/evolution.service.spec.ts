import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EvolutionService } from './evolution.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EvolutionService', () => {
  let service: EvolutionService;

  const mockConfig = {
    get: jest.fn((key: string, defaultVal?: string) => {
      const map: Record<string, string> = {
        EVOLUTION_API_URL: 'http://evolution-api:8080',
        EVOLUTION_API_KEY: 'test-api-key',
        EVOLUTION_INSTANCE_NAME: 'denunciasAt',
      };
      return map[key] ?? defaultVal;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvolutionService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<EvolutionService>(EvolutionService);
    jest.clearAllMocks();
  });

  describe('sendText', () => {
    it('debe enviar texto al endpoint correcto de Evolution API', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { key: { id: 'abc' } }, status: 200 });

      await service.sendText('573001234567@s.whatsapp.net', 'Hola mundo');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://evolution-api:8080/message/sendText/denunciasAt',
        { number: '573001234567', text: 'Hola mundo' },
        {
          headers: {
            apikey: 'test-api-key',
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        },
      );
    });

    it('debe eliminar el sufijo @s.whatsapp.net del número', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {}, status: 200 });

      await service.sendText('573001234567@s.whatsapp.net', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('573001234567');
    });

    it('debe pasar el JID @lid completo a Evolution API', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {}, status: 200 });

      await service.sendText('181011514171514@lid', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('181011514171514@lid');
    });

    it('debe pasar el JID @g.us completo a Evolution API', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {}, status: 200 });

      await service.sendText('120363123456@g.us', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('120363123456@g.us');
    });

    it('debe dejar pasar número sin sufijo JID', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {}, status: 200 });

      await service.sendText('573001234567', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('573001234567');
    });

    it('no debe propagar el error si Evolution API falla en todos los intentos', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Network error'));

      // No debe rechazar — el servicio absorbe el error tras 3 reintentos
      await expect(service.sendText('573001234567', 'test')).resolves.toBeUndefined();
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    }, 30_000);
  });
});
