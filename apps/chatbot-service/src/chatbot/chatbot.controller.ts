import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';

interface ProcesarDto {
  numero: string;
  mensaje: string;
  tipo: string;
}

@Controller()
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('procesar')
  @HttpCode(200)
  async procesar(@Body() dto: ProcesarDto): Promise<{ respuesta: string }> {
    const respuesta = await this.chatbotService.procesarMensaje(
      dto.numero,
      dto.mensaje,
    );
    return { respuesta };
  }
}
