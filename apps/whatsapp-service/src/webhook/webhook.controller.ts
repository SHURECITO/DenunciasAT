import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import Redis from 'ioredis';
import axios from 'axios';
import { MinioService } from '@app/storage';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

// QR de WhatsApp expira aprox. en 60s — guardamos 90s para dar margen al frontend
const QR_TTL_SEGUNDOS = 90;
const REDIS_QR_KEY = 'evolution:qr';

// Mutex por número: TTL corto para evitar locks muertos, delay entre mensajes encolados
const LOCK_TTL_SEGUNDOS = 8;
const COLA_DELAY_MS     = 2000;
const WEBHOOK_MAX_SKEW_SECONDS = 300;

interface MensajeEncolado {
  numero: string;
  remoteJid: string;
  contenido: string;
  messageType: string;
  mediaUrlFinal?: string;
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly bucketEvidencias: string;
  private readonly webhookHmacSecret: string;

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly chatbotClientService: ChatbotClientService,
    private readonly minioService: MinioService,
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.bucketEvidencias = this.config.get<string>('MINIO_BUCKET_EVIDENCIAS', 'denunciasat-evidencias');
    this.webhookHmacSecret = this.config.get<string>('WHATSAPP_WEBHOOK_HMAC_SECRET', '').trim();
  }

  private secureCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  private maskPhone(numero: string): string {
    if (numero.length <= 4) return '****';
    return `${'*'.repeat(numero.length - 4)}${numero.slice(-4)}`;
  }

  /**
   * Verifica firma HMAC del webhook si WHATSAPP_WEBHOOK_HMAC_SECRET está configurado.
   * Firma esperada: sha256(timestamp.rawBody)
   */
  private validarFirmaWebhook(
    signature: string | undefined,
    timestamp: string | undefined,
    rawBody: Buffer | undefined,
  ): boolean {
    if (!this.webhookHmacSecret) return true;
    if (!signature || !timestamp || !rawBody) return false;

    const parsedTs = Number(timestamp);
    if (!Number.isFinite(parsedTs)) return false;
    const tsSeconds = parsedTs > 1_000_000_000_000
      ? Math.floor(parsedTs / 1000)
      : parsedTs;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsSeconds) > WEBHOOK_MAX_SKEW_SECONDS) return false;

    const payload = `${timestamp}.${rawBody.toString('utf8')}`;
    const digest = createHmac('sha256', this.webhookHmacSecret)
      .update(payload)
      .digest('hex');
    const normalizedSignature = signature.replace(/^sha256=/i, '').trim();
    return this.secureCompare(normalizedSignature, digest);
  }

  /**
   * Limpia el remoteJid a un número telefónico real.
   * - Remueve el sufijo @s.whatsapp.net / @lid / @g.us / @broadcast
   * - Quita cualquier carácter no numérico
   */
  private limpiarNumero(remoteJid: string): string {
    const sinArroba   = remoteJid.split('@')[0];
    return sinArroba.replace(/\D/g, '');
  }

  /**
   * Cuando el remoteJid es @lid y el número resultante tiene más de 13 dígitos,
   * intenta resolver el número real vía Evolution API /chat/whatsappNumbers.
   * Fallback: prefijo 57 + últimos 10 dígitos del JID.
   */
  private async resolverNumeroLid(remoteJid: string, fallback: string): Promise<string> {
    try {
      const baseUrl  = this.config.get<string>('EVOLUTION_API_URL', 'http://evolution-api:8080');
      const apiKey   = this.config.get<string>('EVOLUTION_API_KEY', '');
      const instance = this.config.get<string>('EVOLUTION_INSTANCE_NAME', 'denunciasAt');
      const resp = await axios.post(
        `${baseUrl}/chat/whatsappNumbers/${instance}`,
        { numbers: [remoteJid] },
        { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 3000 },
      );
      const jid = resp.data?.[0]?.jid as string | undefined;
      if (jid) {
        const num = jid.split('@')[0].replace(/\D/g, '');
        if (num && num.length >= 10 && num.length <= 15) return num;
      }
    } catch (e) {
      this.logger.warn(`resolverNumeroLid: no se pudo resolver ${remoteJid}: ${(e as Error).message}`);
    }
    // Fallback: prefijo colombiano + últimos 10 dígitos del JID
    const digits = remoteJid.split('@')[0].replace(/\D/g, '');
    return '57' + digits.slice(-10);
  }

  /**
   * Intenta extraer el número más confiable del payload.
   * En eventos @lid algunos campos incluyen un número alterno más estable.
   */
  private extraerNumeroPreferente(data: any, remoteJid: string): string {
    const candidatos = [
      remoteJid,
      data?.key?.participant,
      data?.participant,
      data?.sender,
      data?.senderNumber,
      data?.sender?.id,
      data?.sender?.number,
    ]
      .filter(Boolean)
      .map((v) => String(v));

    const normalizados = candidatos
      .map((c) => this.limpiarNumero(c))
      .filter((n) => n.length >= 10);

    // Preferir formato telefónico común (10-13 dígitos) si existe.
    const estable = normalizados.find((n) => n.length >= 10 && n.length <= 13);
    if (estable) return estable;

    // Si no hay mejor candidato, usar el primero disponible.
    return normalizados[0] ?? '';
  }

  private inferMediaInfo(messageType: string, mimeType?: string, mediaUrl?: string): { ext: string; contentType: string } {
    const mime = (mimeType ?? '').toLowerCase();
    const extFromUrl = (mediaUrl?.split('?')[0].split('.').pop() ?? '').toLowerCase();

    if (messageType === 'documentMessage') {
      return { ext: 'pdf', contentType: 'application/pdf' };
    }

    if (mime === 'image/png' || extFromUrl === 'png') {
      return { ext: 'png', contentType: 'image/png' };
    }
    if (mime === 'image/webp' || extFromUrl === 'webp') {
      return { ext: 'webp', contentType: 'image/webp' };
    }

    // Fallback seguro para fotos de WhatsApp
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }

  /** Descarga media desde Evolution API y la sube a MinIO. Devuelve la URL interna de MinIO. */
  private async persistMediaToMinio(
    mediaUrl: string,
    numero: string,
    ext: string,
    contentType: string,
  ): Promise<string | null> {
    try {
      const timestamp  = Date.now();
      const objectName = `${numero}/${timestamp}-${randomUUID()}.${ext}`;

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
      this.logger.warn(
        `Error subiendo media a MinIO para ${this.maskPhone(numero)}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Procesa un mensaje individual: lo envía al chatbot y entrega la respuesta por WhatsApp */
  private async procesarMensaje(msg: MensajeEncolado): Promise<void> {
    try {
      const { respuesta } = await this.chatbotClientService.procesar(
        msg.numero,
        msg.contenido,
        msg.messageType,
        msg.mediaUrlFinal,
      );
      if (respuesta) {
        await this.evolutionService.sendText(msg.remoteJid, respuesta);
      }
    } catch (err) {
      this.logger.error(
        `Error procesando webhook: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  @Post(':event')
  @HttpCode(200)
  async handleWebhook(
    @Body() payload: any,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
  ) {
    if (!this.validarFirmaWebhook(signature, timestamp, req.rawBody)) {
      this.logger.warn('Webhook rechazado: firma o timestamp inválido');
      throw new UnauthorizedException('Webhook no autorizado');
    }

    const event = payload?.event as string | undefined;
    this.logger.debug(`Webhook recibido: ${event ?? 'sin_evento'}`);

    if (event === 'qrcode.updated') {
      const base64 = payload.data?.qrcode?.base64 as string | undefined;
      if (base64) {
        await this.redis.setex(REDIS_QR_KEY, QR_TTL_SEGUNDOS, base64);
        this.logger.debug(`QR actualizado en Redis [clave=${REDIS_QR_KEY}]`);
      } else {
        this.logger.warn('qrcode.updated recibido sin base64');
      }
      return { ok: true };
    }

    if (event !== 'messages.upsert') return { ok: true };

    const data = payload.data;
    if (!data?.key || data.key.fromMe) return { ok: true };

    const remoteJid = data.key.remoteJid as string | undefined;
    if (!remoteJid) return { ok: true };

    // Ignorar mensajes de grupos o listas de difusión
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
      return { ok: true };
    }

    let numero = this.extraerNumeroPreferente(data, remoteJid);
    if (!numero) return { ok: true };

    // Si es @lid y el número tiene más de 13 dígitos, intentar resolución real
    if (remoteJid.endsWith('@lid') && numero.length > 13) {
      numero = await this.resolverNumeroLid(remoteJid, numero);
      this.logger.debug(`@lid resuelto → ${this.maskPhone(numero)}`);
    }

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
      const mimeType = data.message?.imageMessage?.mimetype ?? data.message?.documentMessage?.mimetype;
      const { ext, contentType } = this.inferMediaInfo(messageType, mimeType, mediaUrl);
      const minioUrl = await this.persistMediaToMinio(mediaUrl, numero, ext, contentType);
      if (minioUrl) {
        mediaUrlFinal = minioUrl;
      }
      // Si falla MinIO, se pasa la URL original como fallback (puede expirar, pero no rompe el flujo)
    }

    const mensaje: MensajeEncolado = {
      numero,
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

    // Recolectar mensajes encolados mientras se procesa el principal
    const colaPendiente: MensajeEncolado[] = [];
    try {
      await this.procesarMensaje(mensaje);

      let rawPendiente: string | null;
      while ((rawPendiente = await this.redis.rpop(queueKey))) {
        colaPendiente.push(JSON.parse(rawPendiente) as MensajeEncolado);
      }
    } finally {
      // Liberar el lock ANTES de procesar la cola pendiente
      await this.redis.del(lockKey);
    }

    // Drenar la cola ya con el lock liberado
    for (const msgPendiente of colaPendiente) {
      await new Promise((r) => setTimeout(r, COLA_DELAY_MS));
      await this.procesarMensaje(msgPendiente);
    }

    return { ok: true };
  }
}
