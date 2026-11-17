"""El agente de ClipViral usa SerieAI en SU PROPIA carpeta (tu serie y tus episodios no se tocan).

Hace lo mismo que `python main.py nueva/episodio` de SerieAI, con tres cambios:
- Trabaja en la carpeta del agente (serie.json, episodios/, temas.txt quedan ahí).
- Las preguntas a Claude pasan por el servidor de ClipViral (se cuentan en el tope de gasto del agente).
- Las voces salen del Sintetizador de voz (por el servidor de voz del agente).

python serie_agente.py --serieai <carpeta SerieAI> --carpeta <carpeta del agente> nueva --idea "..."
python serie_agente.py --serieai <carpeta SerieAI> --carpeta <carpeta del agente> episodio --tema "..."
Variables: CLIPVIRAL_URL, CLIPVIRAL_TOKEN, VOZ_PUERTO, VOZ_CLAVE, AGENTE_AJUSTES (JSON con cambios a config.json).
Al final escribe una línea "RESULTADO {json}".
"""
import argparse
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
CLIENTE_VOZ = os.path.join(AQUI, "voz_cliente.py")

ap = argparse.ArgumentParser()
ap.add_argument("--serieai", required=True)
ap.add_argument("--carpeta", required=True)
sub = ap.add_subparsers(dest="orden", required=True)
sub.add_parser("nueva").add_argument("--idea", required=True)
sub.add_parser("episodio").add_argument("--tema", default="")
args = ap.parse_args()

SERIEAI = os.path.abspath(args.serieai)
sys.path.insert(0, SERIEAI)
from serie import claude_api, guionista, render, render3d  # noqa: E402


def leer(ruta):
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def escribir(ruta, datos):
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)


def preguntar_por_clipviral(cfg, sistema, mensaje, max_tokens=8000):
    """Reemplaza a claude_api.preguntar: el pedido va al servidor de ClipViral, que lo cuenta en el gasto del agente."""
    cuerpo = json.dumps({"tarea": "serie", "system": sistema, "prompt": mensaje, "maxTokens": max(16000, max_tokens)}).encode("utf-8")
    pedido = urllib.request.Request(os.environ["CLIPVIRAL_URL"].rstrip("/") + "/api/agente/pensar", data=cuerpo, method="POST",
                                    headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ.get("CLIPVIRAL_TOKEN", "")})
    for intento in range(3):
        try:
            with urllib.request.urlopen(pedido, timeout=600) as r:
                return json.load(r).get("text", "")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error") or f"error {e.code}"
            except ValueError:
                msg = f"error {e.code}"
            if e.code < 500 or intento == 2:
                raise SystemExit(msg)
        except urllib.error.URLError as e:
            if intento == 2:
                raise SystemExit(f"Sin conexión con el servidor de ClipViral: {e.reason}")
        time.sleep(15 * (intento + 1))


claude_api.preguntar = preguntar_por_clipviral  # pedir_json lo busca aquí en cada llamada

os.makedirs(args.carpeta, exist_ok=True)
os.chdir(args.carpeta)
cfg = leer(os.path.join(SERIEAI, "config.json"))
cfg.update(json.loads(os.environ.get("AGENTE_AJUSTES") or "{}"))
cfg["api_key"] = cfg.get("api_key") or "clipviral"  # no se usa: las preguntas van por ClipViral
cfg["comando_voz"] = f'"{sys.executable}" "{CLIENTE_VOZ}" --voz {{voz}} --emocion {{emocion}} --texto "{{texto_archivo}}" --salida "{{salida}}"'
motor = render3d if cfg.get("modo") == "3d" else render


def resultado(datos):
    print("RESULTADO " + json.dumps(datos, ensure_ascii=False), flush=True)


if args.orden == "nueva":
    print("Creando la serie del agente...", flush=True)
    serie = guionista.crear_serie(cfg, args.idea)
    escribir("serie.json", serie)
    imagen = None
    try:
        motor.vista_personajes(serie, "personajes.png", cfg)
        imagen = os.path.abspath("personajes.png")
    except (SystemExit, Exception) as ex:  # noqa: BLE001
        print("No se pudo crear la foto de los personajes:", ex, flush=True)
    resultado({"titulo": serie.get("titulo"), "personajes": [p.get("nombre") for p in serie.get("personajes", [])], "imagen": imagen})
else:
    if not os.path.exists("serie.json"):
        raise SystemExit("El agente todavía no creó su serie.")
    serie = leer("serie.json")
    anteriores = [leer(g) for g in sorted(glob.glob("episodios/ep*/guion.json"))]
    n = len(anteriores) + 1
    print(f"Escribiendo el episodio {n}{' - tema: ' + args.tema if args.tema else ''}...", flush=True)
    ep = guionista.crear_episodio(cfg, serie, anteriores, n, args.tema)
    carpeta = f"episodios/ep{n:03d}"
    escribir(f"{carpeta}/guion.json", ep)
    video = motor.renderizar(serie, ep, carpeta, cfg)
    resultado({"video": os.path.abspath(video), "numero": n, "serie": serie.get("titulo"), "titulo": ep.get("titulo"),
               "descripcion": ep.get("descripcion", ""), "hashtags": ep.get("hashtags", [])})
