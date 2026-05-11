-- Migración 001: tabla feedback_denuncias
-- Idempotente — puede ejecutarse múltiples veces sin errores

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feedback_denuncias (
  id                    UUID          NOT NULL DEFAULT gen_random_uuid(),
  "denunciaId"          INTEGER       NOT NULL,
  "usuarioId"           INTEGER       NOT NULL,
  "dependenciaOriginal" VARCHAR       NOT NULL,
  "dependenciaCorregida" VARCHAR,
  "dependenciaCorrecta" BOOLEAN       NOT NULL,
  "calidadHechos"       INTEGER       NOT NULL,
  "comentarioHechos"    TEXT,
  "asuntoCorrect"       BOOLEAN       NOT NULL,
  "asuntoCorregido"     TEXT,
  "feedbackLibre"       TEXT,
  "pesoConfianza"       FLOAT         NOT NULL DEFAULT 1.0,
  "procesado"           BOOLEAN       NOT NULL DEFAULT FALSE,
  "fechaCreacion"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_feedback_denuncias PRIMARY KEY (id),
  CONSTRAINT fk_feedback_denuncia FOREIGN KEY ("denunciaId")
    REFERENCES denuncias(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_usuario FOREIGN KEY ("usuarioId")
    REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_denuncias_denunciaId
  ON feedback_denuncias ("denunciaId");
