import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EitherAuthGuard } from '../auth/guards/either-auth.guard';
import { EventsModule } from '../events/events.module';
import { Mensaje } from './entities/mensaje.entity';
import { MensajesController } from './mensajes.controller';
import { MensajesService } from './mensajes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mensaje]), AuthModule, EventsModule],
  controllers: [MensajesController],
  providers: [MensajesService, EitherAuthGuard],
  exports: [MensajesService],
})
export class MensajesModule {}
