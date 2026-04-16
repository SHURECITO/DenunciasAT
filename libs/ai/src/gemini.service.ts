import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// Normativa colombiana — inyectada como systemInstruction en modelos legales
const SYSTEM_PROMPT_NORMATIVA = `Eres un asistente legal especializado en derecho administrativo colombiano al servicio de la ciudadanía, que denuncia ante el equipo del concejal de Medellín Andrés Tobón. Tu función es ayudar a procesar denuncias ciudadanas y que lo que la gente denuncie se pueda tramitar ante la administración.

MARCO NORMATIVO QUE DEBES APLICAR SIEMPRE:

Constitución Política de Colombia 1991:
- Art. 23: Derecho de petición
- Art. 40: Participación ciudadana
- Art. 313: Funciones de los concejos municipales

Ley 1437 de 2011 (CPACA):
- Código de Procedimiento Administrativo y de lo Contencioso Administrativo
- Regula el derecho de petición y las actuaciones administrativas

Ley 134 de 1994: Mecanismos de participación ciudadana

Acuerdo 79 de 2003: Código de Convivencia de Medellín

Decreto 1066 de 2015: Sector Administrativo del Interior

Ley 136 de 1994: Organización y funcionamiento de los municipios colombianos

Para Medellín específicamente:
- Las secretarías del nivel central: Secretaría de Infraestructura Física, Secretaría de Movilidad, Secretaría de Medio Ambiente, Secretaría de Seguridad y Convivencia, Secretaría de Salud, Secretaría de Educación, Secretaría de Inclusión Social y Familia, Secretaría de Desarrollo Económico, Secretaría de Hacienda, Secretaría de Gobierno, Secretaría de Paz y DDHH
- Entidades descentralizadas: EPM, Metro de Medellín, EDU (Empresa de Desarrollo Urbano), ISVIMED, INDER, Metroparques, Metrosalud, DAGRD

REGLAS ESTRICTAS ANTI-ALUCINACIÓN:
- NUNCA inventes números de normas, artículos o leyes
- Si no conoces la norma exacta, cita el principio general sin inventar el número
- SOLO aplica normativa colombiana, nunca de otros países
- Si la situación no tiene norma clara, indícalo expresamente
- Siempre cita la fuente normativa de cada afirmación

TONO Y ESTILO:
- Trato respetuoso y cercano, español colombiano natural
- Nunca uses tecnicismos sin explicarlos
- Sé conciso: respuestas cortas y directas
- El ciudadano no es abogado, explica en términos simples
- Muestra empatía genuina con la problemática
- El ciudadano solo quiere denunciar, entonces no le hables de términos que no tengan relación`;

