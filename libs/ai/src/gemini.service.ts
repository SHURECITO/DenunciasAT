import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// Normativa colombiana — usada en modelos de clasificación y redacción legal
const SYSTEM_PROMPT_NORMATIVA = `Eres asistente legal del concejal de Medellín Andrés Tobón. Ayudas a procesar denuncias ciudadanas según normativa colombiana.
Secretarías Medellín: Infraestructura Física, Movilidad, Medio Ambiente, Seguridad y Convivencia, Salud, Educación, Inclusión Social, Desarrollo Económico, Hacienda, Gobierno, Paz y DDHH.
Entidades: EPM, Metro de Medellín, EDU, ISVIMED, INDER, Metroparques, Metrosalud, DAGRD.
Normativa: Const. 1991 Art.23 (petición), Art.313 (concejos), Ley 1437/2011 CPACA, Ley 136/1994.
NUNCA inventes normas ni artículos. Solo normativa colombiana.`;

// System prompt del chatbot — corto y directo para ahorrar tokens
const SYSTEM_PROMPT_CHATBOT = `Eres el asistente de WhatsApp del concejal Andrés Tobón (Medellín). Registras denuncias ciudadanas.

REGLAS:
- Respuestas MUY cortas, máximo 2 líneas. Una sola pregunta a la vez.
- Español colombiano natural. Sin tecnicismos.
- Si el usuario da varios datos juntos, extráelos todos sin volver a pedirlos.
- Si escribe "anonimo": acepta, omite cédula, marca esAnonimo:true.

DATOS A RECOPILAR (en este orden, solo los que falten):
1. nombre (mín 3 letras; "anonimo" es válido)
2. cedula (6-10 dígitos; saltar si esAnonimo)
3. barrio del problema
4. direccion (debe tener tipo de vía + número: "Calle 44 #52-49", "Cra 80 #30-15". Si es vaga pide más exactitud.)
5. confirmar la dirección (pregunta si es correcta)
6. descripcion (mín 20 palabras; si es corta pide más detalle)
7. evidencia (fotos/PDFs, opcional, pregunta una sola vez)

Cuando tengas todo, presenta resumen y pide confirmación.
Si confirma (sí/ok/1): retorna listaParaRadicar:true.
Si el caso involucra corrupción/grupos armados/extorsión/sicariato: retorna etapaSiguiente:"especial_cerrado".

RESPONDE SOLO CON JSON VÁLIDO:
{"respuesta":"...","datosExtraidos":{},"etapaSiguiente":"recopilando","listaParaRadicar":false}`;

