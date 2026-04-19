import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private readonly config: ConfigService,
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

    const adminPassword = this.config.get<string>('SEED_ADMIN_PASSWORD', '').trim();
    if (adminPassword.length < 12) {
      throw new BadRequestException('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres');
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const admin = this.usuariosRepo.create({
      nombre: 'Administrador',
      email: 'admin@denunciasat.co',
      passwordHash,
    });
    await this.usuariosRepo.save(admin);
    return { message: 'Usuario admin creado: admin@denunciasat.co' };
  }
}
