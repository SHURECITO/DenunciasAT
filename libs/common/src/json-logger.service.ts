import { ConsoleLogger, LogLevel } from '@nestjs/common';

/**
 * Logger JSON para producción — compatible con Cloud Logging (GCP).
 * Emite cada línea como JSON: { timestamp, level, service, context, message, ...extra }
 */
export class JsonLogger extends ConsoleLogger {
  private readonly serviceName: string;

  constructor(serviceName: string, options?: { logLevels?: LogLevel[] }) {
    super('', options ?? {});
    this.serviceName = serviceName;
  }

  private emit(level: string, message: unknown, context?: string): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      context: context ?? this.context ?? '',
      message: typeof message === 'string' ? message : JSON.stringify(message),
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  override log(message: unknown, context?: string): void {
    this.emit('info', message, context);
  }

  override error(message: unknown, stack?: string, context?: string): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: this.serviceName,
      context: context ?? this.context ?? '',
      message: typeof message === 'string' ? message : JSON.stringify(message),
    };
    if (stack) entry['stack'] = stack;
    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  override warn(message: unknown, context?: string): void {
    this.emit('warn', message, context);
  }

  override debug(message: unknown, context?: string): void {
    this.emit('debug', message, context);
  }

  override verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context);
  }
}
