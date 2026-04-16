import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Login tiene un límite estricto para mitigar fuerza bruta
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ burst: { ttl: 60000, limit: 10 }, sustained: { ttl: 300000, limit: 20 } })
  @ApiOperation({ summary: 'Iniciar sesión y obtener JWT' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Seed solo disponible si SEED_ENABLED=true en las variables de entorno
  @Post('seed')
  @HttpCode(HttpStatus.CREATED)
  @SkipThrottle()
  @ApiOperation({ summary: 'Crear usuario admin inicial (requiere SEED_ENABLED=true)' })
  seed() {
    if (process.env.SEED_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Endpoint deshabilitado. Configure SEED_ENABLED=true para habilitarlo.',
      );
    }
    return this.authService.seed();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener usuario autenticado actual' })
  me(@Request() req: { user: { id: number; email: string; nombre: string } }) {
    return req.user;
  }
}
