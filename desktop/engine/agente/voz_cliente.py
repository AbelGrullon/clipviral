"""Lo usa SerieAI (su "comando_voz") cuando lo maneja el agente de ClipViral: le pide la frase al servidor de voz.

python voz_cliente.py --voz andres --emocion feliz --texto frase.txt --salida audio.wav
Variables: VOZ_PUERTO y VOZ_CLAVE (las pone el agente). Solo usa Python estándar.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

a = argparse.ArgumentParser()
a.add_argument("--voz", default="")
a.add_argument("--emocion", default="normal")
a.add_argument("--texto", required=True)
a.add_argument("--salida", required=True)
o = a.parse_args()

with open(o.texto, encoding="utf-8") as f:
    texto = f.read()
cuerpo = json.dumps({"texto": texto, "voz": o.voz, "emocion": o.emocion, "salida": os.path.abspath(o.salida)}).encode("utf-8")
pedido = urllib.request.Request(f"http://127.0.0.1:{os.environ.get('VOZ_PUERTO', '0')}/hablar", data=cuerpo, method="POST",
                                headers={"Content-Type": "application/json", "X-Clave": os.environ.get("VOZ_CLAVE", "")})
try:
    with urllib.request.urlopen(pedido, timeout=900) as r:
        json.load(r)
except urllib.error.HTTPError as e:
    try:
        msg = json.loads(e.read().decode("utf-8")).get("error")
    except ValueError:
        msg = f"error {e.code}"
    sys.exit(f"La voz no se pudo crear: {msg}")
except urllib.error.URLError as e:
    sys.exit(f"No hay conexión con el servidor de voz del agente: {e.reason}")
