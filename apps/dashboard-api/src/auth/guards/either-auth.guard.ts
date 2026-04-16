import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Permite el acceso si se cumple CUALQUIERA de estas condiciones:
 * 1. Bearer JWT válido en el header Authorization
 * 2. x-internal-key coincide con DASHBOARD_API_INTERNAL_KEY
 */
@Injectable()
export class EitherAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string>;
    }>();

    // Opción 1: internal key
    const internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY');
    if (internalKey && req.headers['x-internal-key'] === internalKey) {
      return true;
    }

    // Opción 2: JWT
    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        this.jwtService.verify(token);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
}
