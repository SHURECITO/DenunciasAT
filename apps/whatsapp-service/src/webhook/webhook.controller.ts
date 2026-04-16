import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

interface EvolutionWebhookPayload {
  event: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      audioMessage?: unknown;
      imageMessage?: unknown;
      documentMessage?: unknown;
    };
    messageType?: string;
  };
}

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly chatbotClientService: ChatbotClientService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() payload: EvolutionWebhookPayload) {
    if (payload.event !== 'messages.upsert') return { ok: true };

    const data = payload.data;
    if (!data?.key || data.key.fromMe) return { ok: true };

    const remoteJid = data.key.remoteJid;
    if (!remoteJid) return { ok: true };

    // Extraer número limpio (sin @s.whatsapp.net)
    const numero = remoteJid.replace('@s.whatsapp.net', '');

    const messageType = data.messageType ?? 'conversation';
    const contenido =
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      '';

    // Solo procesar mensajes de texto
    if (!contenido) return { ok: true };

    try {
      const { respuesta } = await this.chatbotClientService.procesar(
        numero,
        contenido,
        messageType,
      );
      if (respuesta) {
        await this.evolutionService.sendText(remoteJid, respuesta);
      }
    } catch (err) {
      console.error('Error procesando webhook:', err);
    }

    return { ok: true };
  }
}
