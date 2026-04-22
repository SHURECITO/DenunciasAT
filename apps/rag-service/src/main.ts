import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JsonLogger } from '@app/common';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProd ? new JsonLogger('rag-service') : ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3006;
  await app.listen(port);
  Logger.log(`rag-service escuchando en puerto ${port}`, 'Bootstrap');
}

bootstrap();
