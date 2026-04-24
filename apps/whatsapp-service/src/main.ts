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
  warnMissingEnv(['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'GCS_BUCKET_EVIDENCIAS', 'REDIS_URL']);

  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: isProd ? new JsonLogger('whatsapp-service') : ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  Logger.log(`whatsapp-service escuchando en puerto ${port}`, 'Bootstrap');
}
bootstrap();
