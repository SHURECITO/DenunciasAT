import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepo: Repository<Usuario>,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ access_token: string }> {
    const usuario = await this.usuariosRepo.findOne({
      where: { email: dto.email, activo: true },
      select: ['id', 'email', 'nombre', 'passwordHash', 'activo'],
    });

    if (!usuario) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    const payload = { sub: usuario.id, email: usuario.email };
    return { access_token: this.jwtService.sign(payload) };
  }

  async seed(): Promise<{ message: string }> {
    const existe = await this.usuariosRepo.findOne({
      where: { email: 'admin@denunciasat.co' },
    });
    if (existe) throw new ConflictException('El usuario admin ya existe');

    const passwordHash = await bcrypt.hash('Admin1234!', 12);
    const admin = this.usuariosRepo.create({
      nombre: 'Administrador',
      email: 'admin@denunciasat.co',
      passwordHash,
    });
    await this.usuariosRepo.save(admin);
    return { message: 'Usuario admin creado: admin@denunciasat.co / Admin1234!' };
  }
}
