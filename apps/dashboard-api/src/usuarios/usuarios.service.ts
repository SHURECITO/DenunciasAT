import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { Usuario } from './entities/usuario.entity';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepo: Repository<Usuario>,
  ) {}

  findAll(): Promise<Usuario[]> {
    return this.usuariosRepo.find({ order: { fechaCreacion: 'DESC' } });
  }

  async findOne(id: number): Promise<Usuario> {
    const usuario = await this.usuariosRepo.findOne({ where: { id } });
    if (!usuario) throw new NotFoundException(`Usuario #${id} no encontrado`);
    return usuario;
  }

  async create(dto: CreateUsuarioDto): Promise<Usuario> {
    const existe = await this.usuariosRepo.findOne({
      where: { email: dto.email },
    });
    if (existe) {
      throw new ConflictException(`El email "${dto.email}" ya está registrado`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const usuario = this.usuariosRepo.create({
      nombre: dto.nombre,
      email: dto.email,
      passwordHash,
    });
    const saved = await this.usuariosRepo.save(usuario);
    // Re-fetch para que select:false en passwordHash se aplique correctamente
    return this.findOne(saved.id);
  }

  async update(id: number, dto: UpdateUsuarioDto): Promise<Usuario> {
    const usuario = await this.findOne(id);

    if (dto.email && dto.email !== usuario.email) {
      const existe = await this.usuariosRepo.findOne({
        where: { email: dto.email },
      });
      if (existe) {
        throw new ConflictException(`El email "${dto.email}" ya está en uso`);
      }
    }

    Object.assign(usuario, dto);
    return this.usuariosRepo.save(usuario);
  }

  async toggleActivo(id: number, requesterId: number): Promise<Usuario> {
    if (id === requesterId) {
      throw new BadRequestException('No puedes desactivarte a ti mismo');
    }

    const usuario = await this.findOne(id);
    usuario.activo = !usuario.activo;
    return this.usuariosRepo.save(usuario);
  }
}
