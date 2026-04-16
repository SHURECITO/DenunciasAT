import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// Normativa colombiana definida una sola vez — se inyecta como systemInstruction
// en cada instancia de modelo creada con getModel()
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

const MODEL_ID = 'gemini-2.0-flash-lite';

const BASE_GENERATION_CONFIG = {
  topP: 0.8,
  topK: 40,
  maxOutputTokens: 1024,
};

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenerativeAI;

  // Instancias de modelo pre-configuradas con el system prompt (reutilizadas en cada llamada)
  private readonly modelClasificacion: GenerativeModel;
  private readonly modelJustificacion: GenerativeModel;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.genAI = new GoogleGenerativeAI(apiKey);

    // Temperatura 0.2 para clasificación (máxima consistencia)
    this.modelClasificacion = this.genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: SYSTEM_PROMPT_NORMATIVA,
      generationConfig: { ...BASE_GENERATION_CONFIG, temperature: 0.2 },
    });

    // Temperatura 0.3 para redacción legal
    this.modelJustificacion = this.genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: SYSTEM_PROMPT_NORMATIVA,
      generationConfig: { ...BASE_GENERATION_CONFIG, temperature: 0.3 },
    });

    this.logger.log(`GeminiService inicializado con modelo ${MODEL_ID}`);
  }

  async clasificarDenuncia(descripcion: string): Promise<{
    esEspecial: boolean;
    dependencia: string;
    justificacionBreve: string;
  }> {
    const prompt = `Analiza esta denuncia ciudadana de Medellín Colombia.

Denuncia: ${descripcion}

Clasifica y responde SOLO con JSON sin markdown:
{
  "esEspecial": boolean (true si involucra corrupción, amenazas, grupos armados, extorsión, seguridad sensible),
  "dependencia": "nombre exacto de la secretaría o entidad de Medellín competente",
  "justificacionBreve": "una sola oración explicando por qué esa dependencia"
}`;

    const result = await this.modelClasificacion.generateContent(prompt);
    const content = result.response.text();

    // Extrae el JSON (puede venir con markdown ```json ... ```)
    const match = content.match(/\{[\s\S]*?\}/);
    if (!match) {
      return { esEspecial: false, dependencia: 'Sin asignar', justificacionBreve: '' };
    }

    try {
      const parsed = JSON.parse(match[0]) as {
        esEspecial?: boolean;
        dependencia?: string;
        justificacionBreve?: string;
      };
      return {
        esEspecial: parsed.esEspecial ?? false,
        dependencia: parsed.dependencia ?? 'Sin asignar',
        justificacionBreve: parsed.justificacionBreve ?? '',
      };
    } catch {
      return { esEspecial: false, dependencia: 'Sin asignar', justificacionBreve: '' };
    }
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
