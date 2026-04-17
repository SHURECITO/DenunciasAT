import { Controller, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';

const REDIS_QR_KEY = 'evolution:qr';

@Controller('qr')
export class QrController {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  async getQr(): Promise<{ qr?: string; disponible: boolean }> {
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
