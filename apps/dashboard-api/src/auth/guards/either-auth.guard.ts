import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';

/**
 * Permite el acceso si se cumple CUALQUIERA de estas condiciones:
 * 1. Bearer JWT válido en el header Authorization
 * 2. x-internal-key válido para el servicio interno declarado en x-internal-service
 */
@Injectable()
export class EitherAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private secureCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  private resolveInternalKey(service: string): string {
    const legacy = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    if (service === 'chatbot') {
      return this.config.get<string>('CHATBOT_API_INTERNAL_KEY', '').trim() || legacy;
    }
    if (service === 'document') {
      return this.config.get<string>('DOCUMENT_API_INTERNAL_KEY', '').trim() || legacy;
    }
    return '';
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      authContext?: { type: 'internal' | 'jwt'; service?: string };
    }>();

    // Opción 1: internal key segmentada por servicio
    const internalService = String(req.headers['x-internal-service'] ?? '').toLowerCase().trim();
    const internalKey = String(req.headers['x-internal-key'] ?? '').trim();
    if (internalService && internalKey) {
      const expected = this.resolveInternalKey(internalService);
      if (expected && this.secureCompare(internalKey, expected)) {
        req.authContext = { type: 'internal', service: internalService };
        return true;
      }
      return false;
    }

    // Compatibilidad opcional con esquema legado (sin x-internal-service)
    const allowLegacy = String(this.config.get<string>('ALLOW_LEGACY_INTERNAL_AUTH', 'false')) === 'true';
    if (allowLegacy && internalKey) {
      const legacy = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
      if (legacy && this.secureCompare(internalKey, legacy)) {
        req.authContext = { type: 'internal', service: 'legacy' };
        return true;
      }
    }

    // Opción 2: JWT
    const authHeader = String(req.headers['authorization'] ?? '');
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        this.jwtService.verify(token);
        req.authContext = { type: 'jwt' };
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
}
