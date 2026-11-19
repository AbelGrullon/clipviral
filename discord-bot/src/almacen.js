// Lo que el bot recuerda, en data/bot.json: los canales que armó en cada servidor de Discord, los tickets
// (abiertos y cerrados), el correo de ClipViral que dio cada cliente y la última versión que anunció.
import fs from 'node:fs';
import path from 'node:path';

const vacio = () => ({ principal: null, servidores: {}, tickets: {}, vinculos: {}, ultimaVersion: null });

export class Almacen {
  constructor(carpeta) {
    this.carpeta = carpeta;
    this.archivo = path.join(carpeta, 'bot.json');
    this.datos = vacio();
    try {
      this.datos = { ...vacio(), ...JSON.parse(fs.readFileSync(this.archivo, 'utf8')) };
    } catch (err) {
      // Si el archivo quedó dañado, se guarda aparte (para no perderlo) y se empieza limpio.
      if (err.code !== 'ENOENT') {
        try { fs.renameSync(this.archivo, `${this.archivo}.danado-${Date.now()}`); } catch {}
      }
    }
    // Si el bot se apagó a mitad de cerrar un ticket, ese ticket vuelve a quedar abierto (si no, nadie podría cerrarlo).
    for (const t of Object.values(this.datos.tickets)) if (t.estado === 'cerrando') t.estado = 'abierto';
  }

  // ---------- El servidor de Discord de ClipViral (el bot solo trabaja en uno) ----------
  principal() {
    return this.datos.principal || null;
  }

  guardarPrincipal(guildId) {
    this.datos.principal = guildId;
    this.guardar();
  }

  guardar() {
    fs.mkdirSync(this.carpeta, { recursive: true });
    const texto = JSON.stringify(this.datos, null, 2);
    const tmp = `${this.archivo}.tmp`;
    try {
      fs.writeFileSync(tmp, texto);
      fs.renameSync(tmp, this.archivo);
    } catch {
      fs.writeFileSync(this.archivo, texto);
    }
  }

  // ---------- Servidores de Discord (los canales que armó /configurar) ----------
  servidor(guildId) {
    return this.datos.servidores[guildId] || null;
  }

  guardarServidor(guildId, cambios) {
    this.datos.servidores[guildId] = { ...(this.datos.servidores[guildId] || {}), ...cambios };
    this.guardar();
    return this.datos.servidores[guildId];
  }

  servidores() {
    return Object.entries(this.datos.servidores).map(([guildId, cfg]) => ({ guildId, ...cfg }));
  }

  siguienteNumero(guildId) {
    const s = (this.datos.servidores[guildId] ||= {});
    s.ultimoTicket = (s.ultimoTicket || 0) + 1;
    this.guardar();
    return s.ultimoTicket;
  }

  // ---------- Tickets (por canal) ----------
  nuevoTicket(ticket) {
    this.datos.tickets[ticket.canalId] = { estado: 'abierto', ...ticket };
    this.guardar();
    return this.datos.tickets[ticket.canalId];
  }

  ticket(canalId) {
    return this.datos.tickets[canalId] || null;
  }

  abiertosDe(guildId, userId) {
    return Object.values(this.datos.tickets).filter((t) => t.guildId === guildId && t.userId === userId && t.estado === 'abierto');
  }

  cambiarTicket(canalId, cambios) {
    const t = this.datos.tickets[canalId];
    if (!t) return null;
    Object.assign(t, cambios);
    this.guardar();
    return t;
  }

  // ---------- Correo de ClipViral de cada cliente (para no pedírselo cada vez) ----------
  correoDe(userId) {
    return this.datos.vinculos[userId]?.correo || '';
  }

  vincular(userId, correo) {
    this.datos.vinculos[userId] = { correo, desde: new Date().toISOString() };
    this.guardar();
  }

  // ---------- Noticias ----------
  ultimaVersion() {
    return this.datos.ultimaVersion || null;
  }

  guardarUltimaVersion(version) {
    this.datos.ultimaVersion = version;
    this.guardar();
  }
}
