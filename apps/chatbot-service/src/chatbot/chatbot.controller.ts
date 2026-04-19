import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ChatbotService } from './chatbot.service';
import { ProcesarDto } from './dto/procesar.dto';

@Controller()
export class ChatbotController {
  private readonly inboundInternalKey: string;

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly config: ConfigService,
  ) {
    const serviceKey = this.config.get<string>('WHATSAPP_TO_CHATBOT_KEY', '').trim();
    const fallback = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();
    this.inboundInternalKey = serviceKey || fallback;
  }

  private secureCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'chatbot-service', timestamp: new Date() };
  }

  @Post('procesar')
  @HttpCode(200)
  async procesar(
    @Body() dto: ProcesarDto,
    @Headers('x-internal-key') key: string | undefined,
    @Headers('x-internal-service') service: string | undefined,
  ): Promise<{ respuesta: string }> {
    if (
      !this.inboundInternalKey ||
      !key ||
      !this.secureCompare(key, this.inboundInternalKey) ||
      service !== 'whatsapp'
    ) {
      throw new UnauthorizedException('No autorizado');
    }

    const respuesta = await this.chatbotService.procesarMensaje(
      dto.numero,
      dto.mensaje,
      dto.tipo,
      dto.mediaUrl,
    );
    return { respuesta };
  }
}
