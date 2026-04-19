import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { buildDependenciasKnowledgeBase, type DependenciasKnowledgeBase } from './dependencias-kb';

// ---------------------------------------------------------------------------
// Contexto Medellín — usado para clasificación de denuncias
// ---------------------------------------------------------------------------
const CONTEXTO_MEDELLIN = `Estructura Medellín 2026 para clasificar denuncias:

JERARQUÍA DE DECISIÓN:
1. Delito/orden público → Secretaría de Seguridad y Convivencia
2. Queja sobre servidor público/trámite → Secretaría de Gestión Humana y Servicio a la Ciudadanía
3. Agua/energía/gas → EPM | Basuras/aseo → Emvarias
4. Huecos, puentes, obra pública → Secretaría de Infraestructura Física
5. Construcción ilegal, espacio público → Secretaría de Gestión y Control Territorial
6. Tránsito, semáforos, transporte → Secretaría de Movilidad
7. Salud, EPS, IPS → Secretaría de Salud | Centros de salud barrio → Metrosalud
8. Colegios, docentes, PAE → Secretaría de Educación
9. Contaminación, bienestar animal, cerros → Secretaría de Medio Ambiente
10. Violencia de género → Secretaría de las Mujeres
11. Población vulnerable, habitante de calle → Secretaría de Inclusión Social, Familia y DDHH
12. Conflicto armado, víctimas, DDHH rurales → Secretaría de Paz y Derechos Humanos
13. Metro/tranvía/cable → Metro de Medellín | Metroplús → Metroplús
14. Vivienda, mejoramiento habitacional → ISVIMED
15. Renovación urbana, obras EDU → EDU
16. Juventud, salud mental joven → Secretaría de la Juventud
17. Cultura, bibliotecas → Secretaría de Cultura Ciudadana
18. Empleo, empresas → Secretaría de Desarrollo Económico
19. Presupuesto participativo, JAC → Secretaría de Participación Ciudadana
20. Emergencias, bomberos → DAGRD
21. Deporte, escenarios → INDER

CASOS ESPECIALES (esEspecial:true): corrupción pública, extorsión, vacunas, grupos armados, sicariato, amenazas a vida.
NUNCA inventes normas. Normativa base: Const. 1991 Art.23, Ley 1437/2011 CPACA, Ley 136/1994.`;

// ---------------------------------------------------------------------------
// System prompt jurídico experto — usado para generarHechos y generarAsunto
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT_LEGAL = `Eres un Asistente Jurídico Colombiano experto al servicio del concejal de Medellín Andrés Felipe Tobón Villada, especializado en:
- Derecho Constitucional Colombiano
- Derecho Administrativo Colombiano
- Derecho Público Colombiano
- Contratación Estatal
- Jurisprudencia de altas cortes colombianas

Tu conocimiento se basa en:
- Constitución Política de Colombia de 1991
- Ley 80 de 1993 (Estatuto de Contratación)
- Ley 1437 de 2011 (CPACA)
- Ley 1474 de 2011 (Estatuto Anticorrupción)
- Ley 136 de 1994 (Municipios)
- Ley 1755 de 2015 (Derecho de Petición)
- Acuerdo 79 de 2003 (Código de Convivencia Medellín)
- Jurisprudencia Corte Constitucional, Consejo de Estado y Corte Suprema de Justicia

REGLAS DE REDACCIÓN DE HECHOS EN OFICIOS:
1. NUNCA menciones el nombre del ciudadano denunciante
2. Redacta como si el concejal conoció la situación directamente en ejercicio de sus funciones
3. Ejemplo INCORRECTO: "El ciudadano Juan reportó..."
4. Ejemplo CORRECTO: "Este despacho ha conocido de una situación que afecta a la comunidad del sector..." o "En ejercicio de las funciones constitucionales de este despacho, se ha podido establecer que..."
5. Identifica el problema jurídico concreto
6. Describe hechos de forma objetiva y cronológica
7. Cita normativa específica y aplicable
8. Fundamenta la competencia de la entidad destinataria
9. Concluye con urgencia o necesidad de intervención

ESTILO:
- Lenguaje técnico-jurídico formal
- Preciso, sin rodeos
- Enfoque práctico de abogado litigante
- NUNCA inventes normas ni jurisprudencia
- Solo artículos que conozcas con certeza
- Sin frases genéricas como "según la ley"

RESTRICCIONES ABSOLUTAS:
- Solo normativa colombiana vigente
- Nunca mencionar nombre del denunciante en el documento
- Si hay ambigüedad normativa, usa el argumento más sólido disponible`;

