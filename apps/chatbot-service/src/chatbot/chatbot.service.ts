import { Injectable } from '@nestjs/common';
import { GeminiService } from '@app/ai';
import {
  ConversacionService,
  DatosConversacion,
  EstadoConversacion,
  PasoConversacion,
} from './conversacion.service';
import { DashboardApiService } from './dashboard-api.service';

const SALUDOS = ['hola', 'buenas', 'buenos días', 'buenos dias', 'hey', 'hi', 'start', 'iniciar', 'inicio', 'comenzar'];

@Injectable()
export class ChatbotService {
  constructor(
    private readonly conversacion: ConversacionService,
    private readonly dashboardApi: DashboardApiService,
    private readonly gemini: GeminiService,
  ) {}

  async procesarMensaje(
    numero: string,
    mensaje: string,
    tipo = 'conversation',
    mediaUrl?: string,
  ): Promise<string> {
    let estado = await this.conversacion.getEstado(numero);

    // Estado nulo, FINALIZADO o corrupto → reiniciar desde INICIO
    const pasosValidos = Object.values(PasoConversacion) as string[];
    if (!estado || estado.paso === PasoConversacion.FINALIZADO || !pasosValidos.includes(estado.paso)) {
      estado = {
        paso: PasoConversacion.INICIO,
        datos: { telefono: numero },
      };
    }

    const respuesta = await this.manejarPaso(estado, mensaje, numero, tipo, mediaUrl);

    // Guardar parcial si tenemos nombre y la conversación está en progreso
    if (
      estado.datos.nombre &&
      !estado.datos.parcialId &&
      estado.paso !== PasoConversacion.INICIO &&
      estado.paso !== PasoConversacion.FINALIZADO
    ) {
      await this.guardarParcial(estado, numero);
    }

    // Simular delay de escritura humana
    const delay = Math.min(1500 + mensaje.length * 30, 8000);
    await new Promise((r) => setTimeout(r, delay));

    return respuesta;
  }

