import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
import { AuthModule } from './auth/auth.module';
import { DenunciasModule } from './denuncias/denuncias.module';
import { MensajesModule } from './mensajes/mensajes.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    DenunciasModule,
    MensajesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
