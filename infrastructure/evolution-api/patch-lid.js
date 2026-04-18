/**
 * Parche para Evolution API v2.2.3
 *
 * Problema: sendMessageWithTyping lanza BadRequest cuando el JID es @lid
 * (Linked Device ID de WhatsApp multi-device) porque el check de existencia
 * onWhatsApp() falla para LIDs — no son números de teléfono reales.
 *
 * Fix: añadir &&!n.jid.includes("@lid") a la condición, igual que ya existe
 * para @broadcast y @g.us, permitiendo que Baileys envíe al JID directamente.
 *
 * Este script se ejecuta UNA VEZ antes de arrancar el servidor (ver docker-compose).
 */

const fs = require('fs');
const { execSync } = require('child_process');

const OLD_N = '!n.exists&&!(0,P.isJidGroup)(n.jid)&&!n.jid.includes("@broadcast"))throw new f(n)';
const NEW_N = '!n.exists&&!(0,P.isJidGroup)(n.jid)&&!n.jid.includes("@broadcast")&&!n.jid.includes("@lid"))throw new f(n)';

const OLD_S = '!s.exists&&!(0,P.isJidGroup)(s.jid)&&!s.jid.includes("@broadcast"))throw new f(s)';
const NEW_S = '!s.exists&&!(0,P.isJidGroup)(s.jid)&&!s.jid.includes("@broadcast")&&!s.jid.includes("@lid"))throw new f(s)';

try {
  const files = execSync('find /evolution/dist -name "*.js"')
    .toString()
    .split('\n')
    .filter(Boolean);

  let patchedCount = 0;
  let alreadyPatchedCount = 0;

  files.forEach((f) => {
    try {
      let data = fs.readFileSync(f, 'utf8');
      let changed = false;

      if (data.includes(NEW_N) || data.includes(NEW_S)) {
        alreadyPatchedCount++;
        return;
      }

      if (data.includes(OLD_N)) {
        data = data.replaceAll(OLD_N, NEW_N);
        changed = true;
      }
      if (data.includes(OLD_S)) {
        data = data.replaceAll(OLD_S, NEW_S);
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(f, data);
        patchedCount++;
      }
    } catch (_) {}
  });

  if (patchedCount > 0) {
    console.log(`[patch-lid] Parcheados ${patchedCount} archivos para soporte @lid JID`);
  } else if (alreadyPatchedCount > 0) {
    console.log(`[patch-lid] Parche @lid ya aplicado (${alreadyPatchedCount} archivos)`);
  } else {
    console.warn('[patch-lid] ADVERTENCIA: No se encontraron archivos para parchear. ¿Versión diferente de Evolution API?');
  }
} catch (err) {
  console.error('[patch-lid] Error aplicando parche:', err.message);
  // No fallar el arranque si el parche falla
}
