import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { method, url } = req;
    const ip = req.ip ?? req.socket.remoteAddress ?? '-';
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${method} ${url} ${res.statusCode} — ${ms}ms [${ip}]`);
      }),
      catchError((err: Error) => {
        const ms = Date.now() - start;
        this.logger.error(
          `${method} ${url} ERROR — ${ms}ms [${ip}] — ${err.message}`,
          err.stack,
        );
        throw err;
      }),
    );
  }
}
