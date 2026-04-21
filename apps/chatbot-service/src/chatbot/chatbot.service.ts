import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, InferenciasService } from '@app/ai';
import { ConversacionService, DatosConfirmados, EstadoConversacionIA } from './conversacion.service';
import { DashboardApiService } from './dashboard-api.service';
import { RagApiService, RagTecnicoError } from './rag-api.service';

const MSG_BIENVENIDA =
  '¡Hola! 👋 Soy el asistente del concejal Andrés Tobón. ' +
  'Estoy aquí para ayudarte a presentar tu denuncia.\n\n' +
  '¿Cuál es el problema que deseas reportar?';

const MSG_REINICIADO =
  '¡Hola de nuevo! 😊 Empecemos desde el principio. ¿Cuál es el problema que deseas reportar?';

const MSG_AUDIO =
  'No puedo procesar mensajes de voz 🎤 Por favor escribe tu mensaje y te ayudo con gusto.';

const MSG_PERDIDO =
  'Parece que hay alguna confusión 😊 ¿Quieres que empecemos de nuevo? Escribe *reiniciar* cuando quieras.';

const MSG_ERROR_TECNICO =
  'En este momento tenemos un error técnico y no podemos procesar tu denuncia. Por favor intenta nuevamente en unos minutos.';

const esCedulaValida = (cedula?: string): boolean => {
  if (!cedula) return false;
  const clean = cedula.trim().toUpperCase();
  if (!clean || clean === 'ANONIMO') return false;
  return clean.length >= 6;
};

const enmascararCedula = (cedula: string): string => {
  const clean = cedula.replace(/\D/g, '');
  if (clean.length <= 4) return clean || '***';
  return `${'*'.repeat(clean.length - 4)}${clean.slice(-4)}`;
};

const esConfirmacionPositiva = (mensajeNorm: string): boolean =>
  /\b(s[ií]|ok|yes|confirmo|confirmar|confirma|de\s+acuerdo|claro|listo|dale|exacto|correcto|as[ií]\s+es|afirmativo|radica|radiques|autoriza|autorizo)\b/i
    .test(mensajeNorm);

const esConfirmacionNegativa = (mensajeNorm: string): boolean =>
  /\b(no|negativo|incorrecto|cambiar|corrige|corregir|no\s+corresponde)\b/i.test(mensajeNorm);

const REGEX_TIPO_VIA = /\b(calle|cl\.?|carrera|cra\.?|kr\.?|avenida|av\.?|diagonal|diag\.?|transversal|tv\.?|autopista|circular)\b/i;

type CampoPrioritario = 'ubicacion' | 'descripcion' | 'nombre' | 'cedula' | 'none';

// Capitaliza cada palabra del nombre (ej: "juan pérez" → "Juan Pérez")
const capitalizarNombre = (nombre: string): string =>
  nombre.trim().split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');

const contarPalabras = (texto: string): number =>
  texto.trim().split(/\s+/).filter(Boolean).length;

const esDireccionValida = (direccion?: string): boolean => {
  if (!direccion) return false;
  return REGEX_TIPO_VIA.test(direccion.trim());
};

const esNombreValido = (nombre?: string): boolean => {
  if (!nombre) return false;
  return nombre.trim().length >= 3;
};

const normalizarCedula = (cedula?: string): string | null => {
  if (!cedula) return null;
  const clean = cedula.replace(/\D/g, '');
  return /^\d{6,10}$/.test(clean) ? clean : null;
};

