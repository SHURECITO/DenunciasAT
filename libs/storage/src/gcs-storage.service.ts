import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';
import axios from 'axios';

@Injectable()
export class GcsStorageService implements OnModuleInit {
  private readonly logger = new Logger(GcsStorageService.name);
  private readonly storage: Storage;
  private readonly allowedRemoteHosts: string[];

  constructor(private readonly config: ConfigService) {
    this.storage = new Storage({
      projectId: this.config.get<string>('GCP_PROJECT_ID'),
      // Si GOOGLE_APPLICATION_CREDENTIALS está definido, el SDK lo usa automáticamente.
      // En producción con Workload Identity, no se requiere archivo de credenciales.
    });

    this.allowedRemoteHosts = this.config
      .get<string>('ALLOWED_REMOTE_MEDIA_HOSTS', 'evolution-api')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }

  async onModuleInit() {
    this.logger.log(`GcsStorageService inicializado (hosts permitidos: ${this.allowedRemoteHosts.join(', ') || 'ninguno'})`);
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

  private bucket(bucketName: string): Bucket {
    return this.storage.bucket(bucketName);
  }

  /** Sube un Buffer a GCS. Devuelve el objectName. */
  async uploadBuffer(
    bucketName: string,
    objectName: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    await this.withRetry(async () => {
      const file = this.bucket(bucketName).file(objectName);
      await file.save(buffer, { contentType, resumable: false });
    }, `uploadBuffer(${bucketName}/${objectName})`);
    this.logger.debug(`Subido a GCS: ${bucketName}/${objectName}`);
    return objectName;
  }

  /** Descarga desde URL remota y sube a GCS. Devuelve el objectName. */
  async uploadFromUrl(
    bucketName: string,
    objectName: string,
    url: string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    if (!this.isRemoteHostAllowed(url)) {
      throw new Error('Host remoto no permitido para descarga de media');
    }
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 15000 });
    const buffer = Buffer.from(res.data);
    const ct = (res.headers['content-type'] as string | undefined) ?? contentType;
    return this.uploadBuffer(bucketName, objectName, buffer, ct);
  }

  /** Descarga un objeto desde GCS y devuelve su contenido como Buffer. */
  async downloadBuffer(bucketName: string, objectName: string): Promise<Buffer> {
    return this.withRetry(async () => {
      const [data] = await this.bucket(bucketName).file(objectName).download();
      return data;
    }, `downloadBuffer(${bucketName}/${objectName})`);
  }

  /** Elimina un objeto de GCS. No lanza error si no existe. */
  async deleteObject(bucketName: string, objectName: string): Promise<void> {
    try {
      await this.withRetry(
        () => this.bucket(bucketName).file(objectName).delete(),
        `deleteObject(${bucketName}/${objectName})`,
      );
      this.logger.debug(`Eliminado de GCS: ${bucketName}/${objectName}`);
    } catch (err) {
      this.logger.warn(`No se pudo eliminar ${bucketName}/${objectName}: ${(err as Error).message}`);
    }
  }

  /** Comprueba si un objeto existe en GCS. */
  async objectExists(bucketName: string, objectName: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket(bucketName).file(objectName).exists();
      return exists;
    } catch {
      return false;
    }
  }

  /** Genera una URL firmada para acceso temporal (GET) al objeto. */
  async getPresignedUrl(bucketName: string, objectName: string, expirySeconds = 3600): Promise<string> {
    return this.withRetry(async () => {
      const [url] = await this.bucket(bucketName).file(objectName).getSignedUrl({
        action: 'read',
        expires: Date.now() + expirySeconds * 1000,
      });
      return url;
    }, `getPresignedUrl(${bucketName}/${objectName})`);
  }
}
