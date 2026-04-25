import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@app/database';
import { validate } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { DenunciasModule } from './denuncias/denuncias.module';
import { MensajesModule } from './mensajes/mensajes.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { EstadisticasModule } from './estadisticas/estadisticas.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { EventsModule } from './events/events.module';
import { RagModule } from './rag/rag.module';
import { FeedbackModule } from './feedback/feedback.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    // Rate limiting global: máximo 5 peticiones por segundo por IP
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 1000, limit: 5 },
      { name: 'sustained', ttl: 60000, limit: 200 },
    ]),
    DatabaseModule,
    AuthModule,
    DenunciasModule,
    MensajesModule,
    UsuariosModule,
    EstadisticasModule,
    WhatsappModule,
    EventsModule,
    RagModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [
    // Aplica rate limiting a todos los endpoints excepto los marcados con @SkipThrottle
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
