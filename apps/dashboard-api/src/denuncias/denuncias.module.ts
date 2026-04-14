import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DenunciasController } from './denuncias.controller';
import { DenunciasService } from './denuncias.service';
import { Denuncia } from './entities/denuncia.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Denuncia])],
  controllers: [DenunciasController],
  providers: [DenunciasService],
})
export class DenunciasModule {}
