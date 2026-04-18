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
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { key: { id: 'abc' } } });

      await service.sendText('573001234567@s.whatsapp.net', 'Hola mundo');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://evolution-api:8080/message/sendText/denunciasAt',
        { number: '573001234567', text: 'Hola mundo' },
        {
          headers: {
            apikey: 'test-api-key',
            'Content-Type': 'application/json',
          },
        },
      );
    });

    it('debe eliminar el sufijo @s.whatsapp.net del número', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {} });

      await service.sendText('573001234567@s.whatsapp.net', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('573001234567');
    });

    it('debe eliminar el sufijo @lid del número', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {} });

      await service.sendText('181011514171514@lid', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('181011514171514');
    });

    it('debe eliminar el sufijo @g.us (grupos)', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {} });

      await service.sendText('120363123456@g.us', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('120363123456');
    });

    it('debe dejar pasar número sin sufijo JID', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {} });

      await service.sendText('573001234567', 'test');

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].number).toBe('573001234567');
    });

    it('debe propagar el error si Evolution API retorna error', async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(service.sendText('573001234567', 'test')).rejects.toThrow(
        'Network error',
      );
    });
  });
});
