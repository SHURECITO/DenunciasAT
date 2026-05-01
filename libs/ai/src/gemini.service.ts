import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, type GenerateContentConfig } from '@google/genai';
import { buildDependenciasKnowledgeBase, type DependenciasKnowledgeBase } from './dependencias-kb';

// Wrapper ligero sobre @google/genai para conservar la interfaz de modelo por instancia
class VertexModel {
  constructor(
    private readonly ai: GoogleGenAI,
    private readonly modelName: string,
    private readonly config: GenerateContentConfig,
  ) {}

  async generateContent(prompt: string): Promise<{ response: { text: () => string } }> {
    const resp = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: this.config,
    });
    const textValue = resp.text ?? '';
    return { response: { text: () => textValue } };
  }
}

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
const SYSTEM_PROMPT_LEGAL = `Eres un abogado experto en derecho administrativo colombiano al servicio del concejal de Medellín Andrés Felipe Tobón Villada.

Tu función es redactar la sección HECHOS de oficios institucionales dirigidos a dependencias de la Alcaldía de Medellín.

ESTILO DE REDACCIÓN:
- Institucional, claro y directo — no técnico-jurídico complejo
- El concejal conoció la situación en ejercicio de sus funciones, nunca a través de un ciudadano
- Preciso y sin redundancias
- Sin lenguaje emocional ni informal

ESTRUCTURA DE LOS HECHOS (3 párrafos):
1. Párrafo 1 — Contextualización: dónde ocurre y qué se encontró. Empieza con "Este despacho conoció de una problemática que afecta la comunidad del sector de [barrio]."
2. Párrafo 2 — Descripción objetiva del problema: qué es, cómo afecta, por qué es urgente. Sin exageraciones, sin juicios de valor.
3. Párrafo 3 — Competencia e intervención requerida: por qué esta dependencia es la responsable y qué debe hacer.

NORMATIVA:
- Solo cita normas colombianas que conozcas con certeza absoluta
- Si no estás seguro de un artículo específico, no lo cites
- Nunca inventes normas ni jurisprudencia
- La normativa es opcional — solo úsala si refuerza naturalmente el argumento

RESTRICCIONES ABSOLUTAS:
- Nunca mencionar el nombre del ciudadano denunciante
- Nunca asumir información no proporcionada
- Nunca hacer juicios de valor sobre personas o entidades
- Máximo 3 párrafos, separados por línea en blanco
- Sin encabezados, sin títulos, sin explicaciones adicionales`;

