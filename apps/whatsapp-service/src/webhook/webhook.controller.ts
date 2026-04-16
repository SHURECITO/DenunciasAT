import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import Redis from 'ioredis';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

// QR de WhatsApp expira aprox. en 60s — guardamos 90s para dar margen al frontend
const QR_TTL_SEGUNDOS = 90;
const REDIS_QR_KEY = 'evolution:qr';

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly chatbotClientService: ChatbotClientService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Post(':event')
  @HttpCode(200)
  async handleWebhook(@Body() payload: any) {
    const event = payload?.event as string | undefined;

    console.log('Webhook recibido:', JSON.stringify(payload, null, 2));

    if (event === 'qrcode.updated') {
      const base64 = payload.data?.qrcode?.base64 as string | undefined;
      if (base64) {
        await this.redis.setex(REDIS_QR_KEY, QR_TTL_SEGUNDOS, base64);
        console.log(`QR guardado en Redis [clave=${REDIS_QR_KEY}], expira en ${QR_TTL_SEGUNDOS}s`);
      } else {
        console.warn('qrcode.updated recibido sin base64');
      }
      return { ok: true };
    }

    console.log('WEBHOOK EVENT:', event);

    if (event !== 'messages.upsert') return { ok: true };

    const data = payload.data;
    if (!data?.key || data.key.fromMe) return { ok: true };

    const remoteJid = data.key.remoteJid as string | undefined;
    if (!remoteJid) return { ok: true };

    // Extraer número limpio (sin sufijo JID: @s.whatsapp.net, @lid, @g.us, etc.)
    const numero = remoteJid.replace(/@.*$/, '');

    const messageType = data.messageType ?? 'conversation';
    const contenido =
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      '';

    // URL de media para imágenes y documentos (usada en paso ESPERANDO_EVIDENCIA)
    const mediaUrl: string | undefined =
      data.message?.imageMessage?.url ??
      data.message?.documentMessage?.url ??
      undefined;

    const esMediaSoportada = ['imageMessage', 'documentMessage'].includes(messageType);

    // Ignorar si no hay texto Y no es un tipo de media soportado
    if (!contenido && !esMediaSoportada) return { ok: true };

    try {
      const { respuesta } = await this.chatbotClientService.procesar(
        numero,
        contenido,
        messageType,
        mediaUrl,
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
