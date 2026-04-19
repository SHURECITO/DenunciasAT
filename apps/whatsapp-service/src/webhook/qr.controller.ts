import {
  Controller,
  Get,
  Headers,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import Redis from 'ioredis';

const REDIS_QR_KEY = 'evolution:qr';

@Controller('qr')
export class QrController {
  private readonly internalKey: string;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    const qrKey = this.config.get<string>('WHATSAPP_QR_INTERNAL_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.internalKey = qrKey || fallback;
  }

  private secureCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  @Get()
  async getQr(
    @Headers('x-internal-key') key: string | undefined,
    @Headers('x-internal-service') service: string | undefined,
  ): Promise<{ qr?: string; disponible: boolean }> {
    if (!this.internalKey || !key || !this.secureCompare(key, this.internalKey) || service !== 'dashboard') {
      throw new UnauthorizedException('No autorizado');
    }

    const base64 = await this.redis.get(REDIS_QR_KEY);
    if (!base64) return { disponible: false };
    return { qr: base64, disponible: true };
  }
}

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'whatsapp-service', timestamp: new Date() };
  }
}
