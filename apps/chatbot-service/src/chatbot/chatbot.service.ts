import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '@app/ai';
import { ConversacionService, EstadoConversacionIA } from './conversacion.service';
import { DashboardApiService } from './dashboard-api.service';

const MSG_BIENVENIDA =
  '¡Hola! 👋 Soy el asistente del concejal Andrés Tobón. ' +
  'Estoy aquí para ayudarte a presentar tu denuncia.\n\n' +
  '¿Me puedes decir tu nombre completo para empezar?';

const MSG_REINICIADO =
  '¡Hola de nuevo! 😊 Empecemos desde el principio. ¿Cuál es tu nombre completo?';

const MSG_AUDIO =
  'No puedo procesar mensajes de voz 🎤 Por favor escribe tu mensaje y te ayudo con gusto.';

const MSG_PERDIDO =
  'Parece que hay alguna confusión 😊 ¿Quieres que empecemos de nuevo? Escribe *reiniciar* cuando quieras.';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

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
    const mensajeNorm = mensaje.trim().toLowerCase();

    // Comando reiniciar — manejo prioritario
    if (mensajeNorm === 'reiniciar') {
      await this.conversacion.clearEstado(numero);
      return MSG_REINICIADO;
    }

    // Audio — no tenemos bytes para transcribir, pedir que escriba
    if (tipo === 'audioMessage') {
      return MSG_AUDIO;
    }

    let estado = await this.conversacion.getEstado(numero);

    // Sin estado, formato antiguo (FSM) o flujo terminado → nuevo estado
    if (!estado || !estado.datosConfirmados || ['finalizado', 'especial_cerrado'].includes(estado.datosConfirmados.etapa)) {
      estado = this.conversacion.crearEstadoNuevo(numero);

      // Buscar si el usuario ya tiene denuncias previas para pre-llenar sus datos
      const usuarioExistente = await this.dashboardApi.buscarUsuarioPorTelefono(numero);
      if (usuarioExistente && !usuarioExistente.esAnonimo) {
        estado.datosConfirmados.nombre = usuarioExistente.nombreCiudadano;
        estado.datosConfirmados.cedula = usuarioExistente.cedula;
      }

      await this.conversacion.setEstado(numero, estado);

      // Si la primera interacción es solo un saludo, responder bienvenida
      const esSaludo = /^(hola|buenas|buenos|hey|hi|start|iniciar|inicio|comenzar)/.test(mensajeNorm);
      if (esSaludo) {
        const msgBienvenida = usuarioExistente && !usuarioExistente.esAnonimo
          ? `¡Hola de nuevo, ${usuarioExistente.nombreCiudadano}! 👋 Soy el asistente del concejal Andrés Tobón.\n\n¿En qué te puedo ayudar hoy?`
          : MSG_BIENVENIDA;
        const bienvenida: typeof estado.historial[0] = {
          rol: 'assistant',
          contenido: msgBienvenida,
          timestamp: new Date().toISOString(),
        };
        estado.historial.push(bienvenida);
        await this.conversacion.setEstado(numero, estado);
        return msgBienvenida;
      }
    }

    // Manejo de media (imágenes / documentos PDF)
    let mensajeEfectivo = mensaje.trim();
    if (tipo === 'imageMessage') {
      if (!estado.datosConfirmados.imagenes) estado.datosConfirmados.imagenes = [];
      estado.datosConfirmados.imagenes.push(mediaUrl ?? 'imagen_sin_url');
      mensajeEfectivo = '[Imagen enviada]';
    } else if (tipo === 'documentMessage') {
      if (!estado.datosConfirmados.pdfs) estado.datosConfirmados.pdfs = [];
      estado.datosConfirmados.pdfs.push(mediaUrl ?? 'documento_sin_url');
      mensajeEfectivo = '[Documento PDF enviado]';
    }

    // Detección de mensajes repetidos para usuarios perdidos
    if (estado.ultimoMensaje === mensajeEfectivo && tipo === 'conversation') {
      estado.contadorRepeticiones = (estado.contadorRepeticiones ?? 0) + 1;
      if ((estado.contadorRepeticiones ?? 0) >= 2) {
        estado.intentosFallidos = (estado.intentosFallidos ?? 0) + 1;
      }
    } else {
      estado.contadorRepeticiones = 0;
      estado.ultimoMensaje = mensajeEfectivo;
    }

    if ((estado.intentosFallidos ?? 0) >= 3) {
      await this.conversacion.setEstado(numero, estado);
      return MSG_PERDIDO;
    }

    // Detección server-side de confirmación final (independiente del LLM)
    // Si los datos mínimos están presentes y el usuario confirma, forzar radicado
    const esConfirmacion = /^(s[ií]|ok|yes|confirmo|correcto|dale|listo|exacto|as[ií] es|claro|afirmativo|1)\b/i.test(mensajeNorm);
    const datosMinimos = !!(
      estado.datosConfirmados.nombre &&
      estado.datosConfirmados.descripcion &&
      (estado.datosConfirmados.direccion || estado.datosConfirmados.barrio)
    );
    // El historial debe tener al menos un resumen reciente del asistente (paso 8)
    const ultimaRespuestaAsistente = [...estado.historial].reverse().find((m) => m.rol === 'assistant')?.contenido ?? '';
    const hayResumenPrevio = /resumen|radicad|confirma|correcto/i.test(ultimaRespuestaAsistente);

    if (esConfirmacion && datosMinimos && hayResumenPrevio) {
      // Forzar radicado sin pasar por LLM para este turno
      estado.historial.push(
        { rol: 'user', contenido: mensajeEfectivo, timestamp: new Date().toISOString() },
      );
      const respuestaRadicado = await this.radicarDenuncia(estado, numero);
      estado.historial.push(
        { rol: 'assistant', contenido: respuestaRadicado, timestamp: new Date().toISOString() },
      );
      await this.conversacion.setEstado(numero, estado);
      const delay = Math.min(2000 + respuestaRadicado.length * 40, 8000);
      await new Promise((r) => setTimeout(r, delay));
      return respuestaRadicado;
    }

    // Llamar a Gemini con el historial previo + datos actuales + mensaje del usuario
    // El historial aún no incluye el mensaje actual (se agrega después junto con la respuesta)
    const resultado = await this.gemini.procesarMensajeChatbot(
      estado.historial,
      estado.datosConfirmados as unknown as Record<string, unknown>,
      mensajeEfectivo,
    );

    // Mergear datos extraídos por Gemini
    if (resultado.datosExtraidos && Object.keys(resultado.datosExtraidos).length > 0) {
      Object.assign(estado.datosConfirmados, resultado.datosExtraidos);
    }

    // Actualizar etapa
    estado.datosConfirmados.etapa = resultado.etapaSiguiente;

    // Persistir turno completo en el historial
    estado.historial.push(
      { rol: 'user', contenido: mensajeEfectivo, timestamp: new Date().toISOString() },
      { rol: 'assistant', contenido: resultado.respuesta, timestamp: new Date().toISOString() },
    );

    let respuestaFinal = resultado.respuesta;

    // Guardar parcial solo cuando Gemini extrajo datos nuevos con nombre disponible
    const hayDatosNuevos = Object.keys(resultado.datosExtraidos ?? {}).length > 0;
    if (
      estado.datosConfirmados.nombre &&
      hayDatosNuevos &&
      !resultado.listaParaRadicar &&
      resultado.etapaSiguiente !== 'especial_cerrado'
    ) {
      await this.guardarParcialSiPosible(estado, numero);
    }

    // Caso especial detectado por Gemini
    if (resultado.etapaSiguiente === 'especial_cerrado') {
      respuestaFinal = await this.cerrarCasoEspecial(estado, numero);
    }

    // Lista para radicar — crear denuncia completa
    if (resultado.listaParaRadicar && resultado.etapaSiguiente !== 'especial_cerrado') {
      respuestaFinal = await this.radicarDenuncia(estado, numero);
    }

    await this.conversacion.setEstado(numero, estado);

    // Delay humano: 2s base + 40ms por carácter, máximo 8s
    const delay = Math.min(2000 + respuestaFinal.length * 40, 8000);
    await new Promise((r) => setTimeout(r, delay));

    return respuestaFinal;
  }

  private async radicarDenuncia(estado: EstadoConversacionIA, numero: string): Promise<string> {
    const d = estado.datosConfirmados;

    try {
      // Generar resumen para el dashboard
      const resumen = await this.gemini.generarResumen({
        nombre: d.nombre,
        barrio: d.barrio,
        direccion: d.direccion,
        descripcion: d.descripcion,
        dependencia: d.dependencia,
      });
      d.descripcionResumen = resumen;

      const { id, radicado } = await this.dashboardApi.crearDenuncia({
        nombreCiudadano: d.nombre ?? 'Anónimo',
        cedula: d.esAnonimo ? 'ANONIMO' : (d.cedula ?? ''),
        telefono: d.telefono,
        ubicacion: d.direccion ?? `${d.barrio ?? ''} - ${d.comuna ?? ''}`.trim(),
        descripcion: d.descripcion ?? '',
        dependenciaAsignada: d.dependencia,
        esEspecial: false,
        barrio: d.barrio,
        comuna: d.comuna,
        descripcionResumen: d.descripcionResumen,
        esAnonimo: d.esAnonimo ?? false,
        documentoPendiente: true,
      });

      d.etapa = 'finalizado';

      // Guardar conversación en tabla mensajes (async, no bloquea la respuesta)
      this.guardarHistorialComoMensajes(id, estado.historial).catch((e) =>
        this.logger.warn(`No se pudo guardar historial: ${(e as Error).message}`),
      );

      return (
        '✅ ¡Tu denuncia ha sido radicada exitosamente!\n\n' +
        `Tu número de radicado es: *${radicado}*\n\n` +
        `El equipo del concejal Andrés Tobón gestionará tu caso ante ${d.dependencia ?? 'la entidad competente'}. ` +
        'Cuando tengamos respuesta te notificaremos aquí mismo.\n\n' +
        '¡Gracias por confiar en nosotros! 🤝'
      );
    } catch (err) {
      this.logger.error(`Error radicando denuncia para ${numero}:`, err);
      return (
        'Tuve un problema técnico al registrar tu denuncia 😔 ' +
        'Por favor intenta de nuevo en unos minutos o comunícate directamente con el despacho.'
      );
    }
  }

  private async cerrarCasoEspecial(estado: EstadoConversacionIA, numero: string): Promise<string> {
    const d = estado.datosConfirmados;

    try {
      await this.dashboardApi.crearDenuncia({
        nombreCiudadano: d.nombre ?? 'Anónimo',
        cedula: d.esAnonimo ? 'ANONIMO' : (d.cedula ?? ''),
        telefono: d.telefono,
        ubicacion: d.direccion ?? `${d.barrio ?? ''} - ${d.comuna ?? ''}`.trim(),
        descripcion: d.descripcion ?? '',
        dependenciaAsignada: d.dependencia ?? 'Secretaría de Seguridad y Convivencia',
        esEspecial: true,
        barrio: d.barrio,
        comuna: d.comuna,
        esAnonimo: d.esAnonimo ?? false,
        documentoPendiente: false,
      });

      d.etapa = 'especial_cerrado';
    } catch (err) {
      this.logger.error(`Error creando denuncia especial para ${numero}:`, err);
    }

    return (
      'Gracias por tu confianza al compartir esto con nosotros. 🙏\n\n' +
      'Tu denuncia ha sido registrada de forma confidencial. Por la naturaleza delicada de lo que reportas, ' +
      'una persona de confianza del equipo del concejal se encargará de atenderte directamente.\n\n' +
      'Por favor estate pendiente.'
    );
  }

  private async guardarHistorialComoMensajes(
    denunciaId: number,
    historial: Array<{ rol: string; contenido: string }>,
  ): Promise<void> {
    for (const m of historial) {
      await this.dashboardApi.guardarMensaje(denunciaId, {
        contenido: m.contenido,
        tipo: 'TEXTO',
        direccion: m.rol === 'user' ? 'ENTRANTE' : 'SALIENTE',
      });
    }
  }

  private async guardarParcialSiPosible(estado: EstadoConversacionIA, numero: string): Promise<void> {
    const d = estado.datosConfirmados;
    if (!d.nombre || !d.telefono) return;

    try {
      const { id } = await this.dashboardApi.upsertParcial({
        nombreCiudadano: d.nombre,
        telefono: numero,
        cedula: d.esAnonimo ? 'ANONIMO' : d.cedula,
        barrio: d.barrio,
        comuna: d.comuna,
        direccion: d.direccion,
        descripcion: d.descripcion,
      });
      estado.parcialId = id;
      this.logger.log(`Parcial guardado/actualizado para ${numero}, id=${id}`);
    } catch (err) {
      this.logger.warn(`Error guardando parcial para ${numero}: ${(err as Error).message}`);
    }
  }
}
