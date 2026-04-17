import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '@app/ai';
import { ConversacionService, DatosConfirmados, EstadoConversacionIA } from './conversacion.service';
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

// Capitaliza cada palabra del nombre (ej: "juan pérez" → "Juan Pérez")
const capitalizarNombre = (nombre: string): string =>
  nombre.trim().split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');

// Devuelve lista de campos pendientes según datos actuales
const camposPendientes = (d: DatosConfirmados): string[] => [
  !(d.nombre || d.esAnonimo === true) ? 'nombre' : null,
  !(d.esAnonimo === true || d.cedula) ? 'cédula' : null,
  !d.barrio ? 'barrio' : null,
  !d.direccion ? 'dirección exacta' : null,
  !d.direccionConfirmada ? 'confirmar dirección' : null,
  !d.descripcion ? 'descripción del problema' : null,
].filter(Boolean) as string[];

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

      // Pre-llenar datos si el usuario ya tiene denuncias previas
      const usuarioExistente = await this.dashboardApi.buscarUsuarioPorTelefono(numero);
      if (usuarioExistente && !usuarioExistente.esAnonimo) {
        estado.datosConfirmados.nombre = usuarioExistente.nombreCiudadano;
        estado.datosConfirmados.cedula = usuarioExistente.cedula;
      }

      await this.conversacion.setEstado(numero, estado);

      // Si la primera interacción es SOLO un saludo (sin datos adicionales), responder bienvenida
      // Si el usuario incluye su nombre en el saludo ("Hola soy Juan"), dejar pasar a Gemini
      const esSaludo = /^(hola|buenas|buenos|hey|hi|start|iniciar|inicio|comenzar)[!¡\.\s]*$/.test(mensajeNorm);
      if (esSaludo) {
        const msgBienvenida = usuarioExistente && !usuarioExistente.esAnonimo
          ? `¡Hola de nuevo, ${usuarioExistente.nombreCiudadano}! 👋 Soy el asistente del concejal Andrés Tobón.\n\n¿En qué te puedo ayudar hoy?`
          : MSG_BIENVENIDA;
        estado.historial.push({ rol: 'assistant', contenido: msgBienvenida, timestamp: new Date().toISOString() });
        await this.conversacion.setEstado(numero, estado);
        return msgBienvenida;
      }
    }

    this.logger.log(`[${numero}] Procesando mensaje. Datos actuales: ${JSON.stringify(estado.datosConfirmados)}`);

    // Manejo de media (imágenes / documentos PDF)
    let mensajeEfectivo = mensaje.trim();
    if (tipo === 'imageMessage') {
      estado.datosConfirmados.imagenes = [...(estado.datosConfirmados.imagenes ?? []), mediaUrl ?? 'imagen_sin_url'];
      mensajeEfectivo = '[Imagen enviada]';
    } else if (tipo === 'documentMessage') {
      estado.datosConfirmados.pdfs = [...(estado.datosConfirmados.pdfs ?? []), mediaUrl ?? 'documento_sin_url'];
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

    // Detección server-side de confirmación final (no depende del LLM)
    // Cubre casos donde el modelo fallback ignora el contexto en el paso 8
    const esConfirmacion = /^(s[ií]|ok|yes|confirmo|correcto|dale|listo|exacto|as[ií]\s+es|claro|afirmativo|todo\s+bien|1)\b/i.test(mensajeNorm);
    const faltantes = camposPendientes(estado.datosConfirmados);
    const datosCompletos = faltantes.length === 0;
    const ultimaRespuestaAsistente = [...estado.historial].reverse().find((m) => m.rol === 'assistant')?.contenido ?? '';
    const hayResumenPrevio = /resumen|radicad|correcto|¿es\s+correcto/i.test(ultimaRespuestaAsistente);

    if (esConfirmacion && datosCompletos && hayResumenPrevio) {
      this.logger.log(`[${numero}] Confirmación server-side detectada — forzando radicado`);
      estado.historial.push({ rol: 'user', contenido: mensajeEfectivo, timestamp: new Date().toISOString() });
      const respuestaRadicado = await this.radicarDenuncia(estado, numero);
      estado.historial.push({ rol: 'assistant', contenido: respuestaRadicado, timestamp: new Date().toISOString() });
      await this.conversacion.setEstado(numero, estado);
      const delay = Math.min(2000 + respuestaRadicado.length * 40, 8000);
      await new Promise((r) => setTimeout(r, delay));
      return respuestaRadicado;
    }

    // Llamar a Gemini — el historial no incluye el mensaje actual todavía
    const resultado = await this.gemini.procesarMensajeChatbot(
      estado.historial,
      estado.datosConfirmados as unknown as Record<string, unknown>,
      mensajeEfectivo,
    );

    // Deep merge: arrays se concatenan, el resto se sobrescribe
    if (resultado.datosExtraidos && Object.keys(resultado.datosExtraidos).length > 0) {
      const ext = resultado.datosExtraidos as Partial<DatosConfirmados>;
      estado.datosConfirmados = {
        ...estado.datosConfirmados,
        ...ext,
        // Arrays: concatenar y deduplicar por URL
        imagenes: [...new Set([...(estado.datosConfirmados.imagenes ?? []), ...((ext.imagenes as string[] | undefined) ?? [])])],
        pdfs: [...new Set([...(estado.datosConfirmados.pdfs ?? []), ...((ext.pdfs as string[] | undefined) ?? [])])],
      };
      this.logger.log(`[${numero}] Datos tras merge: ${JSON.stringify(estado.datosConfirmados)}`);
    }

    // Actualizar etapa — 'finalizado' solo lo setea radicarDenuncia() al confirmar el radicado.
    // Si Gemini devuelve 'finalizado' acá es porque quiere radicar pero aún no hemos creado la denuncia;
    // usamos 'confirmando' como etapa de espera para no provocar un reset en el próximo turno.
    if (resultado.etapaSiguiente === 'finalizado' && !resultado.listaParaRadicar) {
      estado.datosConfirmados.etapa = 'confirmando';
    } else if (resultado.etapaSiguiente !== 'finalizado') {
      estado.datosConfirmados.etapa = resultado.etapaSiguiente;
    }
    // Si listaParaRadicar:true + etapaSiguiente:'finalizado', se radicarà abajo y ahí se setea 'finalizado'

    // Persistir turno completo en el historial
    estado.historial.push(
      { rol: 'user', contenido: mensajeEfectivo, timestamp: new Date().toISOString() },
      { rol: 'assistant', contenido: resultado.respuesta, timestamp: new Date().toISOString() },
    );

    let respuestaFinal = resultado.respuesta;

    // Guardar parcial cuando hay datos nuevos
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

    // Lista para radicar — validar datos completos Y que el usuario haya visto el resumen
    if (resultado.listaParaRadicar && resultado.etapaSiguiente !== 'especial_cerrado') {
      const faltantesAhora = camposPendientes(estado.datosConfirmados);
      if (faltantesAhora.length > 0) {
        this.logger.warn(`[${numero}] listaParaRadicar=true pero faltan: ${faltantesAhora.join(', ')} — continuando recopilación`);
        // No radicar; Gemini seguirá recopilando
      } else if (estado.datosConfirmados.etapa !== 'confirmando') {
        // El usuario todavía no ha visto el resumen: dejar que la respuesta de Gemini se muestre
        // y setear etapa 'confirmando' para que el próximo turno dispare el radicado
        estado.datosConfirmados.etapa = 'confirmando';
        this.logger.log(`[${numero}] listaParaRadicar=true pero sin resumen previo — mostrando resumen, esperando confirmación`);
      } else {
        respuestaFinal = await this.radicarDenuncia(estado, numero);
      }
    }

    await this.conversacion.setEstado(numero, estado);

    // Delay humano: 2s base + 40ms por carácter, máximo 8s
    const delay = Math.min(2000 + respuestaFinal.length * 40, 8000);
    await new Promise((r) => setTimeout(r, delay));

    return respuestaFinal;
  }

  private async radicarDenuncia(estado: EstadoConversacionIA, numero: string): Promise<string> {
    const d = estado.datosConfirmados;

    // BUG 1: esAnonimo es true ÚNICAMENTE si Gemini lo seteó explícitamente
    const esAnonimo = d.esAnonimo === true;
    const nombreFinal = esAnonimo ? 'Anónimo' : capitalizarNombre(d.nombre ?? 'Sin nombre');

    this.logger.log(`[${numero}] Creando denuncia — nombre: "${nombreFinal}", esAnonimo: ${esAnonimo}, datos: ${JSON.stringify(d)}`);

    try {
      // Generar resumen para el dashboard
      const resumen = await this.gemini.generarResumen({
        nombre: nombreFinal,
        barrio: d.barrio,
        direccion: d.direccion,
        descripcion: d.descripcion,
        dependencia: d.dependencia,
      });
      d.descripcionResumen = resumen;

      const cedulaRadicado = esAnonimo ? 'ANONIMO' : (d.cedula?.trim() || undefined);
      // Serializar imágenes de evidencia como JSON para almacenarlas en la entidad
      const imagenesJson = (d.imagenes?.length ?? 0) > 0
        ? JSON.stringify(d.imagenes)
        : undefined;

      const { id, radicado } = await this.dashboardApi.crearDenuncia({
        nombreCiudadano: nombreFinal,
        cedula: cedulaRadicado,
        telefono: d.telefono,
        ubicacion: d.direccion ?? `${d.barrio ?? ''} - ${d.comuna ?? ''}`.trim(),
        descripcion: d.descripcion ?? '',
        dependenciaAsignada: d.dependencia,
        esEspecial: false,
        barrio: d.barrio,
        comuna: d.comuna,
        descripcionResumen: d.descripcionResumen,
        esAnonimo,
        documentoPendiente: true,
        solicitudAdicional: d.solicitudAdicional?.trim() || undefined,
        imagenesEvidencia: imagenesJson,
      });

      d.etapa = 'finalizado';

      // Disparar generación de documento de forma asíncrona (fire-and-forget)
      this.dashboardApi.triggerDocumentacion(id).catch((err: unknown) => {
        this.logger.warn(`[${numero}] No se pudo disparar document-service: ${(err as Error).message}`);
      });

      // Guardar historial de la conversación (BUG 2: Promise.allSettled para no bloquear ni propagar errores)
      Promise.allSettled(
        estado.historial.map((m) =>
          this.dashboardApi.guardarMensaje(id, {
            contenido: m.contenido,
            tipo: 'TEXTO',
            direccion: m.rol === 'user' ? 'ENTRANTE' : 'SALIENTE',
          }),
        ),
      ).then((resultados) => {
        const fallidos = resultados.filter((r) => r.status === 'rejected');
        if (fallidos.length > 0) {
          const primerError = (fallidos[0] as PromiseRejectedResult).reason as { response?: { status: number }; message?: string };
          this.logger.warn(`[${numero}] ${fallidos.length}/${estado.historial.length} mensajes no guardados — ${primerError?.response?.status ?? primerError?.message ?? 'error desconocido'}`);
        } else {
          this.logger.log(`[${numero}] Historial guardado (${estado.historial.length} mensajes)`);
        }
      });

      return (
        '✅ ¡Tu denuncia ha sido radicada exitosamente!\n\n' +
        `Tu número de radicado es: *${radicado}*\n\n` +
        `El equipo del concejal Andrés Tobón gestionará tu caso ante ${d.dependencia ?? 'la entidad competente'}. ` +
        'Cuando tengamos respuesta te notificaremos aquí mismo.\n\n' +
        '¡Gracias por confiar en nosotros! 🤝'
      );
    } catch (err) {
      this.logger.error(`[${numero}] Error radicando denuncia:`, err);
      return (
        'Tuve un problema técnico al registrar tu denuncia 😔 ' +
        'Por favor intenta de nuevo en unos minutos o comunícate directamente con el despacho.'
      );
    }
  }

  private async cerrarCasoEspecial(estado: EstadoConversacionIA, numero: string): Promise<string> {
    const d = estado.datosConfirmados;
    const esAnonimo = d.esAnonimo === true;
    const nombreFinal = esAnonimo ? 'Anónimo' : capitalizarNombre(d.nombre ?? 'Sin nombre');

    // Si la descripción está vacía, usar el último mensaje del usuario del historial
    const ultimoMsgUsuario = [...estado.historial].reverse().find((m) => m.rol === 'user')?.contenido ?? '';
    const descripcionFinal = d.descripcion?.trim() || ultimoMsgUsuario || 'Caso especial confidencial';

    // Si cédula no fue recopilada, usar placeholder que pase la validación (min 6 chars)
    const cedulaFinal = esAnonimo ? 'ANONIMO' : (d.cedula?.length >= 6 ? d.cedula : 'ESPECIAL');

    try {
      await this.dashboardApi.crearDenuncia({
        nombreCiudadano: nombreFinal,
        cedula: cedulaFinal,
        telefono: d.telefono,
        ubicacion: (d.direccion ?? `${d.barrio ?? ''} - ${d.comuna ?? ''}`.trim()) || 'Sin ubicación',
        descripcion: descripcionFinal,
        dependenciaAsignada: d.dependencia ?? 'Secretaría de Seguridad y Convivencia',
        esEspecial: true,
        barrio: d.barrio,
        comuna: d.comuna,
        esAnonimo,
        documentoPendiente: false,
      });

      d.etapa = 'especial_cerrado';
    } catch (err) {
      this.logger.error(`[${numero}] Error creando denuncia especial:`, err);
    }

    return (
      'Gracias por tu confianza al compartir esto con nosotros. 🙏\n\n' +
      'Tu denuncia ha sido registrada de forma confidencial. Por la naturaleza delicada de lo que reportas, ' +
      'una persona de confianza del equipo del concejal se encargará de atenderte directamente.\n\n' +
      'Por favor estate pendiente.'
    );
  }

  private async guardarParcialSiPosible(estado: EstadoConversacionIA, numero: string): Promise<void> {
    const d = estado.datosConfirmados;
    if (!d.nombre || !d.telefono) return;

    try {
      const { id } = await this.dashboardApi.upsertParcial({
        nombreCiudadano: capitalizarNombre(d.nombre),
        telefono: numero,
        cedula: d.esAnonimo === true ? 'ANONIMO' : d.cedula,
        barrio: d.barrio,
        comuna: d.comuna,
        direccion: d.direccion,
        descripcion: d.descripcion,
      });
      estado.parcialId = id;
      this.logger.log(`[${numero}] Parcial guardado/actualizado, id=${id}`);
    } catch (err) {
      this.logger.warn(`[${numero}] Error guardando parcial: ${(err as Error).message}`);
    }
  }
}
