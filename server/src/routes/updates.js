import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db, RELEASES_DIR } from '../db.js';

const router = Router();

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** La app pregunta si hay una versión nueva. */
router.get('/latest', (req, res) => {
  const current = String(req.query.current || '0.0.0');
  const releases = db.prepare('SELECT * FROM releases').all().sort((a, b) => compareVersions(b.version, a.version));
  const latest = releases[0];
  if (!latest || compareVersions(latest.version, current) <= 0) {
    return res.json({ available: false, current });
  }
  const newer = releases.filter((r) => compareVersions(r.version, current) > 0);
  res.json({
    available: true,
    current,
    version: latest.version,
    notes: newer.map((r) => `v${r.version}\n${r.notes}`).join('\n\n'),
    mandatory: newer.some((r) => r.mandatory),
    size: latest.size,
    sha256: latest.sha256,
    url: `/api/updates/download/${latest.id}`,
    publishedAt: latest.created_at,
  });
});

router.get('/download/:id', (req, res) => {
  const release = db.prepare('SELECT * FROM releases WHERE id = ?').get(Number(req.params.id));
  if (!release) return res.status(404).json({ error: 'Versión no encontrada' });
  const file = path.join(RELEASES_DIR, release.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'El archivo de esta versión no existe' });
  db.prepare('UPDATE releases SET downloads = downloads + 1 WHERE id = ?').run(release.id);
  res.download(file, release.original_name);
});

export default router;
