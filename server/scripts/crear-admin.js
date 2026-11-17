// Crea (o convierte en admin) una cuenta.
// Uso: npm run crear-admin -- correo@ejemplo.com "Contraseña" "Nombre"
// El asistente de "Iniciar ClipViral.bat" usa crearAdmin() directo, así la contraseña no pasa por la línea de comandos.
import path from 'node:path';
import { db } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

/** Crea el administrador, o convierte en admin la cuenta que ya tenga ese correo. Devuelve { id, created }. */
export async function crearAdmin({ email, password, name = 'Administrador' }) {
  const correo = String(email).trim().toLowerCase();
  const hash = await hashPassword(String(password));
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(correo);
  if (existing) {
    db.prepare(`UPDATE users SET role = 'admin', plan = 'pro247', plan_expires = NULL, pass_hash = ?, banned = 0 WHERE id = ?`).run(hash, existing.id);
    return { id: Number(existing.id), created: false };
  }
  const result = db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, plan_expires) VALUES (?, ?, ?, 'admin', 'pro247', NULL)`)
    .run(correo, String(name).trim() || 'Administrador', hash);
  return { id: Number(result.lastInsertRowid), created: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.log('Uso: npm run crear-admin -- correo@ejemplo.com "Contraseña (mín. 8)" "Nombre"');
    process.exit(1);
  }
  const { created } = await crearAdmin({ email, password, name });
  console.log(created ? `Listo: se creó el administrador ${email}.` : `Listo: ${email} ahora es administrador.`);
}
