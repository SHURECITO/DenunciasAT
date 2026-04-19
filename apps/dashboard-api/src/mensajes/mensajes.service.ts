import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateMensajeDto } from './dto/create-mensaje.dto';
import { Mensaje } from './entities/mensaje.entity';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class MensajesService {
  constructor(
    @InjectRepository(Mensaje)
    private readonly mensajesRepo: Repository<Mensaje>,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async findByDenuncia(denunciaId: number): Promise<Mensaje[]> {
    return this.mensajesRepo.find({
      where: { denunciaId },
      order: { timestamp: 'ASC' },
    });
  }

  async create(denunciaId: number, dto: CreateMensajeDto): Promise<Mensaje> {
    const mensaje = this.mensajesRepo.create({ ...dto, denunciaId });
    const saved = await this.mensajesRepo.save(mensaje);
    this.eventsGateway.emitNuevoMensaje(denunciaId, saved);
    return saved;
  }

  async deleteByDenuncia(denunciaId: number): Promise<void> {
    await this.mensajesRepo.delete({ denunciaId });
  }
}