// ---------------------------------------------------------------------------
// System prompt del chatbot conversacional
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT_CHATBOT = `Eres el asistente de WhatsApp del concejal Andrés Tobón (Medellín). Registras denuncias ciudadanas.

ESTILO: Máximo 1-2 líneas. Una sola pregunta por mensaje. Español colombiano natural.
Si el usuario da varios datos juntos, extráelos TODOS de inmediato. NUNCA pidas un dato que el usuario ya proporcionó claramente.

ORDEN DE RECOPILACIÓN (respeta este orden sin excepción):
1. descripcion — El problema a denunciar (SIEMPRE lo primero)
2. barrio — Barrio donde ocurrió
3. direccion — Dirección exacta (si incluye nomenclatura, marca direccionConfirmada:true y no preguntes de nuevo)
4. imagenes/pdfs — Evidencia. Ofrecerla UNA sola vez, es opcional.
5. solicitudAdicional — (etapaSiguiente:"esperando_solicitud") "¿Quieres agregar algo específico a la solicitud? Responde *no* si está bien 🙏"
6. nombre — Nombre completo (o esAnonimo:true si indica anónimo)
7. cedula — Cédula (6-10 dígitos, solo si no es anónimo)
8. Resumen + confirmación (etapaSiguiente:"confirmando") → si confirma: listaParaRadicar:true, etapaSiguiente:"finalizado"

REGLAS CRÍTICAS:
- NUNCA pidas nombre ni cédula antes de tener descripción y ubicación completas.
- Si la dirección tiene nomenclatura clara, asume direccionConfirmada:true y avanza.
- Un solo dato por mensaje.

CUANDO TENGAS LA DESCRIPCIÓN:
Incluye en datosExtraidos:
- dependencia: nombre EXACTO de la lista oficial (ver DEPENDENCIAS DISPONIBLES en el prompt). SOLO nombres que existan en esa lista. NUNCA inventes entidades.
  INDER para deporte/recreación. Regla: identifica la PRINCIPAL, solo añade secundarias si hay competencias CLARAMENTE diferentes.
- esEspecial: true si menciona corrupción/extorsión/vacunas/grupos armados/sicariato.

CANCELACIÓN: "cancelar", "no quiero denunciar", "olvídalo" → etapaSiguiente:"cancelado".
CASOS ESPECIALES: corrupción/extorsión/vacunas/grupos armados/sicariato → etapaSiguiente:"especial_cerrado".

RESPONDE ÚNICAMENTE CON JSON VÁLIDO (sin texto extra):
{"respuesta":"...","datosExtraidos":{},"etapaSiguiente":"recopilando","listaParaRadicar":false}`;

// Modelos confirmados disponibles con la API key (verificado 2026-04-16)
const MODEL_CHATBOT          = 'gemini-2.5-flash-lite';
const MODEL_CHATBOT_FALLBACK = 'gemini-3.1-flash-lite-preview';
const MODEL_LEGAL            = 'gemini-2.5-flash-lite';

const BASE_CONFIG = { topP: 0.8, topK: 40, maxOutputTokens: 512 };

export interface RespuestaChatbot {
  respuesta: string;
  datosExtraidos: Record<string, unknown>;
  etapaSiguiente: 'recopilando' | 'esperando_solicitud' | 'confirmando' | 'finalizado' | 'especial_cerrado' | 'cancelado';
  listaParaRadicar: boolean;
}

/** Resultado del filtrado de la solicitud adicional del ciudadano */
export interface FiltroSolicitud {
  incluir: boolean;
  solicitudFormateada: string | null;
}

/** Una dependencia dentro de una clasificación estructurada */
export interface DependenciaClasificada {
  nombre: string;
  justificacion: string;
  solicitudEspecifica: string;
}

/** Clasificación estructurada multi-dependencia (mejora IA 1) */
export interface ClasificacionEstructurada {
  esEspecial: boolean;
  dependencias: DependenciaClasificada[];
  asunto: string;
  esPrincipal: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly dependenciasKb: DependenciasKnowledgeBase;

