-- Inicialización de la base de datos DenunciasAT
-- Se ejecuta automáticamente al levantar el contenedor de PostgreSQL

-- SEQUENCE para el radicado de denuncias (formato: DAT-000001)
CREATE SEQUENCE IF NOT EXISTS radicado_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
