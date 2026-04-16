import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Estructura del Distrito de Medellín (fuente: Guía Técnica 2026)
// Usada en clasificación y redacción legal
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
// System prompt del chatbot — corto y directo
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT_CHATBOT = `Eres el asistente de WhatsApp del concejal Andrés Tobón (Medellín). Registras denuncias ciudadanas.

ESTILO: Máximo 1-2 líneas. Una sola pregunta por mensaje. Español colombiano natural.
Si el usuario da varios datos juntos, extráelos todos y continúa con el siguiente que falte.

FLUJO SECUENCIAL ESTRICTO — avanza solo cuando el paso anterior esté completo:
PASO 1: nombre → si falta, pide nombre. "anonimo"/"anónimo" acepta → esAnonimo:true.
PASO 2: cedula → si nombre OK y cedula falta y NO es anónimo, pide cédula (6-10 dígitos).
PASO 3: barrio → si cedula OK (o anónimo), pide el barrio donde ocurrió.
PASO 4: direccion → pide dirección con tipo de vía + número ("Calle 44 #52-49"). Si es vaga, pide exactitud.
PASO 5: confirmar → pregunta si la dirección es correcta. Si dice sí → direccionConfirmada:true.
PASO 6: descripcion → si < 20 palabras, pide más detalle.
PASO 7: evidencia → pregunta por fotos/PDFs una sola vez (es opcional).
PASO 8: resumen y confirmación → muestra resumen compacto y pide confirmación final.
Si confirma (sí/si/ok/1/yes/confirmo) → listaParaRadicar:true, etapaSiguiente:"finalizado".

CASOS ESPECIALES: si menciona corrupción/extorsión/grupos armados/sicariato → etapaSiguiente:"especial_cerrado".

CUANDO TENGAS LA DESCRIPCIÓN DEL PROBLEMA:
Clasifica e incluye en datosExtraidos:
- dependencia: nombre exacto de la secretaría/entidad competente (puede ser múltiple separado por coma si aplica a varias)
  Guía: huecos/vías/puentes→"Secretaría de Infraestructura Física", basura/aseo→"Emvarias", agua/luz/gas→"EPM", tránsito/semáforos→"Secretaría de Movilidad", crimen/inseguridad→"Secretaría de Seguridad y Convivencia", salud/EPS→"Secretaría de Salud", colegio/PAE→"Secretaría de Educación", construcción ilegal→"Secretaría de Gestión y Control Territorial", violencia género→"Secretaría de las Mujeres", emergencias→"DAGRD"
- esEspecial: true si menciona corrupción/extorsión/vacunas/grupos armados/sicariato

RESPONDE ÚNICAMENTE CON JSON VÁLIDO (sin texto extra):
{"respuesta":"...","datosExtraidos":{},"etapaSiguiente":"recopilando","listaParaRadicar":false}`;

// Modelos confirmados disponibles con la API key (verificado 2026-04-16)
// gemini-2.5-flash-lite: estable, sin -preview, responde correctamente en free tier
const MODEL_CHATBOT          = 'gemini-2.5-flash-lite';
const MODEL_CHATBOT_FALLBACK = 'gemini-3.1-flash-lite-preview';
const MODEL_LEGAL            = 'gemini-2.5-flash-lite';

const BASE_CONFIG = { topP: 0.8, topK: 40, maxOutputTokens: 512 };

export interface RespuestaChatbot {
  respuesta: string;
  datosExtraidos: Record<string, unknown>;
  etapaSiguiente: 'recopilando' | 'confirmando' | 'finalizado' | 'especial_cerrado';
  listaParaRadicar: boolean;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenerativeAI;

  private readonly modelClasificacion: GenerativeModel;
  private readonly modelJustificacion: GenerativeModel;
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

    this.logger.log(`GeminiService listo — modelo: ${MODEL_CHATBOT}`);
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

  async clasificarDenuncia(descripcion: string): Promise<{
    esEspecial: boolean;
    dependencia: string;
    justificacionBreve: string;
  }> {
    const prompt = `Denuncia: "${descripcion.substring(0, 400)}"
Clasifica. SOLO JSON: {"esEspecial":bool,"dependencia":"nombre exacto","justificacionBreve":"una oración"}`;

    try {
      const result = await this.modelClasificacion.generateContent(prompt);
      const jsonStr = this.extraerJson(result.response.text());
      if (!jsonStr) throw new Error('sin JSON');
      const p = JSON.parse(jsonStr) as { esEspecial?: boolean; dependencia?: string; justificacionBreve?: string };
      return {
        esEspecial:         p.esEspecial ?? false,
        dependencia:        p.dependencia ?? this.clasificarPorPalabrasClave(descripcion),
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
    // Solo los últimos 10 turnos y solo campos con valor para reducir tokens
    const hist = historial
      .slice(-10)
      .map((m) => `${m.rol === 'user' ? 'U' : 'A'}: ${m.contenido}`)
      .join('\n');

    const datos = Object.fromEntries(
      Object.entries(datosConfirmados).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false),
    );

    const prompt = `HISTORIAL:\n${hist || '(inicio)'}\n\nDATOS: ${JSON.stringify(datos)}\n\nUSUARIO: ${mensaje}\n\nJSON:`;

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
      return {
        respuesta:        p.respuesta ?? '¿Me repites eso?',
        datosExtraidos:   (p.datosExtraidos as Record<string, unknown>) ?? {},
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
  // Generación de sección HECHOS (Entrega 4 — document-service)
  // ---------------------------------------------------------------------------
  async generarHechos(datos: {
    direccion: string;
    barrio: string;
    comuna: string;
    descripcion: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Redacta sección HECHOS para oficio del concejal Andrés Tobón a ${datos.dependencia}.
Ubicación: ${datos.direccion}, barrio ${datos.barrio}, comuna ${datos.comuna}.
Situación: ${datos.descripcion}
Máx 150 palabras. 2-3 párrafos formales. Cita UNA norma colombiana real. Solo texto plano.`;

    const r = await this.modelJustificacion.generateContent(prompt);
    return r.response.text().trim();
  }

  // ---------------------------------------------------------------------------
  // Justificación legal completa (Entrega 4 — document-service)
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