  private readonly modelClasificacion: GenerativeModel;
  private readonly modelJustificacion: GenerativeModel;
  private readonly modelLegal: GenerativeModel;
  private readonly modelChatbot: GenerativeModel;
  private readonly modelChatbotFallback: GenerativeModel;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.modelClasificacion = this.genAI.getGenerativeModel({
      model: MODEL_LEGAL,
      systemInstruction: CONTEXTO_MEDELLIN,
      generationConfig: { ...BASE_CONFIG, temperature: 0.1 },
    });

    this.modelJustificacion = this.genAI.getGenerativeModel({
      model: MODEL_LEGAL,
      systemInstruction: CONTEXTO_MEDELLIN,
      generationConfig: { ...BASE_CONFIG, temperature: 0.3 },
    });

    // Modelo jurídico experto para hechos y asunto
    this.modelLegal = this.genAI.getGenerativeModel({
      model: MODEL_LEGAL,
      systemInstruction: SYSTEM_PROMPT_LEGAL,
      generationConfig: { ...BASE_CONFIG, temperature: 0.2, maxOutputTokens: 600 },
    });

    this.modelChatbot = this.genAI.getGenerativeModel({
      model: MODEL_CHATBOT,
      systemInstruction: SYSTEM_PROMPT_CHATBOT,
      generationConfig: { ...BASE_CONFIG, temperature: 0.4 },
    });

    this.modelChatbotFallback = this.genAI.getGenerativeModel({
      model: MODEL_CHATBOT_FALLBACK,
      systemInstruction: SYSTEM_PROMPT_CHATBOT,
      generationConfig: { ...BASE_CONFIG, temperature: 0.4 },
    });

    this.dependenciasKb = buildDependenciasKnowledgeBase();

