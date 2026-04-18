import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { MinioService } from '@app/storage';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

// QR de WhatsApp expira aprox. en 60s — guardamos 90s para dar margen al frontend
const QR_TTL_SEGUNDOS = 90;
const REDIS_QR_KEY = 'evolution:qr';

@Controller('webhook')
export class WebhookController {
  private readonly bucketEvidencias: string;
  private readonly evolutionApiKey: string;

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly chatbotClientService: ChatbotClientService,
    private readonly minioService: MinioService,
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.bucketEvidencias = this.config.get<string>('MINIO_BUCKET_EVIDENCIAS', 'denunciasat-evidencias');
    this.evolutionApiKey  = this.config.get<string>('EVOLUTION_API_KEY', '');
  }

  /** Descarga media desde Evolution API y la sube a MinIO. Devuelve la URL interna de MinIO. */
  private async persistMediaToMinio(mediaUrl: string, numero: string, ext: string): Promise<string | null> {
    try {
      const timestamp  = Date.now();
      const objectName = `${numero}/${timestamp}-${randomUUID()}.${ext}`;
      const contentType = ext === 'pdf' ? 'application/pdf' : 'image/jpeg';

      await this.minioService.uploadFromUrl(
        this.bucketEvidencias,
        objectName,
        mediaUrl,
        contentType,
      );

      const minioEndpoint = this.config.get<string>('MINIO_ENDPOINT', 'minio');
      const minioPort     = this.config.get<string>('MINIO_PORT', '9000');
      const endpoint = minioEndpoint.startsWith('http') ? minioEndpoint : `http://${minioEndpoint}:${minioPort}`;
      return `${endpoint}/${this.bucketEvidencias}/${objectName}`;
    } catch (err) {
      console.error(`Error subiendo media a MinIO para ${numero}:`, (err as Error).message);
      return null;
    }
  }

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

    // Extraer número limpio: tomar solo lo que está antes del @ y quitar cualquier carácter no numérico
    // Necesario porque @lid JIDs pueden contener letras/guiones en la parte del número
    const numero = remoteJid.split('@')[0].replace(/\D/g, '');

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

    // Subir media a MinIO inmediatamente antes de que expire la URL de Evolution API
    let mediaUrlFinal = mediaUrl;
    if (esMediaSoportada && mediaUrl) {
      const ext = messageType === 'documentMessage' ? 'pdf' : 'jpg';
      const minioUrl = await this.persistMediaToMinio(mediaUrl, numero, ext);
      if (minioUrl) {
        mediaUrlFinal = minioUrl;
      }
      // Si falla MinIO, se pasa la URL original como fallback (puede expirar, pero no rompe el flujo)
    }

    try {
      const { respuesta } = await this.chatbotClientService.procesar(
        numero,
        contenido,
        messageType,
        mediaUrlFinal,
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
