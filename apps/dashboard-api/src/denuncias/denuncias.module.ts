import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { EitherAuthGuard } from '../auth/guards/either-auth.guard';
import { EventsModule } from '../events/events.module';
import { StorageModule } from '@app/storage';
import { DenunciasController } from './denuncias.controller';
import { DenunciasService } from './denuncias.service';
import { DocumentLifecycleService } from './document-lifecycle.service';
import { Denuncia } from './entities/denuncia.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Denuncia]),
    ConfigModule,
    AuthModule,
    StorageModule,
    EventsModule,
  ],
  controllers: [DenunciasController],
  providers: [DenunciasService, EitherAuthGuard, DocumentLifecycleService],
})
export class DenunciasModule {}
