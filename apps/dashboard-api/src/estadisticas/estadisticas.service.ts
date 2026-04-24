import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class EstadisticasService implements OnModuleInit {
  private readonly logger = new Logger(EstadisticasService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS stats_por_estado AS
        SELECT estado::text, COUNT(*)::int AS total
        FROM denuncias
        GROUP BY estado
      `);
      await runner.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS stats_por_dependencia AS
        SELECT
          COALESCE("dependenciaAsignada", 'Sin asignar') AS dependencia,
          COUNT(*)::int AS total,
          COUNT(CASE WHEN estado = 'CON_RESPUESTA' THEN 1 END)::int AS resueltas
        FROM denuncias
        GROUP BY COALESCE("dependenciaAsignada", 'Sin asignar')
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Vistas materializadas (ya existen o error menor): ${msg}`);
    } finally {
      await runner.release();
    }
  }

  private buildWhere(
    desde?: string,
    hasta?: string,
  ): { clause: string; params: string[] } {
    const conds: string[] = [];
    const params: string[] = [];

    if (desde) {
      params.push(desde);
      conds.push(`"fechaCreacion" >= $${params.length}::timestamptz`);
    }
    if (hasta) {
      params.push(hasta);
      conds.push(
        `"fechaCreacion" < $${params.length}::timestamptz + INTERVAL '1 day'`,
      );
    }

    return {
      clause: conds.length ? 'WHERE ' + conds.join(' AND ') : '',
      params,
    };
  }

  private async withRunner<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      return await fn(runner);
    } finally {
      await runner.release();
    }
  }

  private async refreshVistas(runner: QueryRunner) {
    await runner.query('REFRESH MATERIALIZED VIEW stats_por_estado');
    await runner.query('REFRESH MATERIALIZED VIEW stats_por_dependencia');
  }

  async getResumen(desde?: string, hasta?: string) {
    return this.withRunner(async (runner) => {
      await this.refreshVistas(runner);
      const { clause, params } = this.buildWhere(desde, hasta);

      const rows: Record<string, number | null>[] = await runner.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN estado = 'RECIBIDA' THEN 1 END)::int AS recibida,
          COUNT(CASE WHEN estado = 'EN_GESTION' THEN 1 END)::int AS en_gestion,
          COUNT(CASE WHEN estado = 'RADICADA' THEN 1 END)::int AS radicada,
          COUNT(CASE WHEN estado = 'CON_RESPUESTA' THEN 1 END)::int AS con_respuesta,
          COUNT(CASE WHEN "esEspecial" = true THEN 1 END)::int AS especiales,
          COUNT(CASE WHEN "origenManual" = true THEN 1 END)::int AS manuales,
          COUNT(CASE WHEN estado != 'CON_RESPUESTA'
            AND "fechaActualizacion" < NOW() - INTERVAL '15 days' THEN 1 END)::int AS estancados,
          ROUND(
            AVG(
              CASE WHEN estado = 'CON_RESPUESTA'
              THEN EXTRACT(EPOCH FROM ("fechaActualizacion" - "fechaCreacion")) / 86400
              END
            )::numeric, 1
          )::float AS promedio_dias
        FROM denuncias ${clause}`,
        params,
      );

      const r = rows[0];
      const total = (r.total as number) || 0;
      const conRespuesta = (r.con_respuesta as number) || 0;

      return {
        totalDenuncias: total,
        porEstado: {
          RECIBIDA: (r.recibida as number) || 0,
          EN_GESTION: (r.en_gestion as number) || 0,
          RADICADA: (r.radicada as number) || 0,
          CON_RESPUESTA: conRespuesta,
        },
        especiales: (r.especiales as number) || 0,
        manuales: (r.manuales as number) || 0,
        tasaResolucion:
          total > 0 ? Math.round((conRespuesta / total) * 1000) / 10 : 0,
        casosEstancados: (r.estancados as number) || 0,
        tiempoPromedioResolucion: r.promedio_dias ?? null,
      };
    });
  }

  async getPorDependencia(desde?: string, hasta?: string) {
    return this.withRunner(async (runner) => {
      const { clause, params } = this.buildWhere(desde, hasta);

      // Cuando una denuncia tiene múltiples dependencias concatenadas con coma
      // ("Sec. A, Sec. B, Emvarias"), unnest las separa y cuenta cada una por separado.
      // Se excluyen denuncias especiales que no pasan por el flujo normal.
      const whereExtra = clause
        ? `${clause} AND "esEspecial" = false AND "dependenciaAsignada" IS NOT NULL`
        : `WHERE "esEspecial" = false AND "dependenciaAsignada" IS NOT NULL`;

      const rows: { dependencia: string; total: number; resueltas: number }[] =
        await runner.query(
          `WITH dependencias_separadas AS (
            SELECT
              TRIM(unnest(string_to_array("dependenciaAsignada", ','))) AS dependencia,
              estado
            FROM denuncias
            ${whereExtra}
          )
          SELECT
            dependencia,
            COUNT(*)::int AS total,
            COUNT(CASE WHEN estado = 'CON_RESPUESTA' THEN 1 END)::int AS resueltas
          FROM dependencias_separadas
          WHERE dependencia <> ''
          GROUP BY dependencia
          ORDER BY total DESC`,
          params,
        );

      return rows.map((r) => ({
        dependencia: r.dependencia,
        total: r.total,
        resueltas: r.resueltas,
        porcentajeResolucion:
          r.total > 0 ? Math.round((r.resueltas / r.total) * 1000) / 10 : 0,
      }));
    });
  }

  async getPorPeriodo(
    desde?: string,
    hasta?: string,
    agrupacion: 'semana' | 'mes' = 'mes',
  ) {
    return this.withRunner(async (runner) => {
      const trunc = agrupacion === 'semana' ? 'week' : 'month';
      const { clause, params } = this.buildWhere(desde, hasta);

      const rows: { periodo: string; recibidas: number; resueltas: number }[] =
        await runner.query(
          `SELECT
            DATE_TRUNC('${trunc}', "fechaCreacion") AS periodo,
            COUNT(*)::int AS recibidas,
            COUNT(CASE WHEN estado = 'CON_RESPUESTA' THEN 1 END)::int AS resueltas
          FROM denuncias ${clause}
          GROUP BY DATE_TRUNC('${trunc}', "fechaCreacion")
          ORDER BY periodo ASC`,
          params,
        );

      return rows.map((r) => ({
        periodo: r.periodo,
        recibidas: r.recibidas,
        resueltas: r.resueltas,
      }));
    });
  }

  async exportarExcel(
    desde: string | undefined,
    hasta: string | undefined,
    res: Response,
  ): Promise<void> {
    await this.withRunner(async (runner) => {
      const { clause, params } = this.buildWhere(desde, hasta);

      const rows: Record<string, unknown>[] = await runner.query(
        `SELECT
          radicado,
          "nombreCiudadano",
          cedula,
          telefono,
          ubicacion,
          descripcion,
          COALESCE("dependenciaAsignada", 'Sin asignar') AS dependencia,
          estado,
          "esEspecial",
          "origenManual",
          "fechaCreacion",
          EXTRACT(DAY FROM NOW() - "fechaActualizacion")::int AS dias_en_estado
        FROM denuncias ${clause}
        ORDER BY "fechaCreacion" DESC`,
        params,
      );

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Denunciantes');

      ws.columns = [
        { header: 'Radicado', key: 'radicado', width: 14 },
        { header: 'Nombre', key: 'nombreCiudadano', width: 28 },
        { header: 'Cédula', key: 'cedula', width: 14 },
        { header: 'Teléfono', key: 'telefono', width: 14 },
        { header: 'Ubicación', key: 'ubicacion', width: 28 },
        { header: 'Descripción', key: 'descripcion', width: 40 },
        { header: 'Dependencia', key: 'dependencia', width: 28 },
        { header: 'Estado', key: 'estado', width: 16 },
        { header: 'Especial', key: 'esEspecial', width: 10 },
        { header: 'Origen', key: 'origenManual', width: 10 },
        { header: 'Fecha creación', key: 'fechaCreacion', width: 18 },
        { header: 'Días en estado', key: 'dias_en_estado', width: 14 },
      ];

      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8EEF7' },
      };

      for (const row of rows) {
        ws.addRow({
          ...row,
          esEspecial: row.esEspecial ? 'Sí' : 'No',
          origenManual: row.origenManual ? 'Manual' : 'Chatbot',
          fechaCreacion: new Date(row.fechaCreacion as string).toLocaleDateString('es-CO'),
        });
      }

      const fecha = new Date().toISOString().split('T')[0];
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=denunciantes-${fecha}.xlsx`,
      );

      const buffer = await wb.xlsx.writeBuffer();
      res.send(buffer);
    });
  }

  async exportarPdf(
    desde: string | undefined,
    hasta: string | undefined,
    res: Response,
  ): Promise<void> {
    const [resumen, porDep] = await Promise.all([
      this.getResumen(desde, hasta),
      this.getPorDependencia(desde, hasta),
    ]);

    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=informe-${fecha}.pdf`,
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // ── Encabezado ──────────────────────────────────────────────────────────
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('DenunciasAT — Informe de gestión', { align: 'center' });
    doc.moveDown(0.4);
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#555555')
      .text('Despacho Concejal Andrés Tobón — Concejo de Medellín', {
        align: 'center',
      });
    doc.moveDown(0.3);

    const periodoTexto =
      desde && hasta
        ? `Período: ${desde} al ${hasta}`
        : desde
          ? `Desde: ${desde}`
          : hasta
            ? `Hasta: ${hasta}`
            : 'Período: Todos los registros';
    doc
      .fontSize(10)
      .fillColor('#777777')
      .text(periodoTexto, { align: 'center' });
    doc.moveDown(1.2);

    // ── Sección 1: Resumen ──────────────────────────────────────────────────
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e3a5f')
      .text('1. Resumen de gestión');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#222222');

    const stats = [
      ['Total denuncias', String(resumen.totalDenuncias)],
      ['Recibidas', String(resumen.porEstado.RECIBIDA)],
      ['En gestión', String(resumen.porEstado.EN_GESTION)],
      ['Radicadas', String(resumen.porEstado.RADICADA)],
      ['Con respuesta', String(resumen.porEstado.CON_RESPUESTA)],
      ['Denuncias especiales', String(resumen.especiales)],
      ['Ingresadas manualmente', String(resumen.manuales)],
      ['Casos estancados +15 días', String(resumen.casosEstancados)],
    ];
    for (const [label, value] of stats) {
      doc.text(`${label}:  `, { continued: true }).font('Helvetica-Bold').text(value).font('Helvetica');
    }

    doc.moveDown(1.2);

    // ── Sección 2: Top dependencias ─────────────────────────────────────────
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e3a5f')
      .text('2. Top dependencias');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#222222');

    const top5 = porDep.slice(0, 5);
    for (const dep of top5) {
      doc.text(
        `• ${dep.dependencia}: ${dep.total} casos (${dep.porcentajeResolucion}% resueltos)`,
      );
    }

    doc.moveDown(1.2);

    // ── Sección 3: Indicadores clave ────────────────────────────────────────
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e3a5f')
      .text('3. Indicadores clave');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#222222');
    doc
      .text(`Tasa de resolución:  `, { continued: true })
      .font('Helvetica-Bold')
      .text(`${resumen.tasaResolucion}%`)
      .font('Helvetica');
    doc
      .text(`Tiempo promedio de resolución:  `, { continued: true })
      .font('Helvetica-Bold')
      .text(
        resumen.tiempoPromedioResolucion !== null
          ? `${resumen.tiempoPromedioResolucion} días`
          : 'Sin datos',
      );

    doc.moveDown(3);

    // ── Pie de página ───────────────────────────────────────────────────────
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#aaaaaa')
      .text(`Generado el ${new Date().toLocaleString('es-CO')}`, {
        align: 'right',
      });

    doc.end();
  }
}
