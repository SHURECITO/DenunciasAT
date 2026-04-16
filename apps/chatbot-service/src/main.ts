import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  console.log(`chatbot-service escuchando en puerto ${port}`);
  console.log('Gemini API Key configurada:', !!process.env.GEMINI_API_KEY);
}
bootstrap();
