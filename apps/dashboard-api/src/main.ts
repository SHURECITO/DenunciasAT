import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  // Verificación temprana: falla en arranque si el secret es inseguro
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32 || jwtSecret === 'dev_secret_change_in_production') {
    throw new Error(
      'FATAL: JWT_SECRET no configurado o inseguro. ' +
        'Debe tener al menos 32 caracteres y no puede ser el valor de ejemplo.',
    );
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Headers de seguridad HTTP
  app.use(helmet());

  // CORS: solo el frontend autorizado puede hacer peticiones
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Validación de DTOs: rechaza campos desconocidos
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  // Logging de todas las peticiones HTTP
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger: documentación de la API
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DenunciasAT API')
    .setDescription('API del sistema de gestión de denuncias del concejal Andrés Tobón')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`DenunciasAT API escuchando en puerto ${port}`, 'Bootstrap');
}

bootstrap();
