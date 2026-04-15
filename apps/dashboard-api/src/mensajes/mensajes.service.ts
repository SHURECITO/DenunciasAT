import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateMensajeDto } from './dto/create-mensaje.dto';
import { Mensaje } from './entities/mensaje.entity';

@Injectable()
export class MensajesService {
  constructor(
    @InjectRepository(Mensaje)
    private readonly mensajesRepo: Repository<Mensaje>,
  ) {}

  async findByDenuncia(denunciaId: number): Promise<Mensaje[]> {
    return this.mensajesRepo.find({
      where: { denunciaId },
      order: { timestamp: 'ASC' },
    });
  }

  async create(denunciaId: number, dto: CreateMensajeDto): Promise<Mensaje> {
    const mensaje = this.mensajesRepo.create({ ...dto, denunciaId });
    return this.mensajesRepo.save(mensaje);
  }

  async deleteByDenuncia(denunciaId: number): Promise<void> {
    await this.mensajesRepo.delete({ denunciaId });
  }
}
