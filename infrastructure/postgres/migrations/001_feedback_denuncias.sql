-- Migración 001: tabla feedback_denuncias
-- Ejecutar en despliegues existentes donde DB_SYNC=false no creó la tabla automáticamente.

-- Habilitar extensión requerida para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS feedback_denuncias (
  id                     UUID           NOT NULL DEFAULT gen_random_uuid(),
  "denunciaId"           INTEGER        NOT NULL,
  "usuarioId"            INTEGER        NOT NULL,
  "dependenciaOriginal"  VARCHAR        NOT NULL,
  "dependenciaCorregida" VARCHAR,
  "dependenciaCorrecta"  BOOLEAN        NOT NULL,
  "calidadHechos"        INTEGER        NOT NULL,
  "comentarioHechos"     TEXT,
  "asuntoCorrect"        BOOLEAN        NOT NULL,
  "asuntoCorregido"      TEXT,
  "feedbackLibre"        TEXT,
  "pesoConfianza"        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  procesado              BOOLEAN        NOT NULL DEFAULT false,
  "fechaCreacion"        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT pk_feedback_denuncias PRIMARY KEY (id),
  CONSTRAINT fk_feedback_denuncias_denuncia FOREIGN KEY ("denunciaId") REFERENCES denuncias(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_denuncias_usuario  FOREIGN KEY ("usuarioId")  REFERENCES usuarios(id)  ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_feedback_denuncias_denuncia ON feedback_denuncias ("denunciaId");