    this.logger.log(
      `GeminiService listo — modelo: ${MODEL_CHATBOT} | dependencias catalogadas: ${this.dependenciasKb.nombresDependencias.length}`,
    );
  }

  private normalizarDependenciaSalida(rawDependencia: string, contexto: string): string {
    const partes = rawDependencia
      .split(/[,;]|\sy\s/gi)
      .map((p) => p.trim())
      .filter(Boolean);

    const normalizadas = Array.from(
      new Set(
        partes
          .map((parte) => this.dependenciasKb.resolveDependencia(parte, contexto))
          .filter(Boolean),
      ),
    );

    if (normalizadas.length > 0) {
      return normalizadas.join(', ');
    }

    return this.clasificarPorPalabrasClave(contexto || rawDependencia);
  }

  // ---------------------------------------------------------------------------
  // Extracción robusta de JSON de la respuesta
  // ---------------------------------------------------------------------------
  private extraerJson(texto: string): string | null {
    const clean = texto.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return clean.slice(start, end + 1);
  }

  // ---------------------------------------------------------------------------
  // Clasificación de denuncia (para flujo legacy y dashboard-api)
  // ---------------------------------------------------------------------------
  private clasificarPorPalabrasClave(desc: string): string {
    const d = desc.toLowerCase();
    if (/gimnasio al aire libre|escenario deportivo|cancha|polideportivo|deporte|inder/.test(d)) return 'INDER';
    if (/hueco|v[ií]a|pavimento|acera|puente|and[eé]n/.test(d))           return 'Secretaría de Infraestructura Física';
    if (/basura|reciclaje|aseo|residuo/.test(d))                           return 'Emvarias';
    if (/[aá]rbol|quebrada|contaminaci[oó]n|ruido|ambiental|animal/.test(d)) return 'Secretaría de Medio Ambiente';
    if (/pelea|robo|hurto|pandilla|combo|delincuencia|violencia|amenaza/.test(d)) return 'Secretaría de Seguridad y Convivencia';
    if (/acueducto|alcantarillado|agua|luz|energ[ií]a|gas|epm/.test(d))   return 'EPM';
    if (/tr[aá]nsito|sem[aá]foro|movilidad|bus|metro|transporte/.test(d)) return 'Secretaría de Movilidad';
    if (/salud|hospital|cl[ií]nica|eps|m[eé]dico/.test(d))                return 'Secretaría de Salud';
    if (/colegio|escuela|educaci[oó]n|profesor|pae/.test(d))              return 'Secretaría de Educación';
    if (/vivienda|arrendamiento|inquilinato/.test(d))                      return 'ISVIMED';
    if (/construcci[oó]n ilegal|urbanismo|espacio p[uú]blico/.test(d))    return 'Secretaría de Gestión y Control Territorial';
    return 'Secretaría de Gobierno y Gestión del Gabinete';
  }

  /**
   * Clasificación estructurada con selección inteligente de múltiples dependencias.
   * Solo devuelve múltiples si el caso involucra competencias CLARAMENTE diferentes
   * y complementarias. Temperatura baja (0.15) para máxima consistencia.
   */
  async clasificarDenunciaEstructurada(
    descripcion: string,
    ubicacion: string,
    barrio?: string,
  ): Promise<ClasificacionEstructurada | null> {
    const catalogoDependencias = this.dependenciasKb.catalogoTexto;
    const prompt = `Analiza esta denuncia ciudadana de Medellín Colombia.

Denuncia: ${descripcion.substring(0, 600)}
Ubicación: ${ubicacion}${barrio ? `, ${barrio}` : ''}

DEPENDENCIAS OFICIALES DISPONIBLES (usa EXCLUSIVAMENTE estos nombres):
${catalogoDependencias}

REGLA CRÍTICA: Identifica la dependencia PRINCIPAL que tiene la competencia más fuerte y directa.
Solo adiciona dependencias secundarias si:
1. La problemática involucra CLARAMENTE múltiples competencias (ej: basura ilegal en espacio público → Emvarias para aseo + Gestión Territorial para control del espacio).
2. Cada dependencia adicional tiene una función DIFERENTE y específica que aportar.
3. No repitas competencias similares.

La mayoría de casos deben tener UNA sola dependencia.

Responde SOLO con JSON sin markdown:
{
  "esEspecial": boolean,
  "dependencias": [
    {
      "nombre": "Nombre exacto de la dependencia",
      "justificacion": "Por qué esta específicamente",
      "solicitudEspecifica": "Qué se le pide a ESTA dependencia"
    }
  ],
  "asunto": "VERBO INFINITIVO + DESCRIPCIÓN CONCISA EN MAYÚSCULAS (máx 12 palabras)",
  "esPrincipal": "Nombre de la dependencia principal"
}`;

    try {
      const model = this.genAI.getGenerativeModel({
        model: MODEL_LEGAL,
        systemInstruction: CONTEXTO_MEDELLIN,
        generationConfig: { ...BASE_CONFIG, temperature: 0.15, maxOutputTokens: 800 },
      });
      const result  = await model.generateContent(prompt);
      const jsonStr = this.extraerJson(result.response.text());
      if (!jsonStr) return null;
      const p = JSON.parse(jsonStr) as Partial<ClasificacionEstructurada>;
      if (!Array.isArray(p.dependencias) || p.dependencias.length === 0) return null;

      const contexto = `${descripcion} ${ubicacion} ${barrio ?? ''}`;
      const normalizadas: DependenciaClasificada[] = [];
      for (const dep of p.dependencias) {
        const nombreNormalizado = this.normalizarDependenciaSalida(dep.nombre, contexto);
        if (!nombreNormalizado) continue;
        if (normalizadas.some((d) => d.nombre === nombreNormalizado)) continue;
        normalizadas.push({
          nombre: nombreNormalizado,
          justificacion: dep.justificacion ?? 'Clasificación IA',
          solicitudEspecifica: dep.solicitudEspecifica ?? 'Que se atienda y responda formalmente la situación reportada.',
        });
      }

      if (normalizadas.length === 0) {
        normalizadas.push({
          nombre: this.clasificarPorPalabrasClave(contexto),
          justificacion: 'Clasificación por respaldo de reglas locales',
          solicitudEspecifica: 'Que se atienda y responda formalmente la situación reportada.',
        });
      }

      return {
        esEspecial:   p.esEspecial ?? false,
        dependencias: normalizadas,
        asunto:       (p.asunto ?? '').toUpperCase().trim(),
        esPrincipal:  this.normalizarDependenciaSalida(p.esPrincipal ?? normalizadas[0].nombre, contexto),
      };
    } catch (err) {
      this.logger.warn(`clasificarDenunciaEstructurada falló: ${(err as Error).message?.substring(0, 80)}`);
      return null;
    }
  }

  /**
   * Filtra una solicitud adicional del ciudadano antes de incluirla en un oficio oficial.
   * Devuelve { incluir, solicitudFormateada } según criterio jurídico.
   */
  async filtrarSolicitudAdicional(solicitud: string): Promise<FiltroSolicitud> {
    const prompt = `El ciudadano quiere agregar esta solicitud adicional a un oficio oficial del concejal de Medellín:
"${solicitud.substring(0, 400)}"

¿Es apropiado incluirla en un oficio oficial?
Criterios para incluirla:
- Es una solicitud formal y razonable a una entidad
- Pide información, acción o respuesta específica
- No es una queja informal o comentario personal
- No es algo que ya está implícito en las solicitudes estándar

Responde SOLO con JSON sin markdown:
{
  "incluir": boolean,
  "solicitudFormateada": "versión formal si se incluye, null si no"
}`;

    try {
      const model = this.genAI.getGenerativeModel({
        model: MODEL_LEGAL,
        systemInstruction: SYSTEM_PROMPT_LEGAL,
        generationConfig: { ...BASE_CONFIG, temperature: 0.2, maxOutputTokens: 400 },
      });
      const result  = await model.generateContent(prompt);
      const jsonStr = this.extraerJson(result.response.text());
      if (!jsonStr) return { incluir: true, solicitudFormateada: solicitud };
      const p = JSON.parse(jsonStr) as Partial<FiltroSolicitud>;
      return {
        incluir:             p.incluir ?? true,
        solicitudFormateada: p.solicitudFormateada ?? null,
      };
    } catch (err) {
      this.logger.warn(`filtrarSolicitudAdicional falló: ${(err as Error).message?.substring(0, 80)}`);
      return { incluir: true, solicitudFormateada: solicitud };
    }
  }

  async clasificarDenuncia(descripcion: string): Promise<{
    esEspecial: boolean;
    dependencia: string;
    justificacionBreve: string;
  }> {
    const prompt = `Denuncia: "${descripcion.substring(0, 400)}"
Dependencias válidas (usa EXACTAMENTE una):
${this.dependenciasKb.catalogoTexto}
Clasifica. SOLO JSON: {"esEspecial":bool,"dependencia":"nombre exacto","justificacionBreve":"una oración"}`;

    try {
      const result = await this.modelClasificacion.generateContent(prompt);
      const jsonStr = this.extraerJson(result.response.text());
      if (!jsonStr) throw new Error('sin JSON');
      const p = JSON.parse(jsonStr) as { esEspecial?: boolean; dependencia?: string; justificacionBreve?: string };
      const dependenciaNormalizada = this.normalizarDependenciaSalida(p.dependencia ?? '', descripcion);
      return {
        esEspecial:         p.esEspecial ?? false,
        dependencia:        dependenciaNormalizada,
        justificacionBreve: p.justificacionBreve ?? '',
      };
    } catch {
      return { esEspecial: false, dependencia: this.clasificarPorPalabrasClave(descripcion), justificacionBreve: '' };
    }
  }

  // ---------------------------------------------------------------------------
  // Motor principal del chatbot conversacional
  // ---------------------------------------------------------------------------
  async procesarMensajeChatbot(
    historial: Array<{ rol: string; contenido: string }>,
    datosConfirmados: Record<string, unknown>,
    mensaje: string,
  ): Promise<RespuestaChatbot> {
    const hist = historial
      .slice(-10)
      .map((m) => `${m.rol === 'user' ? 'U' : 'A'}: ${m.contenido}`)
      .join('\n');

    const datos = Object.fromEntries(
      Object.entries(datosConfirmados).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false),
    );

    const pendientes = [
      !datos['descripcion'] ? '- Descripción del problema' : null,
      !datos['barrio'] ? '- Barrio' : null,
      !datos['direccion'] ? '- Dirección exacta' : null,
      !datos['direccionConfirmada'] ? '- Confirmar dirección' : null,
      !(datos['nombre'] || datos['esAnonimo']) ? '- Nombre completo' : null,
      !(datos['esAnonimo'] === true || datos['cedula']) ? '- Cédula' : null,
    ].filter(Boolean).join('\n') || 'TODOS LOS DATOS RECOPILADOS';

    const instruccionFinal = pendientes === 'TODOS LOS DATOS RECOPILADOS'
      ? '\nACCIÓN REQUERIDA: Todos los datos están. Muestra resumen y setea listaParaRadicar:true en el JSON.'
      : '';

    const prompt = `HISTORIAL:\n${hist || '(inicio)'}

DATOS RECOPILADOS: ${JSON.stringify(datos)}

  DEPENDENCIAS OFICIALES DISPONIBLES (usa exactamente estos nombres, no inventes):
  ${this.dependenciasKb.catalogoTexto}

DATOS PENDIENTES:\n${pendientes}${instruccionFinal}

USUARIO: ${mensaje}

JSON:`;

    const intentarConModelo = async (model: GenerativeModel): Promise<RespuestaChatbot> => {
      const result = await model.generateContent(prompt);
      const raw = result.response.text();
      this.logger.debug(`Gemini raw: ${raw.substring(0, 200)}`);

      const jsonStr = this.extraerJson(raw);
      if (!jsonStr) {
        this.logger.warn(`Gemini no devolvió JSON. Raw: ${raw.substring(0, 200)}`);
        return this.fallback(datosConfirmados);
      }

      const p = JSON.parse(jsonStr) as Partial<RespuestaChatbot>;
      const datosExtraidos = ((p.datosExtraidos as Record<string, unknown>) ?? {});
      if (typeof datosExtraidos.dependencia === 'string') {
        datosExtraidos.dependencia = this.normalizarDependenciaSalida(datosExtraidos.dependencia, mensaje);
      }

      return {
        respuesta:        p.respuesta ?? '¿Me repites eso?',
        datosExtraidos,
        etapaSiguiente:   p.etapaSiguiente ?? 'recopilando',
        listaParaRadicar: p.listaParaRadicar ?? false,
      };
    };

    try {
      return await intentarConModelo(this.modelChatbot);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('429')) {
        this.logger.warn(`429 modelo primario — usando fallback ${MODEL_CHATBOT_FALLBACK}`);
        try {
          return await intentarConModelo(this.modelChatbotFallback);
        } catch (err2) {
          this.logger.error(`Error Gemini chatbot fallback: ${(err2 as Error).message}`);
          return this.fallback(datosConfirmados);
        }
      }
      this.logger.error(`Error Gemini chatbot: ${msg}`);
      return this.fallback(datosConfirmados);
    }
  }

  private fallback(datos: Record<string, unknown>): RespuestaChatbot {
    return {
      respuesta:       'Tuve un problema técnico, disculpa. ¿Me repites tu mensaje? 🙏',
      datosExtraidos:  {},
      etapaSiguiente:  (datos['etapa'] as RespuestaChatbot['etapaSiguiente']) ?? 'recopilando',
      listaParaRadicar: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Generación de resumen para el dashboard
  // ---------------------------------------------------------------------------
  async generarResumen(datos: {
    nombre?: string;
    barrio?: string;
    direccion?: string;
    descripcion?: string;
    dependencia?: string;
  }): Promise<string> {
    const prompt = `Resume en 1-2 oraciones esta denuncia para registro interno. Sin markdown, sin títulos.
Ciudadano: ${datos.nombre ?? 'Anónimo'} | Barrio: ${datos.barrio ?? '-'} | Dir: ${datos.direccion ?? '-'}
Problema: ${(datos.descripcion ?? '').substring(0, 300)} | Entidad: ${datos.dependencia ?? '-'}`;

    try {
      const r = await this.modelJustificacion.generateContent(prompt);
      return r.response.text().trim();
    } catch {
      return (datos.descripcion ?? '').substring(0, 200);
    }
  }

  // ---------------------------------------------------------------------------
  // Generación de sección HECHOS — prompt jurídico experto (Entrega 4)
  // ---------------------------------------------------------------------------
  async generarHechos(datos: {
    nombreCiudadano: string;
    esAnonimo: boolean;
    direccion: string;
    barrio: string;
    comuna: string;
    descripcion: string;
    dependencia: string;
  }): Promise<string> {
    const loc = [datos.barrio, datos.comuna].filter(Boolean).join(', ');
    const locStr = loc ? `, barrio ${datos.barrio}${datos.comuna ? `, ${datos.comuna}` : ''}` : '';

    const prompt = `Redacta la sección HECHOS para un oficio oficial del concejal Andrés Felipe Tobón Villada dirigido a ${datos.dependencia}.

SITUACIÓN A GESTIONAR:
- Ubicación: ${datos.direccion}${locStr} de Medellín
- Descripción: ${datos.descripcion}

ESTRUCTURA OBLIGATORIA (3 párrafos separados por línea en blanco):

PÁRRAFO 1 — DESCRIPCIÓN DE LOS HECHOS:
Inicia con "Este despacho ha podido establecer que" o similar. Describe objetivamente la situación, su ubicación y el tiempo que lleva sin atención si se menciona. NO incluyas el nombre del ciudadano.

PÁRRAFO 2 — FUNDAMENTO NORMATIVO Y COMPETENCIA:
Cita la norma colombiana más específica aplicable. Explica por qué es competencia de ${datos.dependencia} atender esta situación. Usa la estructura: "Conforme a [norma], corresponde a ${datos.dependencia}..."

PÁRRAFO 3 — IMPACTO Y URGENCIA:
Describe el perjuicio o riesgo que genera la inacción para la comunidad. Menciona el deber de respuesta en los términos del artículo 30 de la Ley 1755 de 2015.

RESTRICCIONES:
- Máximo 220 palabras totales
- Solo texto plano, sin markdown ni títulos
- Párrafos separados por salto de línea doble
- Tono formal jurídico
- NUNCA el nombre del denunciante`;

    try {
      const r = await this.modelLegal.generateContent(prompt);
      return r.response.text().trim();
    } catch (err) {
      this.logger.warn(`generarHechos falló (${(err as Error).message?.substring(0, 60)}) — usando fallback`);
      return this.hechosFallback(datos);
    }
  }

  private hechosFallback(datos: {
    direccion: string; barrio: string; comuna: string; descripcion: string; dependencia: string;
  }): string {
    const loc = [datos.barrio, datos.comuna].filter(Boolean).join(', ');
    return `Este despacho ha podido establecer que en la dirección ${datos.direccion}${loc ? `, ${loc}` : ''}, del municipio de Medellín, se presenta la siguiente situación que requiere atención urgente por parte de las autoridades competentes.

${datos.descripcion}

De conformidad con lo establecido en el artículo 23 de la Constitución Política de Colombia, toda persona tiene derecho a presentar peticiones respetuosas a las autoridades por motivos de interés general o particular, y a obtener pronta resolución. En ese sentido, en virtud de lo dispuesto por el artículo 30 de la Ley 1755 de 2015, se pone en conocimiento de ${datos.dependencia} la situación descrita para que proceda conforme a sus competencias en un término no mayor a diez (10) días.`;
  }

  // ---------------------------------------------------------------------------
  // Generación del ASUNTO del oficio — prompt jurídico experto (Entrega 4)
  // ---------------------------------------------------------------------------
  async generarAsunto(datos: {
    descripcionResumen: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Genera el ASUNTO para un oficio formal del concejal de Medellín a ${datos.dependencia}.

Situación: ${datos.descripcionResumen}
Dependencia: ${datos.dependencia}

Requisitos:
- Máximo 12 palabras
- Inicia con verbo en infinitivo en MAYÚSCULAS: SOLICITAR, REQUERIR, GESTIONAR, INTERVENIR, VERIFICAR, ATENDER
- Describe la acción Y el objeto claramente
- Ejemplo bueno: "REQUERIR INTERVENCIÓN INMEDIATA POR DETERIORO DE VÍA PÚBLICA EN LAURELES"
- Ejemplo malo: "DAÑO EN TUBO DE AGUA"
- Todo en MAYÚSCULAS
- Sin punto final

Responde SOLO con el texto del asunto, sin explicaciones.`;

    try {
      const r = await this.genAI.getGenerativeModel({
        model: MODEL_LEGAL,
        systemInstruction: SYSTEM_PROMPT_LEGAL,
        generationConfig: { temperature: 0.1, maxOutputTokens: 60 },
      }).generateContent(prompt);
      const text = r.response.text().trim().toUpperCase().replace(/\.$/, '');
      return text || `SOLICITAR ATENCIÓN URGENTE POR ${datos.descripcionResumen.substring(0, 60).toUpperCase()}`;
    } catch (err) {
      this.logger.warn(`generarAsunto falló: ${(err as Error).message?.substring(0, 60)}`);
      const dep = datos.dependencia.split(' ').slice(0, 3).join(' ').toUpperCase();
      return `SOLICITAR INTERVENCIÓN DE ${dep}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Justificación legal completa (legacy — Entrega 4)
  // ---------------------------------------------------------------------------
  async generarJustificacionLegal(datos: {
    nombre: string;
    descripcion: string;
    ubicacion: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Justificación legal para oficio del concejal Andrés Tobón a ${datos.dependencia}.
Ubicación: ${datos.ubicacion}. Descripción: ${datos.descripcion.substring(0, 400)}
Máx 3 párrafos, normativa colombiana, tono formal.`;

    const r = await this.modelJustificacion.generateContent(prompt);
    return r.response.text();
  }
}