  private async manejarPaso(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
    tipo: string,
    mediaUrl?: string,
  ): Promise<string> {
    switch (estado.paso) {
      case PasoConversacion.INICIO:
        return this.iniciarConversacion(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_NOMBRE:
        return this.recibirNombre(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_CEDULA:
        return this.recibirCedula(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_UBICACION:
        return this.recibirUbicacion(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_DESCRIPCION:
        return this.recibirDescripcion(estado, mensaje, numero);

      case PasoConversacion.ESPERANDO_EVIDENCIA:
        return this.manejarEvidencia(estado, mensaje, numero, tipo, mediaUrl);

      case PasoConversacion.ESPERANDO_CONFIRMACION:
        return this.recibirConfirmacion(estado, mensaje, numero);

      default:
        // Estado corrupto — reiniciar
        estado.paso = PasoConversacion.INICIO;
        estado.datos = { telefono: numero };
        return this.iniciarConversacion(estado, mensaje, numero);
    }
  }

  private async iniciarConversacion(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const mensajeNorm = mensaje.trim().toLowerCase();
    const esSaludo = SALUDOS.some((s) => mensajeNorm.startsWith(s));

    // Si no es saludo, mostrar bienvenida de todas formas (estado corrupto o primer mensaje)
    // No guardar el mensaje como nombre
    estado.paso = PasoConversacion.ESPERANDO_NOMBRE;
    await this.conversacion.setEstado(numero, estado);

    return (
      '¡Hola! 👋 Soy el asistente del concejal Andrés Tobón. ' +
      'Estoy aquí para ayudarte a presentar tu denuncia.\n\n' +
      'Todo lo que me cuentes será tratado con total confidencialidad. ' +
      '¿Me puedes decir tu nombre completo para empezar?'
    );
  }

  private async recibirNombre(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
  ): Promise<string> {
    const nombre = mensaje.trim();
    const soloLetras = /^[a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s'.-]+$/.test(nombre);

    if (nombre.length < 3 || !soloLetras) {
      return 'Por favor escribe tu nombre completo (solo letras, mínimo 3 caracteres) 😊';
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
    const cedula = mensaje.replace(/\D/g, '');

    if (cedula.length < 6 || cedula.length > 10) {
      return (
        'Entiendo 😊 Para continuar con tu denuncia necesito tu número de cédula. ' +
        'Debe tener entre 6 y 10 dígitos. ¿Me lo puedes compartir?'
      );
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
      return (
        'Entiendo 😊 Para continuar con tu denuncia necesito la ubicación del problema. ' +
        '¿Me puedes indicar la dirección o el barrio donde ocurrió?'
      );
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
      return (
        'Entiendo 😊 Para continuar con tu denuncia necesito que me cuentes el problema con más detalle ' +
        '(mínimo 10 caracteres). ¿Me puedes dar más información?'
      );
    }

    estado.datos.descripcion = descripcion;

    // Clasificar con Gemini
    try {
      const clasificacion = await this.gemini.clasificarDenuncia(descripcion);
      estado.datos.esEspecial = clasificacion.esEspecial;
      estado.datos.dependencia = clasificacion.dependencia;
    } catch (err) {
      // GeminiService ya maneja internamente el fallback; este catch es por si todo lo demás falla
      console.error('Error inesperado en clasificación:', err);
      estado.datos.esEspecial = false;
      estado.datos.dependencia = 'Secretaría de Gobierno';
    }

    // Pasar a evidencia antes de confirmación
    estado.paso = PasoConversacion.ESPERANDO_EVIDENCIA;
    await this.conversacion.setEstado(numero, estado);

    return (
      '¿Tienes fotos o documentos que respalden tu denuncia? Puedes enviarme:\n' +
      '📸 *Imágenes* — fotos del problema (se incluirán en el documento oficial)\n' +
      '📄 *PDFs* — documentos de soporte (irán como anexos)\n\n' +
      'Si no tienes evidencia en este momento, responde *no* o *continuar* para seguir sin adjuntos.'
    );
  }

  private async manejarEvidencia(
    estado: EstadoConversacion,
    mensaje: string,
    numero: string,
    tipo: string,
    mediaUrl?: string,
  ): Promise<string> {
    const mensajeNorm = mensaje.trim().toLowerCase();
    const palabrasContinuar = ['no', 'continuar', 'listo', 'ya', 'siguiente', 'n', 'skip', 'omitir', 'sin evidencia'];

    if (tipo === 'imageMessage') {
      if (!estado.datos.imagenes) estado.datos.imagenes = [];
      estado.datos.imagenes.push(mediaUrl ?? 'imagen_sin_url');
      await this.conversacion.setEstado(numero, estado);
      return '📸 Imagen recibida. ¿Tienes algo más? Envía otra imagen, un PDF, o responde *continuar*';
    }

    if (tipo === 'documentMessage') {
      if (!estado.datos.pdfs) estado.datos.pdfs = [];
      estado.datos.pdfs.push(mediaUrl ?? 'documento_sin_url');
      await this.conversacion.setEstado(numero, estado);
      return '📄 Documento recibido como anexo. ¿Tienes algo más? Envía otro archivo o responde *continuar*';
    }

    if (palabrasContinuar.some((p) => mensajeNorm.startsWith(p))) {
      estado.paso = PasoConversacion.ESPERANDO_CONFIRMACION;
      await this.conversacion.setEstado(numero, estado);
      return this.generarResumenConfirmacion(estado.datos);
    }

    // Mensaje inesperado en este paso
    return (
      'Entiendo 😊 Para continuar, puedes enviar una *imagen* 📸, un *PDF* 📄, ' +
      'o responder *continuar* para ir al siguiente paso.'
    );
  }

  private generarResumenConfirmacion(datos: DatosConversacion): string {
    const descripcionCorta =
      datos.descripcion && datos.descripcion.length > 100
        ? datos.descripcion.substring(0, 100) + '...'
        : (datos.descripcion ?? '');

    const nImagenes = datos.imagenes?.length ?? 0;
    const nPdfs = datos.pdfs?.length ?? 0;
    const evidenciaTexto =
      nImagenes > 0 || nPdfs > 0
        ? `📎 Evidencia: ${nImagenes} imagen(es) y ${nPdfs} anexo(s) PDF`
        : '📎 Sin evidencia adjunta';

    return (
      'Perfecto, déjame resumirte lo que voy a radicar:\n\n' +
      `👤 Nombre: ${datos.nombre}\n` +
      `🪪 Cédula: ${datos.cedula}\n` +
      `📍 Ubicación: ${datos.ubicacion}\n` +
      `🏛️ Dirigido a: ${datos.dependencia}\n` +
      `📝 Descripción: ${descripcionCorta}\n` +
      `${evidenciaTexto}\n\n` +
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

  private async guardarParcial(estado: EstadoConversacion, numero: string): Promise<void> {
    if (estado.datos.parcialId) return;
    if (!estado.datos.nombre) return;

    try {
      const { id } = await this.dashboardApi.crearIncompleta({
        nombreCiudadano: estado.datos.nombre,
        telefono: numero,
        cedula: estado.datos.cedula,
        ubicacion: estado.datos.ubicacion,
        descripcion: estado.datos.descripcion,
      });
      estado.datos.parcialId = id;
      await this.conversacion.setEstado(numero, estado);
      console.log(`Parcial guardado para ${numero}, id=${id}`);
    } catch (err) {
      console.error('Error guardando parcial:', err);
    }
  }
}