// System prompt para el chatbot conversacional — parte estática (nunca cambia)
const SYSTEM_PROMPT_CHATBOT = `Eres el asistente virtual del concejal de Medellín Andrés Tobón. Tu función es recibir denuncias y solicitudes ciudadanas de forma conversacional, amigable y en español colombiano natural.

PERSONALIDAD:
- Cercano, empático y profesional
- Respuestas CORTAS (máximo 2-3 líneas por mensaje)
- Una sola pregunta por mensaje, nunca varias
- Si el usuario da varios datos de una, extráelos todos y confirma brevemente antes de seguir
- Usa emojis con moderación (máximo 1 por mensaje)
- Nunca uses tecnicismos legales con el ciudadano
- Si el usuario está molesto o frustrado, primero valida su emoción antes de pedir datos

DATOS QUE DEBES RECOPILAR EN ORDEN:
1. Nombre completo (si escribe 'anonimo' acepta y continúa)
2. Cédula (6-10 dígitos, solo números) — omitir si es anónimo
3. Barrio donde ocurrió el problema
4. Comuna (puedes inferirla del barrio si la conoces, no preguntes si puedes inferirla)
5. Dirección exacta (debe ser una dirección válida de Medellín: tipo de vía + número, ej: Calle 44 #52-49, Carrera 80 #30-15)
6. Confirmación de la dirección
7. Descripción del problema (pide detalles, entre más mejor)
8. Evidencia fotográfica o documentos (opcional — pregunta una sola vez)

VALIDACIONES QUE DEBES APLICAR:
- Nombre: mínimo 3 caracteres, solo letras y espacios. Si escribe 'anonimo' o 'anónimo': acepta, establece esAnonimo:true, omite el paso de cédula.
- Cédula: 6-10 dígitos numéricos. Si es anónimo omite este paso.
- Dirección: debe mencionar tipo de vía (calle, carrera, avenida, diagonal, transversal, circular) seguido de números. Ejemplos válidos: 'Calle 44 #52-49', 'Cra 80 30-15', 'Av El Poblado 34-20'. Ejemplos INVÁLIDOS: 'cerca al parque', 'mi casa', 'por allá arriba'. Si la dirección es vaga, pide que sea más específico amablemente.
- Descripción: mínimo 20 palabras. Si es muy corta pide más detalles con curiosidad genuina.

CLASIFICACIÓN AUTOMÁTICA (interna, no le digas al usuario):
Cuando tengas la descripción, determina:
- esEspecial: true si menciona corrupción, amenazas, grupos armados, extorsión, sicariato, vacunas (cobro ilegal)
- dependencia: secretaría o entidad de Medellín competente (Infraestructura, Movilidad, Medio Ambiente, Seguridad y Convivencia, Salud, Educación, Inclusión Social, Desarrollo Económico, Hacienda, Gobierno, EPM, Metro, EDU, ISVIMED, INDER, Metroparques, Metrosalud, DAGRD)

ANONIMATO:
- NUNCA ofrezcas el anonimato proactivamente
- Si el usuario escribe 'anonimo'/'anónimo' como nombre: acepta, omite la cédula, guarda esAnonimo:true

FLUJO DE CONFIRMACIÓN:
Cuando tengas TODOS los datos (nombre/anónimo, cédula si aplica, barrio, dirección confirmada, descripción suficiente), presenta un resumen ordenado y pide confirmación. Solo cuando el usuario confirme (sí/si/yes/confirmo/ok/1), retorna listaParaRadicar:true.

NUNCA inventes normas ni números de artículos.`;

const MODEL_ID = 'gemini-2.0-flash';

