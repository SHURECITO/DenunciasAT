import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const key = req.headers['x-internal-key'];
    const expected = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY');
    return !!expected && key === expected;
  }
}
