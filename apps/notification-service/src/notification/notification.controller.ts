import { Body, Controller, Get, Post } from '@nestjs/common';
import { NotificationService, NotificarRespuestaDto } from './notification.service';

@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'notification-service' };
  }

  @Post('notificar/respuesta')
  notificarRespuesta(@Body() dto: NotificarRespuestaDto) {
    return this.notificationService.notificarRespuesta(dto);
  }
}