// ---------------------------------------------------------------------------
// System prompt del chatbot conversacional
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT_CHATBOT = `Eres un asistente conversacional avanzado especializado en la gestión de denuncias ciudadanas en Medellín para el sistema DenunciasAT.

Tu rol NO es solo conversar.
Tu rol principal es ORQUESTAR inteligentemente la recolección de datos necesarios para radicar una denuncia completa, de forma natural, eficiente y sin fricción.

──────────────────────────────
🧠 PRINCIPIO FUNDAMENTAL
──────────────────────────────

Antes de responder SIEMPRE debes:

1. Analizar completamente el mensaje del usuario
2. Extraer TODOS los datos posibles (aunque no te los pidan explícitamente)
3. Actualizar mentalmente el estado de la conversación
4. Determinar qué datos faltan realmente
5. Decidir la mejor siguiente acción
6. Luego responder de forma natural

NUNCA respondas de forma impulsiva o superficial.

──────────────────────────────
📦 DATOS QUE DEBES RECOLECTAR
──────────────────────────────

Debes intentar obtener y mantener actualizados:

* descripcion (mínimo 20 palabras)
* ubicacion (dirección exacta válida)
* barrio
* comuna (opcional)
* imagenes (URLs si existen)
* pdfs (URLs si existen)
* solicitudAdicional (opcional)
* nombre
* cedula (si no es anónimo)
* esAnonimo

──────────────────────────────
⚙️ REGLAS DE COMPORTAMIENTO
──────────────────────────────

1. EXTRACCIÓN AGRESIVA
   Si el usuario da múltiples datos en un solo mensaje:
   → Extrae TODO sin volver a preguntar

2. NO REPETICIÓN
   Si un dato ya es válido:
   → NO lo vuelvas a pedir

3. MANEJO DE MENSAJES MIXTOS
   Si el usuario:

* envía texto + datos + preguntas + evidencia
  → Procesa TODO en el mismo turno

4. INTERRUPCIONES NATURALES
   Si el usuario hace una pregunta en medio del flujo:
   → Respóndela brevemente
   → Luego retoma el flujo inteligentemente

5. EVIDENCIA
   Si llegan imágenes o PDFs:
   → Regístralos inmediatamente
   → Confirma recepción de forma natural (sin ser robótico)

6. VALIDACIÓN INTELIGENTE

* Dirección debe tener formato real (calle, carrera, etc.)
* Cédula: 6–10 dígitos
* Nombre: mínimo 3 caracteres

7. CONVERSACIÓN NATURAL

* No enumeres preguntas tipo formulario
* Haz una sola pregunta por turno (cuando sea posible)
* Mantén tono humano y cercano

8. CONTROL DE FLUJO
  Siempre debes tener claridad interna de:

* qué ya tienes
* qué falta
* qué es prioritario preguntar

──────────────────────────────
🧭 LÓGICA DE PRIORIDAD
──────────────────────────────

Orden ideal de recolección:

1. descripcion
2. ubicacion (direccion + barrio)
3. evidencia (imagenes/pdf)
4. solicitud adicional
5. nombre
6. cedula

Pero puedes adaptarte dinámicamente según lo que el usuario diga.

──────────────────────────────
🧩 CASOS ESPECIALES
──────────────────────────────

* Si el usuario escribe "anonimo" como nombre:
  → esAnonimo = true
  → NO pedir cédula

* Si detectas denuncia sensible:
  → etapaSiguiente = "especial_cerrado"

──────────────────────────────
🚀 FINALIZACIÓN
──────────────────────────────

Solo cuando TODOS los datos estén completos:

* Resume la información
* Pide confirmación final
* Si el usuario confirma → listaParaRadicar = true

──────────────────────────────
📤 FORMATO DE RESPUESTA (OBLIGATORIO)
──────────────────────────────

{
"respuesta": "mensaje natural al usuario",
"datosExtraidos": {
"nombre": null,
"cedula": null,
"descripcion": null,
"ubicacion": null,
"barrio": null,
"comuna": null,
"solicitudAdicional": null,
"imagenes": [],
"pdfs": [],
"esAnonimo": false
},
"etapaSiguiente": "recopilando | confirmando | finalizado | especial_cerrado",
"listaParaRadicar": false
}

──────────────────────────────
❌ ERRORES PROHIBIDOS
──────────────────────────────

* Preguntar algo que ya fue respondido
* Ignorar datos presentes
* No procesar evidencia
* Romper JSON
* Responder sin analizar contexto`;

// Modelos disponibles en Vertex AI (ADC — sin API key)
const MODEL_CHATBOT          = 'gemini-2.5-flash-preview-04-17';
const MODEL_CHATBOT_FALLBACK = 'gemini-2.0-flash-001';
const MODEL_LEGAL            = 'gemini-2.5-flash-preview-04-17';

