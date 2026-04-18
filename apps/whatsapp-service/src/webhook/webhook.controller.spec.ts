import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

const REDIS_CLIENT = 'REDIS_CLIENT';

describe('WebhookController', () => {
  let controller: WebhookController;
  let evolutionService: jest.Mocked<EvolutionService>;
  let chatbotClientService: jest.Mocked<ChatbotClientService>;
  let redisMock: { setex: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    redisMock = { setex: jest.fn().mockResolvedValue('OK'), get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: EvolutionService,
          useValue: { sendText: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ChatbotClientService,
          useValue: {
            procesar: jest.fn().mockResolvedValue({ respuesta: 'Respuesta del bot' }),
          },
        },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
    evolutionService = module.get(EvolutionService);
    chatbotClientService = module.get(ChatbotClientService);
  });

  // ─── qrcode.updated ───────────────────────────────────────────────────────

  describe('evento qrcode.updated', () => {
    it('debe guardar el QR base64 en Redis con TTL 90s', async () => {
      const qrBase64 = 'data:image/png;base64,iVBOR...';
      const payload = {
        event: 'qrcode.updated',
        data: { qrcode: { base64: qrBase64 } },
      };

      const resultado = await controller.handleWebhook(payload);

      expect(redisMock.setex).toHaveBeenCalledWith(
        'evolution:qr',
        90,
        qrBase64,
      );
      expect(resultado).toEqual({ ok: true });
    });

    it('no debe fallar si el QR viene sin base64', async () => {
      const payload = {
        event: 'qrcode.updated',
        data: { qrcode: {} },
      };

      const resultado = await controller.handleWebhook(payload);

      expect(redisMock.setex).not.toHaveBeenCalled();
      expect(resultado).toEqual({ ok: true });
    });
  });

  // ─── events ignorados ─────────────────────────────────────────────────────

  describe('eventos ignorados', () => {
    it('debe ignorar connection.update y retornar ok', async () => {
      const payload = { event: 'connection.update', data: {} };

      const resultado = await controller.handleWebhook(payload);

      expect(chatbotClientService.procesar).not.toHaveBeenCalled();
      expect(resultado).toEqual({ ok: true });
    });

    it('debe ignorar eventos desconocidos', async () => {
      const resultado = await controller.handleWebhook({ event: 'otro.evento' });

      expect(chatbotClientService.procesar).not.toHaveBeenCalled();
      expect(resultado).toEqual({ ok: true });
    });

    it('debe ignorar mensajes propios (fromMe: true)', async () => {
      const payload = {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: true },
          messageType: 'conversation',
          message: { conversation: 'Hola' },
        },
      };

      const resultado = await controller.handleWebhook(payload);

      expect(chatbotClientService.procesar).not.toHaveBeenCalled();
      expect(resultado).toEqual({ ok: true });
    });

    it('debe ignorar mensajes vacíos (sin texto)', async () => {
      const payload = {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: false },
          messageType: 'imageMessage',
          message: {},
        },
      };

      const resultado = await controller.handleWebhook(payload);

      expect(chatbotClientService.procesar).not.toHaveBeenCalled();
      expect(resultado).toEqual({ ok: true });
    });
  });

  // ─── messages.upsert ──────────────────────────────────────────────────────

  describe('evento messages.upsert — flujo completo', () => {
    const buildPayload = (remoteJid: string, texto: string) => ({
      event: 'messages.upsert',
      data: {
        key: { remoteJid, fromMe: false },
        messageType: 'conversation',
        message: { conversation: texto },
      },
    });

    it('debe procesar mensaje y enviar respuesta (JID @s.whatsapp.net)', async () => {
      const payload = buildPayload('573001234567@s.whatsapp.net', 'Hola');

      const resultado = await controller.handleWebhook(payload);

      expect(chatbotClientService.procesar).toHaveBeenCalledWith(
        '573001234567',
        'Hola',
        'conversation',
      );
      expect(evolutionService.sendText).toHaveBeenCalledWith(
        '573001234567@s.whatsapp.net',
        'Respuesta del bot',
      );
      expect(resultado).toEqual({ ok: true });
    });

    it('debe extraer número limpio para el chatbot al recibir @lid JID', async () => {
      const payload = buildPayload('181011514171514@lid', 'Hola');

      await controller.handleWebhook(payload);

      // El número limpio va al chatbot
      expect(chatbotClientService.procesar).toHaveBeenCalledWith(
        '181011514171514',
        'Hola',
        'conversation',
      );
    });

    it('debe procesar extendedTextMessage además de conversation', async () => {
      const payload = {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: false },
          messageType: 'extendedTextMessage',
          message: { extendedTextMessage: { text: 'Texto largo' } },
        },
      };

      await controller.handleWebhook(payload);

      expect(chatbotClientService.procesar).toHaveBeenCalledWith(
        '573001234567',
        'Texto largo',
        'extendedTextMessage',
      );
    });

    it('no debe enviar respuesta si chatbot retorna cadena vacía', async () => {
      (chatbotClientService.procesar as jest.Mock).mockResolvedValueOnce({
        respuesta: '',
      });
      const payload = buildPayload('573001234567@s.whatsapp.net', 'Hola');

      await controller.handleWebhook(payload);

      expect(evolutionService.sendText).not.toHaveBeenCalled();
    });

    it('debe capturar errores de sendText sin crashear', async () => {
      (evolutionService.sendText as jest.Mock).mockRejectedValueOnce(
        new Error('Evolution API 400'),
      );
      const payload = buildPayload('573001234567@s.whatsapp.net', 'Hola');

      // No debe lanzar excepción
      const resultado = await controller.handleWebhook(payload);

      expect(resultado).toEqual({ ok: true });
    });

    it('debe capturar errores del chatbot sin crashear', async () => {
      (chatbotClientService.procesar as jest.Mock).mockRejectedValueOnce(
        new Error('Chatbot timeout'),
      );
      const payload = buildPayload('573001234567@s.whatsapp.net', 'Hola');

      const resultado = await controller.handleWebhook(payload);

      expect(resultado).toEqual({ ok: true });
    });
  });
});
