import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { MinioService } from '@app/storage';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

// QR de WhatsApp expira aprox. en 60s — guardamos 90s para dar margen al frontend
const QR_TTL_SEGUNDOS = 90;
const REDIS_QR_KEY = 'evolution:qr';

// Mutex por número para evitar respuestas duplicadas cuando llegan
// varios mensajes simultáneos (ej. imagen + imagen + texto)
const LOCK_TTL_SEGUNDOS = 15;
const COLA_DELAY_MS     = 1500;

interface MensajeEncolado {
  remoteJid: string;
  contenido: string;
  messageType: string;
  mediaUrlFinal?: string;
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
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

  /**
   * Limpia el remoteJid a un número telefónico real.
   * - Remueve el sufijo @s.whatsapp.net / @lid / @g.us / @broadcast
   * - Quita cualquier carácter no numérico
   * - Si el resultado tiene más de 13 dígitos, se trata de un JID interno de WhatsApp
   *   (formato @lid) y se toman solo los últimos 13 dígitos como aproximación
   */
  private limpiarNumero(remoteJid: string): string {
    const sinArroba   = remoteJid.split('@')[0];
    const soloDigitos = sinArroba.replace(/\D/g, '');
    if (soloDigitos.length > 13) {
      this.logger.warn(`JID interno detectado: ${remoteJid}`);
      return soloDigitos.slice(-13);
    }
    return soloDigitos;
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

  /** Procesa un mensaje individual: lo envía al chatbot y entrega la respuesta por WhatsApp */
  private async procesarMensaje(msg: MensajeEncolado): Promise<void> {
    try {
      const numero = this.limpiarNumero(msg.remoteJid);
      const { respuesta } = await this.chatbotClientService.procesar(
        numero,
        msg.contenido,
        msg.messageType,
        msg.mediaUrlFinal,
      );
      if (respuesta) {
        await this.evolutionService.sendText(msg.remoteJid, respuesta);
      }
    } catch (err) {
      console.error('Error procesando webhook:', err);
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

    // Ignorar mensajes de grupos o listas de difusión
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
      return { ok: true };
    }

    const numero = this.limpiarNumero(remoteJid);
    if (!numero) return { ok: true };

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

    // Subir media a MinIO inmediatamente antes de que expire la URL de Evolution API.
    // Hacemos esto ANTES del lock/cola porque la URL original expira en segundos.
    let mediaUrlFinal = mediaUrl;
    if (esMediaSoportada && mediaUrl) {
      const ext = messageType === 'documentMessage' ? 'pdf' : 'jpg';
      const minioUrl = await this.persistMediaToMinio(mediaUrl, numero, ext);
      if (minioUrl) {
        mediaUrlFinal = minioUrl;
      }
      // Si falla MinIO, se pasa la URL original como fallback (puede expirar, pero no rompe el flujo)
    }

    const mensaje: MensajeEncolado = {
      remoteJid,
      contenido,
      messageType,
      mediaUrlFinal,
    };

    // Mutex por número: si ya hay un mensaje procesándose, encolar el actual y retornar.
    // Esto evita respuestas duplicadas cuando el ciudadano envía varios mensajes a la vez.
    const lockKey  = `lock:${numero}`;
    const queueKey = `queue:${numero}`;
    const yaProcesando = await this.redis.get(lockKey);
    if (yaProcesando) {
      await this.redis.lpush(queueKey, JSON.stringify(mensaje));
      return { ok: true };
    }

    await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_SEGUNDOS);

    try {
      await this.procesarMensaje(mensaje);

      // Drenar la cola: mensajes que llegaron mientras procesábamos el primero
      let pendiente: string | null;
      while ((pendiente = await this.redis.rpop(queueKey))) {
        const msgPendiente = JSON.parse(pendiente) as MensajeEncolado;
        await new Promise((r) => setTimeout(r, COLA_DELAY_MS));
        // Renovar el lock por si el drenado toma tiempo
        await this.redis.expire(lockKey, LOCK_TTL_SEGUNDOS);
        await this.procesarMensaje(msgPendiente);
      }
    } finally {
      await this.redis.del(lockKey);
    }

    return { ok: true };
  }
}
