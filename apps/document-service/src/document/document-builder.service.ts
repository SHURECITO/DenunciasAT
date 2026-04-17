import { Injectable, Logger } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from 'docx';
import { writeFile } from 'fs/promises';
import type { DenunciaData } from './dashboard-api.service';

// ─── Mapeo dependencia → destinatario ───────────────────────────────────────
const DESTINATARIOS: Record<string, { cargo: string; nombreMayus: string; genero: 'M' | 'F' }> = {
  'Secretaría de Infraestructura Física': {
    cargo: 'Secretario de Infraestructura Física',
    nombreMayus: 'SECRETARIO(A) DE INFRAESTRUCTURA FÍSICA',
    genero: 'M',
  },
  'Secretaría de Movilidad': {
    cargo: 'Secretario de Movilidad',
    nombreMayus: 'SECRETARIO(A) DE MOVILIDAD',
    genero: 'M',
  },
  'Secretaría de Medio Ambiente': {
    cargo: 'Secretaria de Medio Ambiente',
    nombreMayus: 'SECRETARIA DE MEDIO AMBIENTE',
    genero: 'F',
  },
  'Secretaría de Seguridad y Convivencia': {
    cargo: 'Secretario de Seguridad y Convivencia',
    nombreMayus: 'SECRETARIO(A) DE SEGURIDAD Y CONVIVENCIA',
    genero: 'M',
  },
  'Secretaría de Salud': {
    cargo: 'Secretaria de Salud',
    nombreMayus: 'SECRETARIA DE SALUD',
    genero: 'F',
  },
  'Secretaría de Educación': {
    cargo: 'Secretaria de Educación',
    nombreMayus: 'SECRETARIA DE EDUCACIÓN',
    genero: 'F',
  },
  'Secretaría de Gestión y Control Territorial': {
    cargo: 'Secretario de Gestión y Control Territorial',
    nombreMayus: 'SECRETARIO(A) DE GESTIÓN Y CONTROL TERRITORIAL',
    genero: 'M',
  },
  'Secretaría de las Mujeres': {
    cargo: 'Secretaria de las Mujeres',
    nombreMayus: 'SECRETARIA DE LAS MUJERES',
    genero: 'F',
  },
  'Secretaría de Inclusión Social, Familia y DDHH': {
    cargo: 'Secretaria de Inclusión Social, Familia y DDHH',
    nombreMayus: 'SECRETARIA DE INCLUSIÓN SOCIAL, FAMILIA Y DDHH',
    genero: 'F',
  },
  'Secretaría de Participación Ciudadana': {
    cargo: 'Secretario de Participación Ciudadana',
    nombreMayus: 'SECRETARIO(A) DE PARTICIPACIÓN CIUDADANA',
    genero: 'M',
  },
  'Secretaría de Desarrollo Económico': {
    cargo: 'Secretario de Desarrollo Económico',
    nombreMayus: 'SECRETARIO(A) DE DESARROLLO ECONÓMICO',
    genero: 'M',
  },
  'Secretaría de la Juventud': {
    cargo: 'Secretario de la Juventud',
    nombreMayus: 'SECRETARIO(A) DE LA JUVENTUD',
    genero: 'M',
  },
  'Secretaría de Cultura Ciudadana': {
    cargo: 'Secretario de Cultura Ciudadana',
    nombreMayus: 'SECRETARIO(A) DE CULTURA CIUDADANA',
    genero: 'M',
  },
  'Secretaría de Paz y Derechos Humanos': {
    cargo: 'Secretario de Paz y Derechos Humanos',
    nombreMayus: 'SECRETARIO(A) DE PAZ Y DERECHOS HUMANOS',
    genero: 'M',
  },
  'Secretaría de Gestión Humana y Servicio a la Ciudadanía': {
    cargo: 'Secretaria de Gestión Humana',
    nombreMayus: 'SECRETARIA DE GESTIÓN HUMANA Y SERVICIO A LA CIUDADANÍA',
    genero: 'F',
  },
  EPM: {
    cargo: 'Gerente General',
    nombreMayus: 'GERENTE GENERAL DE EPM',
    genero: 'M',
  },
  Emvarias: {
    cargo: 'Gerente General',
    nombreMayus: 'GERENTE GENERAL DE EMVARIAS',
    genero: 'M',
  },
  'Metro de Medellín': {
    cargo: 'Gerente General',
    nombreMayus: 'GERENTE GENERAL DEL METRO DE MEDELLÍN',
    genero: 'M',
  },
  INDER: {
    cargo: 'Director General',
    nombreMayus: 'DIRECTOR DEL INSTITUTO DE DEPORTES Y RECREACIÓN',
    genero: 'M',
  },
  EDU: {
    cargo: 'Gerente General',
    nombreMayus: 'GERENTE DE LA EMPRESA DE DESARROLLO URBANO',
    genero: 'M',
  },
  ISVIMED: {
    cargo: 'Gerente General',
    nombreMayus: 'GERENTE GENERAL DE ISVIMED',
    genero: 'M',
  },
  DAGRD: {
    cargo: 'Director',
    nombreMayus: 'DIRECTOR DEL DAGRD',
    genero: 'M',
  },
};

