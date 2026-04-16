import { Injectable } from '@nestjs/common';
import { GeminiService } from '@app/ai';
import {
  ConversacionService,
  DatosConversacion,
  EstadoConversacion,
  PasoConversacion,
} from './conversacion.service';
import { DashboardApiService } from './dashboard-api.service';

@Injectable()
export class ChatbotService {
  constructor(
    private readonly conversacion: ConversacionService,
    private readonly dashboardApi: DashboardApiService,
    private readonly gemini: GeminiService,
  ) {}

  async procesarMensaje(numero: string, mensaje: string): Promise<string> {
    let estado = await this.conversacion.getEstado(numero);

    if (!estado || estado.paso === PasoConversacion.FINALIZADO) {
      estado = {
        paso: PasoConversacion.INICIO,
        datos: { telefono: numero },
      };
    }

    const respuesta = await this.manejarPaso(estado, mensaje, numero);

    // Simular delay de escritura humana
    const delay = Math.min(2000 + mensaje.length * 50, 10000);
    await new Promise((r) => setTimeout(r, delay));

    return respuesta;
  }

  private async manejarPaso(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    switch (estado.paso) {
      case PasoConversacion.INICIO:
        return this.iniciarConversacion(estado, numero);

      case PasoConversacion.ESPERANDO_NOMBRE:
        return this.recibirNombre(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_CEDULA:
        return this.recibirCedula(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_UBICACION:
        return this.recibirUbicacion(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_DESCRIPCION:
        return this.recibirDescripcion(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_CONFIRMACION:
        return this.recibirConfirmacion(estado, mensaje, numero);

      default:
        return '¡Hola! Escribe *hola* para iniciar una nueva denuncia.';
    }
  }

  private async iniciarConversacion(
    estado: EstadoConversacion,
    numero: string,
  ): Promise<string> {
    estado.paso = PasoConversacion.ESPERANDO_NOMBRE;
    await this.conversacion.setEstado(numero, estado);
    return (
      '¡Hola! 👋 Soy el asistente del concejal Andrés Tobón. ' +
      'Estoy aquí para ayudarte a presentar tu denuncia.\n\n' +
      'Todo lo que me cuentes será tratado con total confidencialidad. ' +
      '¿Me puedes decir tu nombre para empezar?'
    );
  }

  private async recibirNombre(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const nombre = mensaje.trim();
    if (nombre.length < 3) {
      return 'Por favor ingresa tu nombre completo (mínimo 3 caracteres).';
    }
    estado.datos.nombre = nombre;
    estado.paso = PasoConversacion.ESPERANDO_CEDULA;
    await this.conversacion.setEstado(numero, estado);
    return `Gracias, ${nombre}. Ahora necesito tu número de cédula para identificarte en el radicado oficial.`;
  }

  private async recibirCedula(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const cedula = mensaje.replace(/\D/g, '').trim();
    if (cedula.length < 5) {
      return 'Por favor ingresa un número de cédula válido.';
    }
    estado.datos.cedula = cedula;
    estado.paso = PasoConversacion.ESPERANDO_UBICACION;
    await this.conversacion.setEstado(numero, estado);
    return 'Perfecto. ¿En qué dirección o sector de Medellín ocurrió lo que quieres reportar?';
  }

  private async recibirUbicacion(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const ubicacion = mensaje.trim();
    if (ubicacion.length < 3) {
      return 'Por favor indica la ubicación con más detalle.';
    }
    estado.datos.ubicacion = ubicacion;
    estado.paso = PasoConversacion.ESPERANDO_DESCRIPCION;
    await this.conversacion.setEstado(numero, estado);
    return (
      'Cuéntame con detalle qué está pasando. No te preocupes por usar términos legales, cuéntamelo todo. ' +
      'Es mejor tener muchos más detalles, para poder ayudarte mucho mejor. 🙏'
    );
  }

  private async recibirDescripcion(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const descripcion = mensaje.trim();
    if (descripcion.length < 10) {
      return 'Por favor describe el problema con más detalle (mínimo 10 caracteres).';
    }
    estado.datos.descripcion = descripcion;

    // Clasificar con Gemini
    try {
      const clasificacion = await this.gemini.clasificarDenuncia(descripcion);
      estado.datos.esEspecial = clasificacion.esEspecial;
      estado.datos.dependencia = clasificacion.dependencia;
    } catch {
      estado.datos.esEspecial = false;
      estado.datos.dependencia = 'Sin asignar';
    }

    estado.paso = PasoConversacion.ESPERANDO_CONFIRMACION;
    await this.conversacion.setEstado(numero, estado);

    const datos = estado.datos;
    const descripcionCorta =
      descripcion.length > 100 ? descripcion.substring(0, 100) + '...' : descripcion;

    return (
      'Perfecto, déjame resumirte lo que voy a radicar:\n\n' +
      `👤 Nombre: ${datos.nombre}\n` +
      `🪪 Cédula: ${datos.cedula}\n` +
      `📍 Ubicación: ${datos.ubicacion}\n` +
      `🏛️ Dirigido a: ${datos.dependencia}\n` +
      `📝 Descripción: ${descripcionCorta}\n\n` +
      '¿Está todo correcto? Responde *sí* para confirmar o dime qué dato quieres corregir.'
    );
  }

  private async recibirConfirmacion(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const respuesta = mensaje.trim().toLowerCase();
    const esAfirmativo = ['si', 'sí', 's', 'yes', 'confirmo', 'ok', '1'].includes(respuesta);
    const esNegativo = ['no', 'n', 'cancelar', 'cancel', '0'].includes(respuesta);

    if (!esAfirmativo && !esNegativo) {
      return 'Por favor responde *sí* para confirmar el envío o *no* para cancelar.';
    }

    if (esNegativo) {
      await this.conversacion.clearEstado(numero);
      return 'Tu denuncia ha sido cancelada. Si deseas iniciar una nueva, escribe *hola* en cualquier momento.';
    }

    const datos = estado.datos as Required<DatosConversacion>;
    try {
      const { radicado } = await this.dashboardApi.crearDenuncia({
        nombreCiudadano: datos.nombre,
        cedula: datos.cedula,
        telefono: datos.telefono,
        ubicacion: datos.ubicacion,
        descripcion: datos.descripcion,
        dependenciaAsignada: datos.dependencia,
        esEspecial: datos.esEspecial,
      });

      estado.paso = PasoConversacion.FINALIZADO;
      await this.conversacion.setEstado(numero, estado);

      // Mensaje diferenciado para denuncias especiales (confidenciales)
      if (datos.esEspecial) {
        return (
          'Gracias por tu confianza al compartir esto con nosotros. 🙏 ' +
          'Tu denuncia ha sido registrada de forma confidencial.\n\n' +
          'Por la naturaleza delicada de lo que reportas, una persona de confianza del equipo del concejal ' +
          'se encargará de atenderte directamente. Por favor estate pendiente.'
        );
      }

      return (
        '✅ ¡Tu denuncia ha sido radicada exitosamente!\n\n' +
        `Tu número de radicado es: *${radicado}*\n\n` +
        `El equipo del concejal Andrés Tobón gestionará tu caso ante ${datos.dependencia}. ` +
        'Cuando tengamos respuesta de la administración te notificaremos por este mismo chat.\n\n' +
        '¡Gracias por confiar en nosotros! 🤝'
      );
    } catch (err) {
      console.error('Error creando denuncia:', err);
      return (
        'Hubo un error al registrar tu denuncia. Por favor intenta de nuevo en unos minutos ' +
        'o comunícate directamente con el despacho.'
      );
    }
  }
}
