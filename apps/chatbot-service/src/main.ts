import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  Logger.log(`chatbot-service escuchando en puerto ${port}`, 'Bootstrap');
  Logger.log(`Gemini API Key configurada: ${!!process.env.GEMINI_API_KEY}`, 'Bootstrap');
}
bootstrap();
