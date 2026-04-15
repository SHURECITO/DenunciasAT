import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mensaje } from './entities/mensaje.entity';
import { MensajesController } from './mensajes.controller';
import { MensajesService } from './mensajes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mensaje])],
  controllers: [MensajesController],
  providers: [MensajesService],
  exports: [MensajesService],
})
export class MensajesModule {}
