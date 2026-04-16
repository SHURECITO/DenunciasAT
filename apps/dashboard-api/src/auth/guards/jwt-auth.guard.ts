import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

export const SKIP_JWT_KEY = 'skipJwt';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Si la ruta tiene @SkipJwt(), deja pasar (otro guard se encarga de la auth)
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_JWT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    return super.canActivate(context);
  }
}
