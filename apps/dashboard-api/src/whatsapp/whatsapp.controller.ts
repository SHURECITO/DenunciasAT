import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WhatsappService } from './whatsapp.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('estado')
  @ApiOperation({ summary: 'Estado de conexión de WhatsApp' })
  getEstado() {
    return this.whatsappService.getEstado();
  }

  @Get('qr')
  @ApiOperation({ summary: 'Obtener QR de conexión WhatsApp' })
  getQr() {
    return this.whatsappService.getQr();
  }

  @Post('reconectar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desconectar y reconectar instancia WhatsApp' })
  reconectar() {
    return this.whatsappService.reconectar();
  }
}