// Devuelve lista de campos pendientes según datos actuales (en el orden correcto del flujo)
const camposPendientes = (d: DatosConfirmados): string[] => [
  !d.descripcion ? 'descripción del problema' : null,
  !d.barrio ? 'barrio' : null,
  !d.direccion ? 'dirección exacta' : null,
  !d.direccionConfirmada ? 'confirmar dirección' : null,
  !(d.nombre || d.esAnonimo === true) ? 'nombre' : null,
  !(d.esAnonimo === true || d.cedula) ? 'cédula' : null,
].filter(Boolean) as string[];

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly conversacion: ConversacionService,
    private readonly dashboardApi: DashboardApiService,
    private readonly ragApi: RagApiService,
    private readonly inferencias: InferenciasService,
    private readonly gemini: GeminiService,
  ) {}

  private clonarDatosConfirmados(datos: DatosConfirmados): DatosConfirmados {
    return {
      ...datos,
      imagenes: [...(datos.imagenes ?? [])],
      pdfs: [...(datos.pdfs ?? [])],
    };
  }

  private mergeDatosConfirmadosSeguro(
    actual: DatosConfirmados,
    extraidos: Partial<DatosConfirmados>,
  ): DatosConfirmados {
    const merged: DatosConfirmados = {
      ...actual,
      imagenes: [...new Set([...(actual.imagenes ?? [])])],
      pdfs: [...new Set([...(actual.pdfs ?? [])])],
    };

    if (esNombreValido(extraidos.nombre)) {
      merged.nombre = extraidos.nombre!.trim();
    }

    if (typeof extraidos.esAnonimo === 'boolean') {
      merged.esAnonimo = extraidos.esAnonimo;
    }

    if (typeof extraidos.cedula === 'string') {
      const cedula = normalizarCedula(extraidos.cedula);
      if (cedula) {
        merged.cedula = cedula;
      }
    }

    if (typeof extraidos.descripcion === 'string' && contarPalabras(extraidos.descripcion) >= 20) {
      merged.descripcion = extraidos.descripcion.trim();
    }

    if (typeof extraidos.barrio === 'string' && extraidos.barrio.trim()) {
      merged.barrio = extraidos.barrio.trim();
    }

    if (typeof extraidos.comuna === 'string' && extraidos.comuna.trim()) {
      merged.comuna = extraidos.comuna.trim();
    }

    if (typeof extraidos.direccion === 'string' && esDireccionValida(extraidos.direccion)) {
      merged.direccion = extraidos.direccion.trim();
      merged.direccionConfirmada = true;
    }

    if (extraidos.direccionConfirmada === true && merged.direccion) {
      merged.direccionConfirmada = true;
    }

    if (typeof extraidos.solicitudAdicional === 'string' && extraidos.solicitudAdicional.trim()) {
      merged.solicitudAdicional = extraidos.solicitudAdicional.trim();
    }

    if (typeof extraidos.dependencia === 'string' && extraidos.dependencia.trim()) {
      merged.dependencia = extraidos.dependencia.trim();
    }

    if (typeof extraidos.esEspecial === 'boolean') {
      merged.esEspecial = extraidos.esEspecial;
    }

    if (Array.isArray(extraidos.imagenes)) {
      merged.imagenes = [...new Set([
        ...(merged.imagenes ?? []),
        ...extraidos.imagenes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()),
      ])];
    }

    if (Array.isArray(extraidos.pdfs)) {
      merged.pdfs = [...new Set([
        ...(merged.pdfs ?? []),
        ...extraidos.pdfs.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()),
      ])];
    }

    return merged;
  }

  private obtenerPrioridadDinamica(datos: DatosConfirmados): CampoPrioritario {
    const faltaUbicacion = !datos.direccion || !datos.barrio || !datos.direccionConfirmada;
    if (faltaUbicacion) {
      return 'ubicacion';
    }

    if (!datos.descripcion) {
      return 'descripcion';
    }

    if (!(datos.nombre || datos.esAnonimo === true)) {
      return 'nombre';
    }

    if (!(datos.esAnonimo === true || datos.cedula)) {
      return 'cedula';
    }

    return 'none';
  }

  private obtenerNuevosDatosValidos(antes: DatosConfirmados, despues: DatosConfirmados): string[] {
    const cambios: string[] = [];
    const keys: Array<keyof DatosConfirmados> = [
      'descripcion',
      'direccion',
      'barrio',
      'comuna',
      'nombre',
      'cedula',
      'dependencia',
      'solicitudAdicional',
    ];

    for (const key of keys) {
      const prev = (antes[key] ?? '').toString().trim();
      const curr = (despues[key] ?? '').toString().trim();
      if (curr && curr !== prev) {
        cambios.push(key);
      }
    }

    if ((despues.imagenes?.length ?? 0) > (antes.imagenes?.length ?? 0)) {
      cambios.push('imagenes');
    }

    if ((despues.pdfs?.length ?? 0) > (antes.pdfs?.length ?? 0)) {
      cambios.push('pdfs');
    }

    if (despues.esAnonimo === true && antes.esAnonimo !== true) {
      cambios.push('esAnonimo');
    }

    return cambios;
  }

  private esMensajeAclaracion(mensajeNorm: string): boolean {
    return /\?|no\s+entiendo|c[oó]mo|que\s+hago|qu[eé]\s+debo|me\s+ayudas?/i.test(mensajeNorm);
  }

  private usuarioIntentoDatoInvalido(
    prioridad: CampoPrioritario,
    mensajeOriginal: string,
    mensajeNorm: string,
  ): boolean {
    switch (prioridad) {
      case 'ubicacion': {
        const intentoUbicacion = /\d/.test(mensajeNorm) || REGEX_TIPO_VIA.test(mensajeNorm) || /barrio|sector|esquina|cuadra/i.test(mensajeNorm);
        return intentoUbicacion && !esDireccionValida(mensajeOriginal);
      }
      case 'descripcion': {
        const palabras = contarPalabras(mensajeOriginal);
        return palabras > 0 && palabras < 20;
      }
      case 'nombre':
        return /[a-záéíóúñ]/i.test(mensajeNorm) && !esNombreValido(mensajeOriginal);
      case 'cedula': {
        const tieneDigitos = /\d/.test(mensajeNorm);
        return tieneDigitos && !normalizarCedula(mensajeOriginal);
      }
      default:
        return false;
    }
  }

  private construirPreguntaAdaptativa(
    prioridad: CampoPrioritario,
    estancado: boolean,
    intentosFallidos: number,
  ): string {
    const empatico = intentosFallidos >= 2
      ? 'Tranquilo, te ayudo. Vamos paso a paso. '
      : '';
    const refuerzo = estancado ? 'Hagámoslo simple con este formato: ' : '';

    switch (prioridad) {
      case 'ubicacion':
        return `${empatico}${refuerzo}Por ejemplo: Calle 10 #20-30, barrio Laureles. ¿Podrías escribirme tu dirección de forma similar?`;
      case 'descripcion':
        return `${empatico}${refuerzo}Cuéntame qué pasó, dónde ocurrió y desde cuándo, en al menos 20 palabras.`;
      case 'nombre':
        return `${empatico}¿Me compartes tu nombre completo (mínimo 3 caracteres)?`;
      case 'cedula':
        return `${empatico}Escríbeme solo los números de tu cédula (de 6 a 10 dígitos).`;
      default:
        return `${empatico}Gracias, ya casi terminamos. Continúo con el siguiente dato.`;
    }
  }

  async procesarMensaje(
    numero: string,
    mensaje: string,
    tipo = 'conversation',
    mediaUrl?: string,
  ): Promise<string> {
    const mensajeNorm = mensaje.trim().toLowerCase();

    // Comando reiniciar o cancelar — manejo prioritario
    if (mensajeNorm === 'reiniciar' || /^cancelar\b/i.test(mensajeNorm)) {
      const estadoExistente = await this.conversacion.getEstado(numero);
      if (estadoExistente?.parcialId) {
        await this.dashboardApi.eliminarDenuncia(estadoExistente.parcialId).catch(() => {});
      }
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
      if (usuarioExistente && !usuarioExistente.esAnonimo && esCedulaValida(usuarioExistente.cedula)) {
        estado.datosConfirmados.nombre = usuarioExistente.nombreCiudadano;
        estado.datosConfirmados.cedula = usuarioExistente.cedula;
        estado.datosConfirmados.identidadPendienteConfirmacion = true;
        estado.datosConfirmados.identidadReutilizada = true;
      }

      await this.conversacion.setEstado(numero, estado);

      // Si la primera interacción es SOLO un saludo (sin datos adicionales), responder bienvenida
      // Si el usuario incluye su nombre en el saludo ("Hola soy Juan"), dejar pasar a Gemini
      const esSaludo = /^(hola|buenas|buenos|hey|hi|start|iniciar|inicio|comenzar)[!¡\.\s]*$/.test(mensajeNorm);
      if (esSaludo) {
        const msgBienvenida = usuarioExistente && !usuarioExistente.esAnonimo && esCedulaValida(usuarioExistente.cedula)
          ? `¡Hola de nuevo, ${usuarioExistente.nombreCiudadano}! 👋 Tengo registrada la cédula terminada en ${enmascararCedula(usuarioExistente.cedula)}. ¿Usamos los mismos datos? Responde *sí* o *no* y luego cuéntame tu denuncia.`
          : MSG_BIENVENIDA;
        estado.historial.push({ rol: 'assistant', contenido: msgBienvenida, timestamp: new Date().toISOString() });
        await this.conversacion.setEstado(numero, estado);
        return msgBienvenida;
      }
    }

    if (estado.datosConfirmados.identidadPendienteConfirmacion && tipo === 'conversation') {
      const confirmacionPositiva = esConfirmacionPositiva(mensajeNorm);
      const confirmacionNegativa = esConfirmacionNegativa(mensajeNorm);

      if (confirmacionPositiva) {
        estado.datosConfirmados.identidadPendienteConfirmacion = false;
      } else if (confirmacionNegativa) {
        estado.datosConfirmados.identidadPendienteConfirmacion = false;
        estado.datosConfirmados.identidadReutilizada = false;
        estado.datosConfirmados.nombre = undefined;
        estado.datosConfirmados.cedula = undefined;
        await this.conversacion.setEstado(numero, estado);
        return 'Perfecto, gracias por confirmarlo. ¿Me compartes tu nombre completo y cédula para actualizar tus datos?';
      } else {
        await this.conversacion.setEstado(numero, estado);
        return `Antes de seguir: tengo registrado el nombre ${estado.datosConfirmados.nombre} y cédula terminada en ${enmascararCedula(estado.datosConfirmados.cedula ?? '')}. ¿Siguen correctos? Responde *sí* o *no*.`;
      }
    }

    estado.turnosSinNuevosDatos = estado.turnosSinNuevosDatos ?? 0;

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
    let incrementoPorRepeticion = false;
    if (estado.ultimoMensaje === mensajeEfectivo && tipo === 'conversation') {
      estado.contadorRepeticiones = (estado.contadorRepeticiones ?? 0) + 1;
      if ((estado.contadorRepeticiones ?? 0) >= 2) {
        estado.intentosFallidos = (estado.intentosFallidos ?? 0) + 1;
        incrementoPorRepeticion = true;
      }
    } else {
      estado.contadorRepeticiones = 0;
      estado.ultimoMensaje = mensajeEfectivo;
    }

    if ((estado.intentosFallidos ?? 0) >= 5) {
      await this.conversacion.setEstado(numero, estado);
      return MSG_PERDIDO;
    }

    // Detección server-side de confirmación final (no depende del LLM)
    // Cubre casos donde el modelo fallback ignora el contexto en el paso 8
    const esConfirmacion = esConfirmacionPositiva(mensajeNorm);
    const faltantes = camposPendientes(estado.datosConfirmados);
    const datosCompletos = faltantes.length === 0;
    const ultimaRespuestaAsistente = [...estado.historial].reverse().find((m) => m.rol === 'assistant')?.contenido ?? '';
    const hayResumenPrevio = /resumen|radicad|radicar|confirm(a|o|ar)|autoriz|¿es\s+correcto/i.test(ultimaRespuestaAsistente);

    if (esConfirmacion && datosCompletos && (hayResumenPrevio || estado.datosConfirmados.etapa === 'confirmando')) {
      this.logger.log(`[${numero}] Confirmación server-side detectada — forzando radicado`);
      estado.historial.push({ rol: 'user', contenido: mensajeEfectivo, timestamp: new Date().toISOString() });
      const respuestaRadicado = await this.radicarDenuncia(estado, numero);
      estado.historial.push({ rol: 'assistant', contenido: respuestaRadicado, timestamp: new Date().toISOString() });
      await this.conversacion.setEstado(numero, estado);
      const delay = Math.min(2000 + respuestaRadicado.length * 40, 8000);
      await new Promise((r) => setTimeout(r, delay));
      return respuestaRadicado;
    }

    const datosAntesTurno = this.clonarDatosConfirmados(estado.datosConfirmados);
    const prioridadAntesTurno = this.obtenerPrioridadDinamica(datosAntesTurno);

    // Motor determinista previo a IA: orienta dependencia antes del turno con Gemini.
    this.aplicarInferenciaPreviaIA(estado, mensajeEfectivo, numero);

    // Llamar a Gemini — el historial no incluye el mensaje actual todavía
    const resultado = await this.gemini.procesarMensajeChatbot(
      estado.historial,
      estado.datosConfirmados as unknown as Record<string, unknown>,
      mensajeEfectivo,
    );

    // Deep merge: arrays se concatenan, el resto se sobrescribe
    if (resultado.datosExtraidos && Object.keys(resultado.datosExtraidos).length > 0) {
      const ext = resultado.datosExtraidos as Partial<DatosConfirmados> & { nombreCompleto?: string };
      // Normalizar variantes de nombre que Gemini puede devolver inconsistentemente
      if (!ext.nombre && ext.nombreCompleto) {
        ext.nombre = ext.nombreCompleto;
        delete ext.nombreCompleto;
      }
      estado.datosConfirmados = this.mergeDatosConfirmadosSeguro(estado.datosConfirmados, ext);
      this.logger.log(`[${numero}] Datos tras merge: ${JSON.stringify(estado.datosConfirmados)}`);
    }

    // Clasificación semántica centralizada en rag-service (reemplaza clasificación directa en Gemini).
    try {
      await this.actualizarClasificacionConRag(estado, numero, mensajeEfectivo, resultado);
    } catch (err) {
      if (err instanceof RagTecnicoError) {
        this.logger.warn(`[${numero}] RAG no disponible por créditos/cuota. Se responde error técnico al ciudadano.`);
        return this.responderErrorTecnico(estado, numero, mensajeEfectivo);
      }

      this.logger.error(`[${numero}] Error inesperado en clasificación RAG: ${(err as Error).message}`);
      return this.responderErrorTecnico(estado, numero, mensajeEfectivo);
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

    const nuevosDatosValidos = this.obtenerNuevosDatosValidos(datosAntesTurno, estado.datosConfirmados);
    const hayDatosNuevos = nuevosDatosValidos.length > 0;

    if (hayDatosNuevos) {
      estado.turnosSinNuevosDatos = 0;
      estado.intentosFallidos = Math.max((estado.intentosFallidos ?? 0) - 1, 0);
    } else if (tipo === 'conversation') {
      estado.turnosSinNuevosDatos = (estado.turnosSinNuevosDatos ?? 0) + 1;
    }

    const puedeEvaluarFallo =
      tipo === 'conversation' &&
      resultado.etapaSiguiente !== 'especial_cerrado' &&
      resultado.etapaSiguiente !== 'cancelado' &&
      !resultado.listaParaRadicar;

    if (puedeEvaluarFallo && !hayDatosNuevos) {
      const intentoInvalido = this.usuarioIntentoDatoInvalido(prioridadAntesTurno, mensajeEfectivo, mensajeNorm);
      const noRespondioLoPedido =
        prioridadAntesTurno !== 'none' &&
        !intentoInvalido &&
        !this.esMensajeAclaracion(mensajeNorm) &&
        !esConfirmacion &&
        !esConfirmacionNegativa(mensajeNorm);

      if ((intentoInvalido || noRespondioLoPedido) && !incrementoPorRepeticion) {
        estado.intentosFallidos = (estado.intentosFallidos ?? 0) + 1;
      }
    }

    // Persistir turno completo en el historial
    estado.historial.push(
      { rol: 'user', contenido: mensajeEfectivo, timestamp: new Date().toISOString() },
      { rol: 'assistant', contenido: resultado.respuesta, timestamp: new Date().toISOString() },
    );

    let respuestaFinal = resultado.respuesta;

    // Guardar parcial cuando hay datos nuevos
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

    // Caso cancelación detectado por Gemini
    if (resultado.etapaSiguiente === 'cancelado') {
      if (estado?.parcialId) {
        await this.dashboardApi.eliminarDenuncia(estado.parcialId).catch(() => {});
      }
      await this.conversacion.clearEstado(numero);
      return resultado.respuesta || 'Proceso cancelado. Aquí estaremos si decides denunciar más adelante. ¡Gracias por contactarnos!';
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

    if (
      !resultado.listaParaRadicar &&
      esConfirmacion &&
      camposPendientes(estado.datosConfirmados).length === 0 &&
      estado.datosConfirmados.etapa === 'confirmando' &&
      resultado.etapaSiguiente !== 'especial_cerrado'
    ) {
      this.logger.log(`[${numero}] Confirmación textual detectada pese a salida LLM inconsistente — forzando radicado`);
      respuestaFinal = await this.radicarDenuncia(estado, numero);
    }

    if (
      /problema t[eé]cnico|me repites tu mensaje/i.test(respuestaFinal) &&
      camposPendientes(estado.datosConfirmados).length === 0 &&
      estado.datosConfirmados.etapa === 'confirmando'
    ) {
      respuestaFinal = 'Solo para confirmar: ¿autorizas radicar la denuncia con los datos ya validados?';
    }

    const prioridadDespuesTurno = this.obtenerPrioridadDinamica(estado.datosConfirmados);
    const estancado = (estado.turnosSinNuevosDatos ?? 0) >= 3;
    const necesitaAdaptacion =
      prioridadDespuesTurno !== 'none' &&
      !hayDatosNuevos &&
      resultado.etapaSiguiente !== 'especial_cerrado' &&
      resultado.etapaSiguiente !== 'cancelado' &&
      !resultado.listaParaRadicar &&
      ((estado.intentosFallidos ?? 0) >= 2 || estancado);

    if (necesitaAdaptacion) {
      respuestaFinal = this.construirPreguntaAdaptativa(
        prioridadDespuesTurno,
        estancado,
        estado.intentosFallidos ?? 0,
      );
    }

    await this.conversacion.setEstado(numero, estado);

    // Delay humano: 2s base + 40ms por carácter, máximo 8s
    const delay = Math.min(2000 + respuestaFinal.length * 40, 8000);
    await new Promise((r) => setTimeout(r, delay));

    return respuestaFinal;
  }

  private async responderErrorTecnico(
    estado: EstadoConversacionIA,
    numero: string,
    mensajeEfectivo: string,
  ): Promise<string> {
    const timestamp = new Date().toISOString();
    estado.historial.push(
      { rol: 'user', contenido: mensajeEfectivo, timestamp },
      { rol: 'assistant', contenido: MSG_ERROR_TECNICO, timestamp: new Date().toISOString() },
    );
    await this.conversacion.setEstado(numero, estado);
    return MSG_ERROR_TECNICO;
  }

  private async actualizarClasificacionConRag(
    estado: EstadoConversacionIA,
    numero: string,
    mensajeEfectivo: string,
    resultado: {
      etapaSiguiente: 'recopilando' | 'esperando_solicitud' | 'confirmando' | 'finalizado' | 'especial_cerrado' | 'cancelado';
    },
  ): Promise<void> {
    const d = estado.datosConfirmados;
    const descripcion = d.descripcion?.trim();
    const textoAnalisis = [descripcion, mensajeEfectivo].filter(Boolean).join(' ').trim();
    if (!textoAnalisis) return;

    // Evita recalcular embeddings en cada turno cuando la descripción no cambió.
    if (d.clasificacionRagTexto === textoAnalisis) {
      return;
    }

    const ubicacion = [d.direccion, d.barrio, d.comuna].filter(Boolean).join(', ') || undefined;
    const clasificacion = await this.ragApi.clasificar(textoAnalisis, ubicacion);
    if (!clasificacion || !Array.isArray(clasificacion.dependencias) || clasificacion.dependencias.length === 0) {
      return;
    }

    const inferencia = this.inferencias.resolverCaso(textoAnalisis, {
      ragResultado: clasificacion,
      dependenciaActual: d.dependencia,
      descripcionActual: descripcion,
    });

    d.dependencia = inferencia.dependenciaSecundaria
      ? `${inferencia.dependenciaPrincipal}, ${inferencia.dependenciaSecundaria}`
      : inferencia.dependenciaPrincipal;
    d.esEspecial = clasificacion.esEspecial;
    d.clasificacionRagTexto = textoAnalisis;

    if (clasificacion.esEspecial && resultado.etapaSiguiente !== 'especial_cerrado') {
      resultado.etapaSiguiente = 'especial_cerrado';
      this.logger.log(`[${numero}] Clasificación RAG marcó caso especial con mensaje: "${mensajeEfectivo}"`);
    }

    this.logger.log(
      `[${numero}] Clasificación RAG/inferencia aplicada: dependencia="${d.dependencia}", tipoCaso=${inferencia.tipoCaso}, requiereConfirmacion=${inferencia.requiereConfirmacion}, especial=${d.esEspecial}`,
    );
  }

  private aplicarInferenciaPreviaIA(
    estado: EstadoConversacionIA,
    mensajeEfectivo: string,
    numero: string,
  ): void {
    const d = estado.datosConfirmados;
    const textoAnalisis = [d.descripcion, mensajeEfectivo].filter(Boolean).join(' ').trim();
    if (!textoAnalisis) return;

    const inferencia = this.inferencias.resolverCaso(textoAnalisis, {
      dependenciaActual: d.dependencia,
      descripcionActual: d.descripcion,
    });

    if (inferencia.tipoCaso === 'nulo') {
      return;
    }

    d.dependencia = inferencia.dependenciaSecundaria
      ? `${inferencia.dependenciaPrincipal}, ${inferencia.dependenciaSecundaria}`
      : inferencia.dependenciaPrincipal;

    this.logger.debug(
      `[${numero}] Inferencia previa IA: dependencia="${d.dependencia}", tipoCaso=${inferencia.tipoCaso}, requiereConfirmacion=${inferencia.requiereConfirmacion}`,
    );
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

      // Filtrar solicitud adicional por IA antes de guardarla en el oficio oficial
      const solicitudFiltrada = await this.filtrarSolicitudAdicional(d.solicitudAdicional, numero);

      // Usar el parcialId guardado en estado Redis primero; si no existe, buscar por teléfono.
      // Esto evita duplicados incluso cuando el teléfono resuelto de @lid varía entre mensajes.
      let parcial: { id: number; incompleta: boolean; radicado?: string } | null = null;
      if (estado.parcialId) {
        parcial = { id: estado.parcialId, incompleta: true };
      } else {
        parcial = await this.dashboardApi.buscarParcialPorTelefono(d.telefono);
      }

      let id: number;
      let radicado: string;
      if (parcial && parcial.incompleta) {
        this.logger.log(`[${numero}] Completando denuncia parcial existente #${parcial.id} (${parcial.radicado})`);
        ({ id, radicado } = await this.dashboardApi.completarDenuncia(parcial.id, {
          nombreCiudadano: nombreFinal,
          cedula: cedulaRadicado,
          ubicacion: d.direccion ?? `${d.barrio ?? ''} - ${d.comuna ?? ''}`.trim(),
          descripcion: d.descripcion ?? '',
          dependenciaAsignada: d.dependencia,
          barrio: d.barrio,
          comuna: d.comuna,
          descripcionResumen: d.descripcionResumen,
          esAnonimo,
          documentoPendiente: true,
          solicitudAdicional: solicitudFiltrada,
          imagenesEvidencia: imagenesJson,
        }));
      } else {
        ({ id, radicado } = await this.dashboardApi.crearDenuncia({
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
          solicitudAdicional: solicitudFiltrada,
          imagenesEvidencia: imagenesJson,
        }));
      }

      d.etapa = 'finalizado';

      // Disparar generación de documento de forma asíncrona (fire-and-forget)
      this.dashboardApi.triggerDocumentacion(id).catch((err: unknown) => {
        this.logger.warn(`[${numero}] No se pudo disparar document-service: ${(err as Error).message}`);
      });

      // Guardar historial de la conversación (fire-and-forget, no bloquea el flujo)
      this.logger.log(`[${numero}] Guardando historial: ${estado.historial.length} mensajes para denuncia ID=${id}`);
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
          const primerError = (fallidos[0] as PromiseRejectedResult).reason as { response?: { status: number; data?: unknown }; message?: string };
          this.logger.warn(
            `[${numero}] ${fallidos.length}/${estado.historial.length} mensajes no guardados — status=${primerError?.response?.status ?? '?'} msg=${primerError?.message ?? 'desconocido'}`,
          );
          this.logger.warn(`[${numero}] Respuesta error: ${JSON.stringify(primerError?.response?.data ?? {})}`);
        } else {
          this.logger.log(`[${numero}] Historial guardado correctamente (${estado.historial.length} mensajes)`);
        }
      });

      return (
        '✅ Su denuncia ha sido radicada exitosamente.\n\n' +
        `📋 Número de radicado: *${radicado}*\n\n` +
        `Su caso será gestionado ante ${d.dependencia ?? 'la entidad competente'}. ` +
        'Cuando tengamos respuesta de la administración, le notificaremos directamente por este medio.\n\n' +
        'Gracias por utilizar el canal oficial del concejal Andrés Felipe Tobón Villada. 🤝'
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

  /**
   * Filtra la solicitud adicional del ciudadano con Gemini.
   * Devuelve la versión formal si es apropiada para un oficio oficial, o undefined si no.
   * Si falla el filtro por error técnico, conserva el texto original como best-effort.
   */
  private async filtrarSolicitudAdicional(
    solicitud: string | undefined,
    numero: string,
  ): Promise<string | undefined> {
    const texto = solicitud?.trim();
    if (!texto) return undefined;

    try {
      const resultado = await this.gemini.filtrarSolicitudAdicional(texto);
      if (!resultado.incluir) {
        this.logger.log(`[${numero}] Solicitud adicional descartada por filtro IA: "${texto.substring(0, 60)}"`);
        return undefined;
      }
      return resultado.solicitudFormateada ?? texto;
    } catch (err) {
      this.logger.warn(`[${numero}] Filtro IA falló, se conserva solicitud original: ${(err as Error).message}`);
      return texto;
    }
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