const BASE_CONFIG = { topP: 0.8, topK: 40, maxOutputTokens: 512 };
const CHATBOT_MSG_FALLBACK = 'Disculpa, no logré entender bien. ¿Podrías explicarme nuevamente el problema?';
const ETAPAS_CHATBOT_VALIDAS = new Set([
  'recopilando',
  'esperando_solicitud',
  'confirmando',
  'finalizado',
  'especial_cerrado',
  'cancelado',
]);
const REGEX_TIPO_VIA = /\b(calle|cl\.?|carrera|cra\.?|kr\.?|avenida|av\.?|diagonal|diag\.?|transversal|tv\.?|autopista|circular)\b/i;

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
  private readonly ai: GoogleGenAI | null;
  private readonly dependenciasKb: DependenciasKnowledgeBase;

  private readonly modelClasificacion: VertexModel;
  private readonly modelJustificacion: VertexModel;
  private readonly modelLegal: VertexModel;
  private readonly modelChatbot: VertexModel;
  private readonly modelChatbotFallback: VertexModel;

  constructor(private readonly config: ConfigService) {
    // Autenticación vía ADC (Application Default Credentials) — sin API key
    const project  = this.config.get<string>('GCP_PROJECT_ID', '');
    const location = this.config.get<string>('GCP_REGION', 'us-central1');

    if (!project) {
      this.logger.warn('GCP_PROJECT_ID no configurada — GeminiService en modo degradado');
      this.ai = null;
    } else {
      try {
        this.ai = new GoogleGenAI({ vertexai: true, project, location });
      } catch (err) {
        this.logger.error(`No se pudo inicializar Vertex AI: ${(err as Error).message} — modo degradado`);
        this.ai = null;
      }
    }

    // ai puede ser null; los modelos usarán {} como dummy — todos los métodos tienen try/catch
    const aiParaModelos = this.ai ?? ({} as GoogleGenAI);

    this.modelClasificacion = new VertexModel(aiParaModelos, MODEL_LEGAL, {
      systemInstruction: CONTEXTO_MEDELLIN,
      ...BASE_CONFIG,
      temperature: 0.1,
    });

    this.modelJustificacion = new VertexModel(aiParaModelos, MODEL_LEGAL, {
      systemInstruction: CONTEXTO_MEDELLIN,
      ...BASE_CONFIG,
      temperature: 0.3,
    });

    // Modelo jurídico experto para hechos y asunto
    this.modelLegal = new VertexModel(aiParaModelos, MODEL_LEGAL, {
      systemInstruction: SYSTEM_PROMPT_LEGAL,
      ...BASE_CONFIG,
      temperature: 0.2,
      maxOutputTokens: 1024,
    });

    this.modelChatbot = new VertexModel(aiParaModelos, MODEL_CHATBOT, {
      systemInstruction: SYSTEM_PROMPT_CHATBOT,
      ...BASE_CONFIG,
      temperature: 0.4,
    });

    this.modelChatbotFallback = new VertexModel(aiParaModelos, MODEL_CHATBOT_FALLBACK, {
      systemInstruction: SYSTEM_PROMPT_CHATBOT,
      ...BASE_CONFIG,
      temperature: 0.4,
    });

    this.dependenciasKb = buildDependenciasKnowledgeBase();

    this.logger.log(
      `GeminiService listo — modo: ${this.ai ? 'Vertex AI' : 'degradado'} | proyecto: ${project || '(no configurado)'} | región: ${location} | modelo: ${MODEL_CHATBOT} | dependencias: ${this.dependenciasKb.nombresDependencias.length}`,
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

  private extraerBloquesJsonBalanceados(texto: string): string[] {
    const bloques: string[] = [];
    let profundidad = 0;
    let inicio = -1;

    for (let i = 0; i < texto.length; i += 1) {
      const ch = texto[i];
      if (ch === '{') {
        if (profundidad === 0) inicio = i;
        profundidad += 1;
        continue;
      }

      if (ch === '}') {
        if (profundidad === 0) continue;
        profundidad -= 1;
        if (profundidad === 0 && inicio !== -1) {
          bloques.push(texto.slice(inicio, i + 1));
          inicio = -1;
        }
      }
    }

    return bloques;
  }

  private parsearRespuestaChatbotRobusta(raw: string): {
    payload: Partial<RespuestaChatbot> | null;
    error?: string;
  } {
    const limpio = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    if (!limpio) {
      return { payload: null, error: 'respuesta vacía del modelo' };
    }

    const candidatos: string[] = [];
    const pushCandidato = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (!candidatos.includes(trimmed)) {
        candidatos.push(trimmed);
      }
    };

    pushCandidato(limpio);
    pushCandidato(this.extraerJson(limpio));

    // Fallback por regex solicitado: intenta extraer un bloque {...} del texto bruto.
    const matchRegex = limpio.match(/\{[\s\S]*\}/);
    pushCandidato(matchRegex?.[0]);

    for (const bloque of this.extraerBloquesJsonBalanceados(limpio)) {
      pushCandidato(bloque);
    }

    let ultimoError = 'No se encontró JSON parseable';
    for (const candidato of candidatos) {
      try {
        return { payload: JSON.parse(candidato) as Partial<RespuestaChatbot> };
      } catch (err) {
        ultimoError = (err as Error).message || 'JSON inválido';
      }
    }

    return { payload: null, error: ultimoError };
  }

  private normalizarEtapaSiguiente(
    etapa: unknown,
    datosConfirmados: Record<string, unknown>,
  ): RespuestaChatbot['etapaSiguiente'] {
    const etapaSalida = typeof etapa === 'string' ? etapa.trim() : '';
    if (ETAPAS_CHATBOT_VALIDAS.has(etapaSalida)) {
      return etapaSalida as RespuestaChatbot['etapaSiguiente'];
    }

    const etapaActual = typeof datosConfirmados['etapa'] === 'string' ? datosConfirmados['etapa'] : '';
    if (ETAPAS_CHATBOT_VALIDAS.has(etapaActual)) {
      return etapaActual as RespuestaChatbot['etapaSiguiente'];
    }

    return 'recopilando';
  }

  private contarPalabras(texto: string): number {
    return texto
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;
  }

  private normalizarListaTexto(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const valores = Array.from(
      new Set(
        value
          .filter((v) => typeof v === 'string')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    );
    return valores.length > 0 ? valores : undefined;
  }

  private sanitizarDatosExtraidos(
    rawDatos: unknown,
    mensaje: string,
  ): { datos: Record<string, unknown>; camposInvalidos: string[] } {
    if (!rawDatos || typeof rawDatos !== 'object' || Array.isArray(rawDatos)) {
      return { datos: {}, camposInvalidos: [] };
    }

    const fuente = { ...(rawDatos as Record<string, unknown>) };
    if (!fuente['nombre'] && typeof fuente['nombreCompleto'] === 'string') {
      fuente['nombre'] = fuente['nombreCompleto'];
    }

    const datos: Record<string, unknown> = {};
    const invalidos = new Set<string>();

    if (typeof fuente['nombre'] === 'string') {
      const nombre = fuente['nombre'].trim();
      if (nombre.length >= 3) {
        datos['nombre'] = nombre;
      } else if (nombre) {
        invalidos.add('nombre');
      }
    }

    if (typeof fuente['cedula'] === 'string' || typeof fuente['cedula'] === 'number') {
      const cedulaNormalizada = String(fuente['cedula']).replace(/\D/g, '');
      if (/^\d{6,10}$/.test(cedulaNormalizada)) {
        datos['cedula'] = cedulaNormalizada;
      } else if (cedulaNormalizada || String(fuente['cedula']).trim()) {
        invalidos.add('cedula');
      }
    }

    if (typeof fuente['descripcion'] === 'string') {
      const descripcion = fuente['descripcion'].trim();
      if (!descripcion) {
        // Ignorar vacío explícito
      } else if (this.contarPalabras(descripcion) >= 20) {
        datos['descripcion'] = descripcion;
      } else {
        invalidos.add('descripcion');
      }
    }

    const ubicacionRaw = typeof fuente['ubicacion'] === 'string'
      ? fuente['ubicacion'].trim()
      : typeof fuente['direccion'] === 'string'
        ? fuente['direccion'].trim()
        : '';

    if (ubicacionRaw) {
      if (REGEX_TIPO_VIA.test(ubicacionRaw)) {
        datos['direccion'] = ubicacionRaw;
        datos['direccionConfirmada'] = true;
      } else {
        invalidos.add('ubicacion');
      }
    }

    if (typeof fuente['barrio'] === 'string' && fuente['barrio'].trim()) {
      datos['barrio'] = fuente['barrio'].trim();
    }
    if (typeof fuente['comuna'] === 'string' && fuente['comuna'].trim()) {
      datos['comuna'] = fuente['comuna'].trim();
    }
    if (typeof fuente['solicitudAdicional'] === 'string' && fuente['solicitudAdicional'].trim()) {
      datos['solicitudAdicional'] = fuente['solicitudAdicional'].trim();
    }

    const imagenes = this.normalizarListaTexto(fuente['imagenes']);
    if (imagenes) datos['imagenes'] = imagenes;

    const pdfs = this.normalizarListaTexto(fuente['pdfs']);
    if (pdfs) datos['pdfs'] = pdfs;

    if (typeof fuente['esAnonimo'] === 'boolean') {
      datos['esAnonimo'] = fuente['esAnonimo'];
    }
    if (typeof fuente['esEspecial'] === 'boolean') {
      datos['esEspecial'] = fuente['esEspecial'];
    }
    if (typeof fuente['dependencia'] === 'string' && fuente['dependencia'].trim()) {
      datos['dependencia'] = this.normalizarDependenciaSalida(fuente['dependencia'], mensaje);
    }

    return { datos, camposInvalidos: Array.from(invalidos) };
  }

  private mensajeCorreccionPorCampo(camposInvalidos: string[]): string {
    const prioridad = ['descripcion', 'ubicacion', 'nombre', 'cedula'];
    const campo = prioridad.find((c) => camposInvalidos.includes(c)) ?? camposInvalidos[0];

    switch (campo) {
      case 'descripcion':
        return 'Gracias. Para continuar, descríbeme el problema con más detalle (mínimo 20 palabras).';
      case 'ubicacion':
        return '¿Me compartes la dirección exacta con tipo de vía y número? Ejemplo: Calle 10 # 20-30.';
      case 'nombre':
        return '¿Me confirmas tu nombre completo? Debe tener al menos 3 caracteres.';
      case 'cedula':
        return '¿Me compartes tu cédula en formato numérico de 6 a 10 dígitos?';
      default:
        return CHATBOT_MSG_FALLBACK;
    }
  }

  private esRespuestaVaciaOIncoherente(respuesta: string): boolean {
    const r = respuesta.trim();
    if (!r) return true;
    if (!/[\p{L}\p{N}]/u.test(r)) return true;
    if (/^(null|undefined|n\/a|sin respuesta|\{\}|\[\]|\.\.\.)$/i.test(r)) return true;
    return false;
  }

  private normalizarRespuestaChatbot(
    payload: Partial<RespuestaChatbot>,
    datosConfirmados: Record<string, unknown>,
    mensaje: string,
  ): RespuestaChatbot {
    const { datos, camposInvalidos } = this.sanitizarDatosExtraidos(payload.datosExtraidos, mensaje);
    let respuesta = typeof payload.respuesta === 'string' ? payload.respuesta.trim() : '';
    let etapaSiguiente = this.normalizarEtapaSiguiente(payload.etapaSiguiente, datosConfirmados);
    let listaParaRadicar = payload.listaParaRadicar === true;

    if (camposInvalidos.length > 0) {
      respuesta = this.mensajeCorreccionPorCampo(camposInvalidos);
      etapaSiguiente = 'recopilando';
      listaParaRadicar = false;
    }

    if (this.esRespuestaVaciaOIncoherente(respuesta)) {
      return this.fallback(datosConfirmados, 'respuesta vacía o incoherente', datos, etapaSiguiente);
    }

    return {
      respuesta,
      datosExtraidos: datos,
      etapaSiguiente,
      listaParaRadicar,
    };
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
      const model = new VertexModel(this.ai, MODEL_LEGAL, {
        systemInstruction: CONTEXTO_MEDELLIN,
        ...BASE_CONFIG,
        temperature: 0.15,
        maxOutputTokens: 800,
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
      const model = new VertexModel(this.ai, MODEL_LEGAL, {
        systemInstruction: SYSTEM_PROMPT_LEGAL,
        ...BASE_CONFIG,
        temperature: 0.2,
        maxOutputTokens: 400,
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

    const intentarConModelo = async (model: VertexModel): Promise<RespuestaChatbot> => {
      const result = await model.generateContent(prompt);
      const raw = result.response.text();
      this.logger.debug(`Gemini raw: ${raw.substring(0, 500)}`);

      const parse = this.parsearRespuestaChatbotRobusta(raw);
      if (!parse.payload) {
        this.logger.warn(`Error parseo JSON chatbot: ${parse.error ?? 'JSON inválido'}`);
        return this.fallback(datosConfirmados, 'json inválido o ausente');
      }

      this.logger.debug(`Gemini JSON parseado: ${JSON.stringify(parse.payload).substring(0, 500)}`);

      return this.normalizarRespuestaChatbot(parse.payload, datosConfirmados, mensaje);
    };

    try {
      return await intentarConModelo(this.modelChatbot);
    } catch (err) {
      const e = err as Error & { code?: string; status?: number; statusCode?: number };
      const msg = e.message ?? '';
      const code = e.code ?? e.status ?? e.statusCode ?? '?';
      this.logger.error(`Error Gemini chatbot: ${msg} | code=${code}`);
      if (e.stack) this.logger.debug(`Stack Gemini chatbot: ${e.stack.substring(0, 800)}`);
      const isAuthError = msg.includes('401') || msg.includes('403') || msg.includes('UNAUTHENTICATED') ||
        String(code) === '401' || String(code) === '403';
      if (isAuthError) {
        this.logger.error('ADC auth failed — verify Service Account has Vertex AI User role');
      }
      if (msg.includes('429')) {
        this.logger.warn(`429 modelo primario — usando fallback ${MODEL_CHATBOT_FALLBACK}`);
        try {
          return await intentarConModelo(this.modelChatbotFallback);
        } catch (err2) {
          const e2 = err2 as Error & { code?: string; status?: number; statusCode?: number };
          const code2 = e2.code ?? e2.status ?? e2.statusCode ?? '?';
          this.logger.error(`Error Gemini chatbot fallback: ${e2.message} | code=${code2}`);
          if (e2.stack) this.logger.debug(`Stack Gemini fallback: ${e2.stack.substring(0, 800)}`);
          return this.fallback(datosConfirmados, 'error ejecutando modelo fallback');
        }
      }
      return this.fallback(datosConfirmados, 'error ejecutando modelo primario');
    }
  }

  private fallback(
    datos: Record<string, unknown>,
    motivo: string,
    datosExtraidos: Record<string, unknown> = {},
    etapaSiguiente?: RespuestaChatbot['etapaSiguiente'],
  ): RespuestaChatbot {
    this.logger.warn(`Fallback activado chatbot: ${motivo}`);
    return {
      respuesta:       CHATBOT_MSG_FALLBACK,
      datosExtraidos,
      etapaSiguiente:  etapaSiguiente ?? this.normalizarEtapaSiguiente(undefined, datos),
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
    ubicacion: string;
    direccion: string;
    barrio: string;
    comuna: string;
    descripcion: string;
    dependenciaPrincipal: string;
    dependenciaSecundaria?: string;
    normativaAplicable: string | { entradas?: Array<{ id: string; tipo: string; nombre: string; descripcion: string }> };
  }): Promise<string> {
    const loc = [datos.barrio, datos.comuna].filter(Boolean).join(', ');
    const locStr = loc ? `, barrio ${datos.barrio}${datos.comuna ? `, ${datos.comuna}` : ''}` : '';
    const dependenciaSecundariaTexto = datos.dependenciaSecundaria?.trim() || 'No aplica';
    const normativaTexto = typeof datos.normativaAplicable === 'string'
      ? datos.normativaAplicable
      : JSON.stringify(datos.normativaAplicable?.entradas ?? []);

    const ubicacionTexto = datos.ubicacion?.trim() || datos.direccion;

    const prompt = `Redacta la sección HECHOS para un oficio institucional del concejal de Medellín Andrés Felipe Tobón Villada.

DATOS DEL CASO:
- Problema reportado: ${datos.descripcion}
- Dirección: ${ubicacionTexto}${locStr}
- Dependencia principal responsable: ${datos.dependenciaPrincipal}
${datos.dependenciaSecundaria?.trim() ? `- Dependencia secundaria: ${datos.dependenciaSecundaria}` : ''}

INSTRUCCIONES:
1. Párrafo 1: Contextualiza dónde ocurre y qué encontró este despacho. Empieza con: "Este despacho conoció de una problemática que afecta la comunidad del sector de [barrio o ubicación]."
2. Párrafo 2: Describe el problema de forma objetiva y clara. Explica cómo afecta a la comunidad y por qué requiere intervención. No copies literalmente la descripción — redáctala de forma institucional manteniendo los hechos exactos.
3. Párrafo 3: Indica por qué ${datos.dependenciaPrincipal} es la entidad competente y qué acción concreta se le solicita.${datos.dependenciaSecundaria?.trim() ? ` Si aplica, menciona articulación con ${datos.dependenciaSecundaria}.` : ''}

PROHIBIDO:
- Copiar literalmente la descripción del ciudadano
- Mencionar el nombre del denunciante
- Inventar hechos no presentes en los datos
- Agregar encabezados o explicaciones fuera de los 3 párrafos
- Citar normas si no tienes certeza absoluta del artículo exacto

Responde SOLO con los 3 párrafos separados por línea en blanco.`;

    try {
      const r = await this.modelLegal.generateContent(prompt);
      return r.response.text().trim();
    } catch (err) {
      this.logger.warn(`generarHechos falló (${(err as Error).message?.substring(0, 60)}) — usando fallback`);
      return this.hechosFallback(datos);
    }
  }

  private hechosFallback(datos: {
    direccion: string; barrio: string; comuna: string; descripcion: string; dependenciaPrincipal: string;
  }): string {
    const loc = [datos.barrio, datos.comuna].filter(Boolean).join(', ');
    const locTexto = loc ? `del sector de ${loc}, ` : '';
    return `Este despacho conoció de una problemática que afecta la comunidad ${locTexto}en la dirección ${datos.direccion}, municipio de Medellín, que requiere atención prioritaria por parte de las autoridades competentes.

En el lugar referenciado se presenta la siguiente situación: ${datos.descripcion}

En ese sentido, se requiere a ${datos.dependenciaPrincipal} que adelante las acciones correspondientes conforme a sus competencias y brinde respuesta oportuna a la situación reportada.`;
  }

  // ---------------------------------------------------------------------------
  // Generación del ASUNTO del oficio — prompt jurídico experto (Entrega 4)
  // ---------------------------------------------------------------------------
  async generarAsunto(datos: {
    descripcionResumen: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Genera el ASUNTO para un oficio oficial del concejal de Medellín dirigido a ${datos.dependencia}.

SITUACIÓN: ${datos.descripcionResumen}

REGLAS:
- Todo en MAYÚSCULAS
- Máximo 12 palabras
- Inicia con verbo en infinitivo: SOLICITAR, REQUERIR, GESTIONAR, INTERVENIR, VERIFICAR, ATENDER
- Incluye casi siempre la dirección o ubicación específica — da claridad al equipo del concejal
- Describe la acción + el problema + la ubicación cuando esté disponible
- Sin punto final

EJEMPLOS DE FORMATO CORRECTO:
- "SOLICITAR INTERVENCIÓN EN MALLA VIAL POR DETERIORO EN LA CALLE 54 #45-60, LA CANDELARIA"
- "REQUERIR ATENCIÓN A SEMÁFORO DAÑADO EN LA CARRERA 80 CON CALLE 30, LAURELES"
- "GESTIONAR RECOLECCIÓN DE ESCOMBROS EN LA DIAGONAL 75B #32-10, CASTILLA"
- "ATENDER PROBLEMÁTICA DE ESPACIO PÚBLICO EN LA AVENIDA EL POBLADO, EL POBLADO"

EJEMPLOS INCORRECTOS (nunca hagas esto):
- "DAÑO EN TUBO DE AGUA" (sin verbo infinitivo, sin ubicación)
- "SOLICITAR INTERVENCIÓN" (demasiado vago)
- "SOLICITAR AL SEÑOR SECRETARIO QUE POR FAVOR ATIENDA EL PROBLEMA DE LA VÍA" (informal, muy largo)

Responde SOLO con el texto del asunto, sin explicaciones ni comillas.`;

    try {
      const r = await new VertexModel(this.ai, MODEL_LEGAL, {
        systemInstruction: SYSTEM_PROMPT_LEGAL,
        temperature: 0.1,
        maxOutputTokens: 60,
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
