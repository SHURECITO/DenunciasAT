import * as crypto from 'crypto';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JsonLogger } from '@app/common';

const SWAGGER_PATH = 'api-docs';

/**
 * Comparación de strings en tiempo constante para evitar timing attacks.
 * Devuelve false si las longitudes difieren (no lanza excepción).
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Ejecutar igualmente para no filtrar longitud por tiempo
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Middleware Express de Basic Auth restringido a /api-docs*.
 * Se monta ANTES de SwaggerModule.setup() para cubrir también el JSON/YAML spec.
 */
function buildSwaggerAuthMiddleware(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith(`/${SWAGGER_PATH}`)) {
      next();
      return;
    }

    const authHeader = req.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', `Basic realm="DenunciasAT Docs"`);
      res.status(401).send('Se requieren credenciales para acceder a la documentación.');
      return;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    const reqUser = decoded.slice(0, colonIdx);
    const reqPass = decoded.slice(colonIdx + 1);

    if (safeEqual(reqUser, user) && safeEqual(reqPass, password)) {
      next();
    } else {
      res.setHeader('WWW-Authenticate', `Basic realm="DenunciasAT Docs"`);
      res.status(401).send('Credenciales inválidas.');
    }
  };
}

async function bootstrap() {
  // Verificación temprana: falla en arranque si el secret es inseguro
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32 || jwtSecret === 'dev_secret_change_in_production') {
    throw new Error(
      'FATAL: JWT_SECRET no configurado o inseguro. ' +
        'Debe tener al menos 32 caracteres y no puede ser el valor de ejemplo.',
    );
  }

  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProd ? new JsonLogger('dashboard-api') : ['error', 'warn', 'log'],
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

  const swaggerEnabled = (process.env.SWAGGER_ENABLED ?? 'false').toLowerCase() === 'true';

  if (swaggerEnabled) {
    const swaggerUser = process.env.SWAGGER_USER ?? '';
    const swaggerPassword = process.env.SWAGGER_PASSWORD ?? '';

    if (isProd) {
      if (!swaggerUser || !swaggerPassword) {
        // En producción sin credenciales configuradas: Swagger queda deshabilitado.
        Logger.warn(
          'Swagger deshabilitado: SWAGGER_USER y SWAGGER_PASSWORD son obligatorios en producción.',
          'Bootstrap',
        );
      } else {
        // Producción con credenciales: montar Basic Auth antes de la UI.
        app.use(buildSwaggerAuthMiddleware(swaggerUser, swaggerPassword));
        setupSwagger(app);
        Logger.log(`Swagger disponible en /${SWAGGER_PATH} (protegido con Basic Auth)`, 'Bootstrap');
      }
    } else {
      // Desarrollo: acceso libre.
      setupSwagger(app);
      Logger.log(`Swagger disponible en /${SWAGGER_PATH} (sin autenticación — entorno dev)`, 'Bootstrap');
    }
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`DenunciasAT API escuchando en puerto ${port}`, 'Bootstrap');
}

import { INestApplication } from '@nestjs/common';

function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('DenunciasAT API')
    .setDescription('API del sistema de gestión de denuncias del concejal Andrés Tobón')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

bootstrap();