// ─── Helpers de formato ──────────────────────────────────────────────────────
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatFecha(isoDate: string): string {
  const d = new Date(isoDate);
  return `Medellín, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Convierte cm a DXA (twips) — 1 cm = 567 DXA
const cm = (v: number) => Math.round(v * 567);

// Párrafo de texto simple con opciones
function p(
  texto: string,
  opts: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacingAfter?: number;
    spacingBefore?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.LEFT,
    spacing: {
      after: opts.spacingAfter ?? 0,
      before: opts.spacingBefore ?? 0,
      line: 276, // ≈ 1.15 interlineado
    },
    children: [
      new TextRun({
        text: texto,
        bold: opts.bold ?? false,
        italics: opts.italic ?? false,
        font: 'Arial',
        size: (opts.size ?? 11) * 2, // half-points
      }),
    ],
  });
}

export interface BuildInput {
  denuncia: DenunciaData;
  hechos: string;
  rutaDestino: string;
}

@Injectable()
export class DocumentBuilderService {
  private readonly logger = new Logger(DocumentBuilderService.name);

  async construir(input: BuildInput): Promise<void> {
    const { denuncia, hechos, rutaDestino } = input;
    mkdirSync(dirname(rutaDestino), { recursive: true });

    const dependencia = denuncia.dependenciaAsignada ?? 'la entidad competente';

    // Determinar destinatario
    // La dependenciaAsignada puede ser "EPM, Emvarias" — usar la primera
    const depPrimaria = dependencia.split(',')[0].trim();
    const dest = DESTINATARIOS[depPrimaria] ?? {
      cargo: 'Director/a',
      nombreMayus: depPrimaria.toUpperCase(),
      genero: 'M' as const,
    };
    const tratamiento = dest.genero === 'F' ? 'Doctora,' : 'Doctor,';

    const fechaStr = formatFecha(denuncia.fechaCreacion);
    const resumen = (denuncia.descripcionResumen ?? denuncia.descripcion.substring(0, 120)).toUpperCase();

    // ── Secciones ────────────────────────────────────────────────────────────
    const secciones: Paragraph[] = [];

    // Radicado (derecha)
    secciones.push(p(denuncia.radicado, { align: AlignmentType.RIGHT, spacingAfter: 200 }));

    // Ciudad y fecha
    secciones.push(p(fechaStr, { spacingAfter: 400 }));

    // Destinatario
    secciones.push(p(tratamiento));
    secciones.push(p(dest.nombreMayus, { bold: true }));
    secciones.push(p(dest.cargo));
    secciones.push(p(dependencia));
    secciones.push(p('Ciudad', { spacingAfter: 400 }));

    // Asunto
    secciones.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 400, line: 276 },
        children: [
          new TextRun({ text: 'ASUNTO: ', bold: true, font: 'Arial', size: 22 }),
          new TextRun({ text: resumen, font: 'Arial', size: 22 }),
        ],
      }),
    );

    // Saludo de apertura
    secciones.push(
      p(
        `Respetado/a doctor/a, en mi calidad de concejal de la ciudad de Medellín, me dirijo a su despacho con el fin de que se garantice una solución a la siguiente problemática:`,
        { align: AlignmentType.JUSTIFIED, spacingAfter: 300 },
      ),
    );

    // Título HECHOS
    secciones.push(p('HECHOS', { bold: true, align: AlignmentType.CENTER, spacingAfter: 200 }));

    // Párrafos de hechos generados por Gemini
    const parrafosHechos = hechos.split(/\n\n+/).filter((t) => t.trim());
    for (const pHechos of parrafosHechos) {
      secciones.push(p(pHechos.trim(), { align: AlignmentType.JUSTIFIED, spacingAfter: 200 }));
    }

    // Título SOLICITUD
    secciones.push(p('SOLICITUD', { bold: true, align: AlignmentType.CENTER, spacingAfter: 200 }));

    // Solicitudes numeradas
    const solicitudes = [
      `1. Se realice una visita en el lugar ya mencionado con el fin de verificar la situación crítica reportada por el ciudadano.`,
      `2. Se me informe sobre las acciones a implementar por parte de ${depPrimaria} para dar solución efectiva a la problemática planteada.`,
      `3. Se garantice una respuesta oportuna conforme a los términos establecidos en el artículo 30 de la Ley 1755 de 2015, que establece un término máximo de diez (10) días para responder solicitudes entre autoridades.`,
    ];
    for (const sol of solicitudes) {
      secciones.push(p(sol, { align: AlignmentType.JUSTIFIED, spacingAfter: 160 }));
    }

    // Espacio extra tras solicitudes
    secciones.push(p('', { spacingAfter: 140 }));

    // Cierre legal — párrafo 1
    secciones.push(
      p(
        'Agradezco de antemano su pronta respuesta a esta solicitud, la cual realizo en ejercicio de mis funciones como concejal. Es importante resaltar que la información solicitada es de acceso público, ya que no está sujeta a reserva sumarial. Asimismo, conforme al artículo 32, numeral 2, de la Ley 136 de 1994, los Concejos Municipales tienen la facultad de requerir informes escritos a los funcionarios municipales sobre asuntos relacionados con la marcha del Municipio.',
        { align: AlignmentType.JUSTIFIED, spacingAfter: 200 },
      ),
    );

    // Cierre legal — párrafo 2
    secciones.push(
      p(
        'De igual manera, de acuerdo con lo establecido en el artículo 30 de la Ley 1755 de 2015: "Cuando una autoridad formule una solicitud de información o de documentos a otra, esta deberá dar respuesta en un término no mayor a diez (10) días".',
        { align: AlignmentType.JUSTIFIED, spacingAfter: 400 },
      ),
    );

    // Notificación
    secciones.push(
      p(
        'Notificación: Recibo la notificación y correspondencia en las instalaciones del Concejo de Medellín, o por medio magnético a mi correo electrónico: atobon@concejodemedellin.gov.co',
        { align: AlignmentType.JUSTIFIED, spacingAfter: 600 },
      ),
    );

    // Firma
    secciones.push(p('Atentamente,', { align: AlignmentType.CENTER, spacingAfter: 800 }));
    secciones.push(p('ANDRÉS TOBÓN VILLA', { bold: true, align: AlignmentType.CENTER }));
    secciones.push(p('Concejal de Medellín', { align: AlignmentType.CENTER, spacingAfter: 200 }));
    secciones.push(p('Radicó: Equipo DenunciasAT', { align: AlignmentType.CENTER, size: 10, spacingAfter: 400 }));

    // ── Documento ────────────────────────────────────────────────────────────
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 22 },
            paragraph: { spacing: { line: 276 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 }, // A4 en DXA
              margin: {
                top: cm(2.5),
                bottom: cm(2.5),
                left: cm(2.5),
                right: cm(2.5),
              },
            },
          },
          children: secciones,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    await writeFile(rutaDestino, buffer);
  }
}
