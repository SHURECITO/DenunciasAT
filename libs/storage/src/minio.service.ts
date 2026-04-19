import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import axios from 'axios';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: Minio.Client;
  private readonly allowedRemoteHosts: string[];

  constructor(private readonly config: ConfigService) {
    const endPointRaw = this.config.get<string>('MINIO_ENDPOINT', 'minio');
    // Admite tanto "minio" como "http://minio:9000" — extraer solo el host
    const endPoint = endPointRaw.replace(/^https?:\/\//, '').split(':')[0];
    const port = parseInt(this.config.get<string>('MINIO_PORT', '9000'), 10);

    this.client = new Minio.Client({
      endPoint,
      port,
      useSSL: false,
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY', ''),
      secretKey: this.config.get<string>('MINIO_SECRET_KEY', ''),
    });

    this.allowedRemoteHosts = this.config
      .get<string>('ALLOWED_REMOTE_MEDIA_HOSTS', 'evolution-api')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  }

  async onModuleInit() {
    this.logger.log(`MinioService inicializado (hosts remotos permitidos: ${this.allowedRemoteHosts.join(', ') || 'ninguno'})`);
  }

  private isRemoteHostAllowed(remoteUrl: string): boolean {
    let hostname: string;
    try {
      hostname = new URL(remoteUrl).hostname.toLowerCase();
    } catch {
      return false;
    }

    return this.allowedRemoteHosts.some((allowed) => {
      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
      }
      return hostname === allowed;
    });
  }

  // ─── Retry con backoff exponencial ───────────────────────────────────────────
  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastErr = err;
        if (attempt < delays.length) {
          this.logger.warn(`${label} — intento ${attempt + 1} fallido, reintentando en ${delays[attempt]}ms`);
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Sube un Buffer a MinIO. Devuelve el objectName.
   */
  async uploadBuffer(
    bucket: string,
    objectName: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    await this.withRetry(
      () => this.client.putObject(bucket, objectName, buffer, buffer.length, { 'Content-Type': contentType }),
      `uploadBuffer(${bucket}/${objectName})`,
    );
    this.logger.debug(`Subido a MinIO: ${bucket}/${objectName}`);
    return objectName;
  }

  /**
   * Descarga desde URL remota y sube a MinIO. Devuelve el objectName.
   */
  async uploadFromUrl(
    bucket: string,
    objectName: string,
    url: string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    if (!this.isRemoteHostAllowed(url)) {
      throw new Error('Host remoto no permitido para descarga de media');
    }

    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 15000 });
    const buffer = Buffer.from(res.data);
    // Detectar content-type real si no se especificó
    const ct = (res.headers['content-type'] as string | undefined) ?? contentType;
    return this.uploadBuffer(bucket, objectName, buffer, ct);
  }

  /**
   * Descarga un objeto desde MinIO y devuelve su contenido como Buffer.
   */
  async downloadBuffer(bucket: string, objectName: string): Promise<Buffer> {
    return this.withRetry(async () => {
      const stream = await this.client.getObject(bucket, objectName);
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    }, `downloadBuffer(${bucket}/${objectName})`);
  }

  /**
   * Elimina un objeto de MinIO. No lanza error si no existe.
   */
  async deleteObject(bucket: string, objectName: string): Promise<void> {
    try {
      await this.withRetry(
        () => this.client.removeObject(bucket, objectName),
        `deleteObject(${bucket}/${objectName})`,
      );
      this.logger.debug(`Eliminado de MinIO: ${bucket}/${objectName}`);
    } catch (err) {
      this.logger.warn(`No se pudo eliminar ${bucket}/${objectName}: ${(err as Error).message}`);
    }
  }

  /**
   * Comprueba si un objeto existe en MinIO.
   */
  async objectExists(bucket: string, objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(bucket, objectName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Genera una URL prefirmada para acceso temporal (GET) al objeto.
   */
  async getPresignedUrl(bucket: string, objectName: string, expirySeconds = 3600): Promise<string> {
    return this.withRetry(
      () => this.client.presignedGetObject(bucket, objectName, expirySeconds),
      `getPresignedUrl(${bucket}/${objectName})`,
    );
  }
}
