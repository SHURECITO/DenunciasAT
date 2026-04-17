import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  console.log(`document-service escuchando en puerto ${port}`);
}
bootstrap();
