// Un Discord de mentira para las pruebas: guarda lo que el bot crea, manda y borra, sin conectarse a nada.
let siguienteId = 1000;
export const nuevoId = () => String(++siguienteId);

class Coleccion extends Map {
  find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; }
}

export function canalFalso({ id = nuevoId(), name = 'canal', type = 0, parent = null, guild = null } = {}) {
  const canal = {
    id, name, type, parentId: parent, guild, enviados: [], borrado: false, mensajes: [],
    autorBot: 'bot',
    async send(m) {
      const msg = mensajeFalso({ canal, contenido: m, autor: { id: canal.autorBot, username: 'ClipViral', bot: true } });
      canal.enviados.push(m);
      canal.mensajes.push(msg);
      return msg;
    },
    async delete() { canal.borrado = true; guild?.channels.cache.delete(id); },
    isTextBased: () => type === 0,
    messages: {
      async fetch(arg) {
        if (typeof arg === 'string') {
          const m = canal.mensajes.find((x) => x.id === arg);
          if (!m) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
          return m;
        }
        // Como Discord: del más nuevo al más viejo, de a 100, "before" excluye.
        let lista = [...canal.mensajes].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        if (arg?.before) {
          const corte = canal.mensajes.find((x) => x.id === arg.before).createdTimestamp;
          lista = lista.filter((x) => x.createdTimestamp < corte);
        }
        return new Coleccion(lista.slice(0, arg?.limit ?? 50).map((m) => [m.id, m]));
      },
    },
  };
  return canal;
}

let reloj = Date.parse('2026-11-18T20:00:00Z');
export function mensajeFalso({ canal, contenido, autor }) {
  const m = typeof contenido === 'string' ? { content: contenido } : contenido;
  const msg = {
    id: nuevoId(),
    content: m.content || '',
    embeds: m.embeds || [],
    components: m.components || [],
    attachments: new Coleccion((m.adjuntos || []).map((url, i) => [String(i), { url }])),
    author: autor,
    member: autor.displayName ? { displayName: autor.displayName } : null,
    createdTimestamp: (reloj += 60000),
    async edit(nuevo) { msg.editado = nuevo; return msg; },
  };
  return msg;
}

export function servidorFalso({ id = nuevoId(), name = 'ClipViral', fallarCrear = null } = {}) {
  const guild = { id, name, creados: [], rolesCreados: [] };
  guild.roles = {
    everyone: { id },
    cache: new Coleccion(),
    async fetch() { return guild.roles.cache; },
    async create(o) {
      const rol = { id: nuevoId(), ...o };
      guild.roles.cache.set(rol.id, rol);
      guild.rolesCreados.push(o);
      return rol;
    },
  };
  guild.channels = {
    cache: new Coleccion(),
    async fetch(cid) {
      if (cid === undefined) return guild.channels.cache;
      const c = guild.channels.cache.get(cid);
      if (!c) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
      return c;
    },
    async create(o) {
      if (fallarCrear) throw fallarCrear;
      const c = canalFalso({ name: o.name, type: o.type ?? 0, parent: o.parent ?? null, guild });
      c.opciones = o;
      guild.channels.cache.set(c.id, c);
      guild.creados.push(o);
      return c;
    },
  };
  guild.commands = { puestos: null, async set(c) { guild.commands.puestos = c; } };
  return guild;
}

export function usuarioFalso(nombre = 'ana', extra = {}) {
  return { id: nuevoId(), username: nombre, globalName: extra.globalName ?? null, bot: false, ...extra };
}

/** Lo que un cliente escribe en un canal (para las transcripciones). */
export function escribir(canal, usuario, texto, adjuntos = []) {
  const m = mensajeFalso({ canal, contenido: { content: texto, adjuntos }, autor: usuario });
  canal.mensajes.push(m);
  return m;
}
