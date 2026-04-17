import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';

interface ProcesarDto {
  numero: string;
  mensaje: string;
  tipo: string;
  mediaUrl?: string;
}

@Controller()
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'chatbot-service', timestamp: new Date() };
  }

  @Post('procesar')
  @HttpCode(200)
  async procesar(@Body() dto: ProcesarDto): Promise<{ respuesta: string }> {
    const respuesta = await this.chatbotService.procesarMensaje(
      dto.numero,
      dto.mensaje,
      dto.tipo,
      dto.mediaUrl,
    );
    return { respuesta };
  }
}
