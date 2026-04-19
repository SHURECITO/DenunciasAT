import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Denuncia } from '../denuncias/entities/denuncia.entity';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || '*' },
  namespace: '/eventos',
})
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  // Emitir cuando llega una denuncia nueva
  emitNuevaDenuncia(denuncia: Partial<Denuncia>) {
    this.server.emit('nueva_denuncia', {
      id: denuncia.id,
      radicado: denuncia.radicado,
      nombreCiudadano: denuncia.nombreCiudadano,
      dependenciaAsignada: denuncia.dependenciaAsignada,
      estado: denuncia.estado,
      esEspecial: denuncia.esEspecial,
      fechaCreacion: denuncia.fechaCreacion,
    });
  }

  // Emitir cuando cambia el estado de una denuncia
  emitCambioEstado(
    denunciaId: number,
    estadoAnterior: string,
    estadoNuevo: string,
  ) {
    this.server.emit('cambio_estado', {
      denunciaId,
      estadoAnterior,
      estadoNuevo,
      timestamp: new Date(),
    });
  }

  // Emitir cuando el documento está listo
  emitDocumentoListo(denunciaId: number, radicado: string) {
    this.server.emit('documento_listo', {
      denunciaId,
      radicado,
      timestamp: new Date(),
    });
  }

  // Emitir cuando llega mensaje nuevo al chat
  emitNuevoMensaje(denunciaId: number, mensaje: unknown) {
    this.server.emit('nuevo_mensaje', {
      denunciaId,
      mensaje,
      timestamp: new Date(),
    });
  }
}