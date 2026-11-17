"""Servidor de voz del agente de ClipViral.

Carga el motor del programa "Sintetizador de voz" una sola vez y lee textos cuando el agente se lo pide
(así el modelo no se vuelve a cargar en cada frase). Solo escucha dentro de la PC (127.0.0.1) y pide una clave.

Uso:  <python del Sintetizador> voz_servidor.py <carpeta del Sintetizador>
Variables: VOZ_CLAVE (clave que deben mandar los pedidos).
Escribe "LISTO <puerto>" cuando está listo, u "OCUPADO" si el programa del Sintetizador está abierto.
"""
import ctypes
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SINTE = Path(sys.argv[1]).resolve()
CLAVE = os.environ.get("VOZ_CLAVE", "")
LIBERAR_TRAS = 45      # segundos sin uso: se saca el modelo de la tarjeta gráfica (Blender la necesita)
CERRAR_TRAS = 15 * 60  # segundos sin uso: el servidor se cierra solo

# El Sintetizador usa este nombre para no abrirse dos veces (dos modelos no caben en la tarjeta gráfica).
# Mientras el agente lo usa, lo tomamos nosotros: si alguien abre el programa, le dice que ya está abierto.
MUTEX = "Local\\SintetizadorVozQwen"
k32 = ctypes.windll.kernel32
k32.OpenMutexW.restype = ctypes.c_void_p
k32.CreateMutexW.restype = ctypes.c_void_p
abierto = k32.OpenMutexW(0x00100000, False, MUTEX)
if abierto:
    print("OCUPADO", flush=True)
    sys.exit(3)
_mutex = k32.CreateMutexW(None, False, MUTEX)

sys.path.insert(0, str(SINTE))
import motor  # noqa: E402

# Emociones de SerieAI (y sinónimos) → emociones del Sintetizador.
EMOCIONES = {"neutral": "normal", "feliz": "alegre", "sorprendido": "alegre", "asustado": "susurro",
             "emocionado": "alegre", "serio": "normal", "misterioso": "susurro", "intrigante": "susurro"}

ultimo_uso = time.time()
cargado = False
candado = threading.Lock()


def elegir_emocion(nombre, listas):
    """La emoción pedida si la voz la tiene; si no, la más parecida que tenga (o normal)."""
    n = str(nombre or "normal").lower()
    pedida = motor.buscar_emocion(n) or EMOCIONES.get(n) or "normal"
    if pedida in listas:
        return pedida
    return "normal" if "normal" in listas else (listas[0] if listas else None)


def elegir_voz(nombre, disponibles):
    vid = motor.buscar_voz(str(nombre or "")) if nombre else None
    if vid in disponibles:
        return vid
    for v in ("andres", "sofia", "diego", "carmen", "ernesto"):
        if v in disponibles:
            return v
    return next(iter(disponibles), None)


def hablar(d):
    global ultimo_uso, cargado
    texto = str(d.get("texto") or "").strip()
    salida = Path(str(d.get("salida") or ""))
    if not texto or not salida.parent.is_dir():
        raise motor.ErrorUsuario("Falta el texto o la carpeta de salida.")
    disponibles = {v: e for v, e in motor.disponibles().items() if e}
    if not disponibles:
        raise motor.ErrorUsuario("El Sintetizador no tiene voces creadas. Ábrelo y créalas en la sección Voces.")
    voz = elegir_voz(d.get("voz"), disponibles)
    emocion = elegir_emocion(d.get("emocion"), disponibles[voz])
    opciones = motor.cargar_ajustes()
    for k in ("velocidad", "tono", "pausa", "volumen"):
        if d.get(k) is not None:
            opciones[k] = d[k]
    formato = salida.suffix.lower().lstrip(".") or "wav"
    with candado:
        audio, sr, info = motor.sintetizar([{"voz": voz, "emocion": emocion, "texto": texto}], opciones)
        cargado = True
        motor.guardar_audio(audio, sr, formato, ruta=salida)
        ultimo_uso = time.time()
    return {"ok": True, "archivo": str(salida), "voz": voz, "emocion": emocion, "duracion": motor.duracion(salida), **info}


def voces():
    perfiles = motor.perfiles()
    return {v: {"nombre": perfiles.get(v, {}).get("nombre", v), "detalle": perfiles.get(v, {}).get("detalle", ""), "emociones": e}
            for v, e in motor.disponibles().items() if e}


class Pedidos(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _responder(self, codigo, datos):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _permitido(self):
        if self.headers.get("X-Clave") != CLAVE or not CLAVE:
            self._responder(403, {"error": "Clave incorrecta"})
            return False
        return True

    def do_GET(self):
        if not self._permitido():
            return
        if self.path == "/voces":
            return self._responder(200, voces())
        if self.path == "/salud":
            return self._responder(200, {"ok": True, "cargado": cargado})
        self._responder(404, {"error": "No encontrado"})

    def do_POST(self):
        global ultimo_uso
        if not self._permitido():
            return
        largo = int(self.headers.get("Content-Length") or 0)
        try:
            d = json.loads(self.rfile.read(largo) or b"{}")
        except ValueError:
            return self._responder(400, {"error": "Pedido mal formado"})
        ultimo_uso = time.time()
        try:
            if self.path == "/hablar":
                return self._responder(200, hablar(d))
            if self.path == "/liberar":
                with candado:
                    motor.liberar_modelo()
                return self._responder(200, {"ok": True})
            self._responder(404, {"error": "No encontrado"})
        except motor.ErrorUsuario as e:
            self._responder(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._responder(500, {"error": str(motor.traducir_error(e))})


def vigilar(servidor):
    """Saca el modelo de la tarjeta gráfica cuando no se usa y cierra el servidor si nadie lo usa más."""
    global cargado
    while True:
        time.sleep(5)
        quieto = time.time() - ultimo_uso
        if cargado and quieto > LIBERAR_TRAS and candado.acquire(blocking=False):
            try:
                motor.liberar_modelo()
                cargado = False
            finally:
                candado.release()
        if quieto > CERRAR_TRAS:
            servidor.shutdown()
            return


if __name__ == "__main__":
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), Pedidos)
    threading.Thread(target=vigilar, args=(servidor,), daemon=True).start()
    print(f"LISTO {servidor.server_port}", flush=True)
    servidor.serve_forever()
