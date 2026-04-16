import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ConversacionService,
  DatosConversacion,
  EstadoConversacion,
  PasoConversacion,
} from './conversacion.service';
import { DashboardApiService } from './dashboard-api.service';

@Injectable()
export class ChatbotService {
  private readonly openai: OpenAI;

  constructor(
    private readonly conversacion: ConversacionService,
    private readonly dashboardApi: DashboardApiService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY', ''),
    });
  }

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
      '¡Bienvenido al sistema de denuncias ciudadanas del *Concejal Andrés Tobón*! 🏛️\n\n' +
      'Con tu denuncia ayudas a mejorar Medellín. El proceso toma solo unos minutos.\n\n' +
      '¿Cuál es tu *nombre completo*?'
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
    return `Gracias, *${nombre}*. ¿Cuál es tu número de *cédula*?`;
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
    return '¿En qué *barrio o dirección* ocurrió el problema que deseas reportar?';
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
      'Cuéntame con detalle: ¿*qué problema deseas denunciar*?\n\n' +
      '_Escribe con la mayor claridad posible para que podamos gestionarlo correctamente._'
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

    // Clasificar con OpenAI
    try {
      const clasificacion = await this.clasificarDenuncia(descripcion);
      estado.datos.esEspecial = clasificacion.esEspecial;
      estado.datos.dependencia = clasificacion.dependencia;
    } catch {
      estado.datos.esEspecial = false;
      estado.datos.dependencia = 'Sin asignar';
    }

    estado.paso = PasoConversacion.ESPERANDO_CONFIRMACION;
    await this.conversacion.setEstado(numero, estado);

    const datos = estado.datos;
    return (
      '✅ *Resumen de tu denuncia:*\n\n' +
      `👤 Nombre: ${datos.nombre}\n` +
      `🪪 Cédula: ${datos.cedula}\n` +
      `📍 Ubicación: ${datos.ubicacion}\n` +
      `📝 Descripción: ${datos.descripcion}\n` +
      `🏢 Dependencia sugerida: ${datos.dependencia}\n\n` +
      '¿Confirmas el envío de esta denuncia?\n\n' +
      'Responde *SÍ* para confirmar o *NO* para cancelar.'
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
      return 'Por favor responde *SÍ* para confirmar el envío o *NO* para cancelar.';
    }

    if (esNegativo) {
      await this.conversacion.clearEstado(numero);
      return (
        'Tu denuncia ha sido cancelada. Si deseas iniciar una nueva, escribe *hola* en cualquier momento.'
      );
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

      return (
        `✅ *Tu denuncia ha sido radicada exitosamente.*\n\n` +
        `📋 Número de radicado: *${radicado}*\n\n` +
        'El equipo del Concejal Andrés Tobón dará seguimiento a tu caso. ' +
        'Te notificaremos cuando haya una respuesta.\n\n' +
        '_Gracias por contribuir a una mejor Medellín._ 🏙️'
      );
    } catch (err) {
      console.error('Error creando denuncia:', err);
      return (
        'Hubo un error al registrar tu denuncia. Por favor intenta de nuevo en unos minutos ' +
        'o comunícate directamente con el despacho.'
      );
    }
  }

  private async clasificarDenuncia(
    descripcion: string,
  ): Promise<{ esEspecial: boolean; dependencia: string }> {
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente que clasifica denuncias ciudadanas del Concejo de Medellín. ' +
            'Una denuncia es "especial" si involucra corrupción, derechos humanos, amenazas o violencia. ' +
            'Sugiere la dependencia municipal más adecuada para tramitarla. ' +
            'Responde SOLO con JSON válido: { "esEspecial": boolean, "dependencia": string }',
        },
        {
          role: 'user',
          content: `Clasifica esta denuncia ciudadana:\n\n"${descripcion}"`,
        },
      ],
      max_tokens: 100,
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content ?? '{}';
    // Extraer el JSON de la respuesta
    const match = content.match(/\{[^}]+\}/);
    if (!match) return { esEspecial: false, dependencia: 'Sin asignar' };

    const parsed = JSON.parse(match[0]) as {
      esEspecial?: boolean;
      dependencia?: string;
    };
    return {
      esEspecial: parsed.esEspecial ?? false,
      dependencia: parsed.dependencia ?? 'Sin asignar',
    };
  }
}