const BASE_GENERATION_CONFIG = {
  topP: 0.8,
  topK: 40,
  maxOutputTokens: 1024,
};

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

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.modelClasificacion = this.genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: SYSTEM_PROMPT_NORMATIVA,
      generationConfig: { ...BASE_GENERATION_CONFIG, temperature: 0.2 },
    });

    this.modelJustificacion = this.genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: SYSTEM_PROMPT_NORMATIVA,
      generationConfig: { ...BASE_GENERATION_CONFIG, temperature: 0.3 },
    });

    // Modelo chatbot con temperatura 0.3 para respuestas consistentes pero naturales
    this.modelChatbot = this.genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: SYSTEM_PROMPT_CHATBOT,
      generationConfig: { ...BASE_GENERATION_CONFIG, temperature: 0.3, maxOutputTokens: 512 },
    });

    this.logger.log(`GeminiService inicializado con modelo ${MODEL_ID}`);
  }

  private clasificarPorPalabrasClave(descripcion: string): string {
    const d = descripcion.toLowerCase();
    if (/hueco|v[ií]a|calle|and[eé]n|pavimento|acera|puente|infraestructura/.test(d))
      return 'Secretaría de Infraestructura Física';
    if (/basura|[aá]rbol|quebrada|contaminaci[oó]n|parque|aire|ruido|ambiental/.test(d))
      return 'Secretaría de Medio Ambiente';
    if (/pelea|robo|inseguridad|combo|delincuencia|hurto|amenaza|pandilla|violencia/.test(d))
      return 'Secretaría de Seguridad y Convivencia';
    if (/acueducto|alcantarillado|agua|luz|energ[ií]a|gas|epm|servicio p[uú]blico/.test(d))
      return 'EPM';
    if (/tr[aá]nsito|sem[aá]foro|movilidad|transporte|bus|metro|paradero/.test(d))
      return 'Secretaría de Movilidad';
    if (/salud|hospital|cl[ií]nica|eps|vacun[ao]|m[eé]dico/.test(d))
      return 'Secretaría de Salud';
    if (/colegio|escuela|educaci[oó]n|profesor|estudiante/.test(d))
      return 'Secretaría de Educación';
    return 'Secretaría de Gobierno';
  }

  private extraerJson(texto: string): string | null {
    const clean = texto.replace(/```json/g, '').replace(/```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
  }

  async clasificarDenuncia(descripcion: string): Promise<{
    esEspecial: boolean;
    dependencia: string;
    justificacionBreve: string;
  }> {
    this.logger.log(`Enviando a Gemini clasificación: ${descripcion.substring(0, 80)}...`);

    const prompt = `Analiza esta denuncia ciudadana de Medellín Colombia.

Denuncia: ${descripcion}

Clasifica y responde SOLO con JSON sin markdown:
{
  "esEspecial": boolean,
  "dependencia": "nombre exacto de la secretaría o entidad de Medellín competente",
  "justificacionBreve": "una sola oración explicando por qué esa dependencia"
}`;

    try {
      const result = await this.modelClasificacion.generateContent(prompt);
      const responseText = result.response.text();
      this.logger.debug(`Respuesta raw Gemini clasificación: ${responseText}`);

      const jsonStr = this.extraerJson(responseText);
      if (!jsonStr) {
        this.logger.warn('Gemini no devolvió JSON válido — usando clasificación por palabras clave');
        return { esEspecial: false, dependencia: this.clasificarPorPalabrasClave(descripcion), justificacionBreve: '' };
      }

      const parsed = JSON.parse(jsonStr) as {
        esEspecial?: boolean;
        dependencia?: string;
        justificacionBreve?: string;
      };
      return {
        esEspecial: parsed.esEspecial ?? false,
        dependencia: parsed.dependencia ?? this.clasificarPorPalabrasClave(descripcion),
        justificacionBreve: parsed.justificacionBreve ?? '',
      };
    } catch (err) {
      this.logger.warn(`Error Gemini clasificación (${(err as Error).message}) — usando palabras clave`);
      return { esEspecial: false, dependencia: this.clasificarPorPalabrasClave(descripcion), justificacionBreve: '' };
    }
  }

  async procesarMensajeChatbot(
    historial: Array<{ rol: string; contenido: string }>,
    datosConfirmados: Record<string, unknown>,
    mensaje: string,
  ): Promise<RespuestaChatbot> {
    const historialTexto = historial
      .slice(-20)
      .map((m) => `${m.rol === 'user' ? 'CIUDADANO' : 'ASISTENTE'}: ${m.contenido}`)
      .join('\n');

    const prompt = `CONVERSACIÓN HASTA AHORA:
${historialTexto || '(inicio de conversación)'}

DATOS YA CONFIRMADOS:
${JSON.stringify(datosConfirmados, null, 2)}

MENSAJE ACTUAL DEL CIUDADANO: ${mensaje}

INSTRUCCIONES:
1. Analiza el mensaje y extrae cualquier dato útil
2. Valida los datos según las reglas del sistema
3. Si hay datos inválidos, corrígelos amablemente
4. Determina qué dato falta pedir según el orden establecido
5. Si ya tienes TODOS los datos y etapa es 'recopilando', genera el resumen de confirmación y cambia etapa a 'confirmando'
6. Si etapa es 'confirmando' y el usuario confirma (sí/si/yes/ok/confirmo/1), retorna listaParaRadicar:true y etapaSiguiente:'finalizado'
7. Si detectas que el caso es especial (corrupción/amenazas/grupos armados), retorna etapaSiguiente:'especial_cerrado'

RESPONDE ÚNICAMENTE CON JSON VÁLIDO (sin markdown, sin texto extra):
{
  "respuesta": "texto para enviar al ciudadano",
  "datosExtraidos": {},
  "etapaSiguiente": "recopilando",
  "listaParaRadicar": false
}`;

    try {
      const result = await this.modelChatbot.generateContent(prompt);
      const responseText = result.response.text();
      this.logger.debug(`Respuesta raw Gemini chatbot: ${responseText.substring(0, 200)}`);

      const jsonStr = this.extraerJson(responseText);
      if (!jsonStr) {
        this.logger.warn('Gemini chatbot no devolvió JSON — usando respuesta de fallback');
        return this.fallbackChatbot(datosConfirmados);
      }

      const parsed = JSON.parse(jsonStr) as Partial<RespuestaChatbot>;
      return {
        respuesta: parsed.respuesta ?? 'Disculpa, no entendí. ¿Puedes repetirlo?',
        datosExtraidos: (parsed.datosExtraidos as Record<string, unknown>) ?? {},
        etapaSiguiente: parsed.etapaSiguiente ?? 'recopilando',
        listaParaRadicar: parsed.listaParaRadicar ?? false,
      };
    } catch (err) {
      this.logger.error(`Error Gemini chatbot: ${(err as Error).message}`);
      return this.fallbackChatbot(datosConfirmados);
    }
  }

  private fallbackChatbot(datosConfirmados: Record<string, unknown>): RespuestaChatbot {
    const etapa = (datosConfirmados['etapa'] as string) ?? 'recopilando';
    return {
      respuesta: 'Tuve un problema técnico. ¿Puedes repetir tu mensaje? 🙏',
      datosExtraidos: {},
      etapaSiguiente: etapa as RespuestaChatbot['etapaSiguiente'],
      listaParaRadicar: false,
    };
  }

  async generarResumen(datos: {
    nombre?: string;
    barrio?: string;
    direccion?: string;
    descripcion?: string;
    dependencia?: string;
  }): Promise<string> {
    const prompt = `Resume en máximo 2 oraciones la siguiente denuncia ciudadana para el registro interno del despacho del concejal Andrés Tobón. Sé objetivo y directo. No uses markdown.

Ciudadano: ${datos.nombre ?? 'Anónimo'}
Barrio: ${datos.barrio ?? 'No especificado'}
Dirección: ${datos.direccion ?? 'No especificada'}
Problema: ${datos.descripcion ?? ''}
Dirigido a: ${datos.dependencia ?? 'Por determinar'}`;

    try {
      const result = await this.modelJustificacion.generateContent(prompt);
      return result.response.text().trim();
    } catch (err) {
      this.logger.warn(`Error generando resumen: ${(err as Error).message}`);
      return datos.descripcion?.substring(0, 200) ?? '';
    }
  }

  async generarHechos(datos: {
    direccion: string;
    barrio: string;
    comuna: string;
    descripcion: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Redacta la sección HECHOS para un oficio del concejal Andrés Tobón dirigido a ${datos.dependencia} de Medellín.

Situación reportada por el ciudadano:
Ubicación: ${datos.direccion}, barrio ${datos.barrio}, comuna ${datos.comuna}
Descripción: ${datos.descripcion}

Redacta 2-3 párrafos formales que:
1. Describan la situación de forma objetiva
2. Mencionen el impacto en la comunidad
3. Citen UNA norma colombiana aplicable que conozcas con certeza (no inventes números)

Máximo 150 palabras. Tono formal pero comprensible.
Responde SOLO con el texto, sin títulos ni markdown.`;

    const result = await this.modelJustificacion.generateContent(prompt);
    return result.response.text().trim();
  }

  async generarJustificacionLegal(datos: {
    nombre: string;
    descripcion: string;
    ubicacion: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Redacta la justificación legal para un oficio del concejal Andrés Tobón dirigido a ${datos.dependencia}.

Ubicación: ${datos.ubicacion}
Descripción: ${datos.descripcion}

La justificación debe:
1. Describir los hechos en 2-3 oraciones formales
2. Citar las normas colombianas aplicables del contexto
3. Fundamentar la competencia de ${datos.dependencia}
4. Solicitar formalmente la intervención

Extensión máxima: 3 párrafos
Tono: formal, jurídico pero comprensible
SOLO normativa colombiana`;

    const result = await this.modelJustificacion.generateContent(prompt);
    return result.response.text();
  }
}
