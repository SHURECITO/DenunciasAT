import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JsonLogger } from '@app/common';

function warnMissingEnv(vars: string[]): void {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    Logger.warn(`Variables de entorno no configuradas: ${missing.join(', ')}`, 'Bootstrap');
  }
}

async function bootstrap() {
  warnMissingEnv(['GCS_BUCKET_DOCUMENTOS', 'DASHBOARD_API_INTERNAL_KEY', 'GEMINI_API_KEY']);

  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProd ? new JsonLogger('document-service') : ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  Logger.log(`document-service escuchando en puerto ${port}`, 'Bootstrap');
}
bootstrap();