// gemini-1.5-flash: free tier con 1500 req/día, mucho más generoso que flash-lite/flash
const MODEL_ID = 'gemini-1.5-flash';
const MODEL_ID_LEGAL = 'gemini-1.5-flash';

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

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.modelClasificacion = this.genAI.getGenerativeModel({
      model: MODEL_ID_LEGAL,
      systemInstruction: SYSTEM_PROMPT_NORMATIVA,
      generationConfig: { ...BASE_CONFIG, temperature: 0.2 },
    });

    this.modelJustificacion = this.genAI.getGenerativeModel({
      model: MODEL_ID_LEGAL,
      systemInstruction: SYSTEM_PROMPT_NORMATIVA,
      generationConfig: { ...BASE_CONFIG, temperature: 0.3 },
    });

    this.modelChatbot = this.genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: SYSTEM_PROMPT_CHATBOT,
      generationConfig: { ...BASE_CONFIG, temperature: 0.3 },
    });

    this.logger.log(`GeminiService inicializado — chatbot: ${MODEL_ID}, legal: ${MODEL_ID_LEGAL}`);
  }

  private clasificarPorPalabrasClave(descripcion: string): string {
    const d = descripcion.toLowerCase();
    if (/hueco|v[ií]a|calle|and[eé]n|pavimento|acera|puente/.test(d)) return 'Secretaría de Infraestructura Física';
    if (/basura|[aá]rbol|quebrada|contaminaci[oó]n|parque|ruido|ambiental/.test(d)) return 'Secretaría de Medio Ambiente';
    if (/pelea|robo|inseguridad|combo|delincuencia|hurto|amenaza|pandilla|violencia/.test(d)) return 'Secretaría de Seguridad y Convivencia';
    if (/acueducto|alcantarillado|agua|luz|energ[ií]a|gas|epm/.test(d)) return 'EPM';
    if (/tr[aá]nsito|sem[aá]foro|movilidad|transporte|bus|metro/.test(d)) return 'Secretaría de Movilidad';
    if (/salud|hospital|cl[ií]nica|eps|m[eé]dico/.test(d)) return 'Secretaría de Salud';
    if (/colegio|escuela|educaci[oó]n|profesor/.test(d)) return 'Secretaría de Educación';
    return 'Secretaría de Gobierno';
  }

  private extraerJson(texto: string): string | null {
    const clean = texto.replace(/```json/g, '').replace(/```/g, '').trim();
    // Buscar el JSON más externo (puede haber texto antes/después)
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return clean.slice(start, end + 1);
  }

  async clasificarDenuncia(descripcion: string): Promise<{
    esEspecial: boolean;
    dependencia: string;
    justificacionBreve: string;
  }> {
    const prompt = `Denuncia Medellín: "${descripcion.substring(0, 300)}"
Responde SOLO JSON: {"esEspecial":bool,"dependencia":"nombre exacto secretaría/entidad","justificacionBreve":"una oración"}`;

    try {
      const result = await this.modelClasificacion.generateContent(prompt);
      const jsonStr = this.extraerJson(result.response.text());
      if (!jsonStr) throw new Error('sin JSON');
      const p = JSON.parse(jsonStr) as { esEspecial?: boolean; dependencia?: string; justificacionBreve?: string };
      return {
        esEspecial: p.esEspecial ?? false,
        dependencia: p.dependencia ?? this.clasificarPorPalabrasClave(descripcion),
        justificacionBreve: p.justificacionBreve ?? '',
      };
    } catch {
      return { esEspecial: false, dependencia: this.clasificarPorPalabrasClave(descripcion), justificacionBreve: '' };
    }
  }

  async procesarMensajeChatbot(
    historial: Array<{ rol: string; contenido: string }>,
    datosConfirmados: Record<string, unknown>,
    mensaje: string,
  ): Promise<RespuestaChatbot> {
    // Solo últimos 10 mensajes y solo campos no nulos/vacíos para ahorrar tokens
    const historialTexto = historial
      .slice(-10)
      .map((m) => `${m.rol === 'user' ? 'U' : 'A'}: ${m.contenido}`)
      .join('\n');

    const datosCompactos = Object.fromEntries(
      Object.entries(datosConfirmados).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false),
    );

    const prompt = `HISTORIAL:
${historialTexto || '(inicio)'}

DATOS RECOGIDOS: ${JSON.stringify(datosCompactos)}

USUARIO: ${mensaje}

Responde SOLO JSON:`;

    try {
      const result = await this.modelChatbot.generateContent(prompt);
      const responseText = result.response.text();
      this.logger.debug(`Gemini chatbot raw: ${responseText.substring(0, 150)}`);

      const jsonStr = this.extraerJson(responseText);
      if (!jsonStr) {
        this.logger.warn('Gemini chatbot sin JSON — fallback');
        return this.fallback(datosConfirmados);
      }

      const p = JSON.parse(jsonStr) as Partial<RespuestaChatbot>;
      return {
        respuesta: p.respuesta ?? '¿Me puedes repetir eso?',
        datosExtraidos: (p.datosExtraidos as Record<string, unknown>) ?? {},
        etapaSiguiente: p.etapaSiguiente ?? 'recopilando',
        listaParaRadicar: p.listaParaRadicar ?? false,
      };
    } catch (err) {
      this.logger.error(`Error Gemini chatbot: ${(err as Error).message}`);
      return this.fallback(datosConfirmados);
    }
  }

  private fallback(datosConfirmados: Record<string, unknown>): RespuestaChatbot {
    return {
      respuesta: 'Un momento, tuve un inconveniente. ¿Me repites tu mensaje? 🙏',
      datosExtraidos: {},
      etapaSiguiente: (datosConfirmados['etapa'] as RespuestaChatbot['etapaSiguiente']) ?? 'recopilando',
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
    const prompt = `Resume en 1-2 oraciones esta denuncia para registro interno. Sin markdown.
Ciudadano: ${datos.nombre ?? 'Anónimo'}, Barrio: ${datos.barrio ?? '-'}, Dirección: ${datos.direccion ?? '-'}
Problema: ${(datos.descripcion ?? '').substring(0, 200)}
Entidad: ${datos.dependencia ?? '-'}`;

    try {
      const result = await this.modelJustificacion.generateContent(prompt);
      return result.response.text().trim();
    } catch {
      return (datos.descripcion ?? '').substring(0, 200);
    }
  }

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
2-3 párrafos formales, máx 150 palabras, cita UNA norma colombiana real. Solo texto, sin markdown.`;

    const result = await this.modelJustificacion.generateContent(prompt);
    return result.response.text().trim();
  }

  async generarJustificacionLegal(datos: {
    nombre: string;
    descripcion: string;
    ubicacion: string;
    dependencia: string;
  }): Promise<string> {
    const prompt = `Justificación legal para oficio del concejal Andrés Tobón a ${datos.dependencia}.
Ubicación: ${datos.ubicacion}. Descripción: ${datos.descripcion}
Máx 3 párrafos, normativa colombiana, tono formal.`;

    const result = await this.modelJustificacion.generateContent(prompt);
    return result.response.text();
  }
}
