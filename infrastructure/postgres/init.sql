-- Inicialización de la base de datos DenunciasAT
-- Se ejecuta automáticamente al levantar el contenedor de PostgreSQL

-- SEQUENCE para el radicado de denuncias (formato: DAT-000001)
CREATE SEQUENCE IF NOT EXISTS radicado_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- Base de datos separada para Evolution API (WhatsApp)
CREATE DATABASE evolution
  WITH OWNER = CURRENT_USER
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.utf8'
  LC_CTYPE = 'en_US.utf8'
  TEMPLATE = template0;
