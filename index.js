import express from 'express';
import cors from 'cors';
import pg from 'pg';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'alra-planes-secret-2026';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'alra2026';

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'daxkzdokg',
  api_key: process.env.CLOUDINARY_API_KEY || '391384177953845',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'KxjHQugLUEoWKIEcAyw1M16hkFs'
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Multer for image uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ═══════════════════════════════════════
// DATABASE SETUP (PostgreSQL)
// ═══════════════════════════════════════
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS planes (
        id SERIAL PRIMARY KEY,
        modelo TEXT NOT NULL,
        version TEXT NOT NULL,
        valor TEXT DEFAULT '',
        anticipo TEXT DEFAULT '',
        cuota TEXT DEFAULT '',
        tipo TEXT DEFAULT '70/30',
        adjudicacion TEXT DEFAULT 'cuota 2',
        whatsapp_texto TEXT DEFAULT '',
        activo INTEGER DEFAULT 1,
        orden INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS plan_imagenes (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        public_id TEXT DEFAULT '',
        orden INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Default config
    const configRes = await client.query('SELECT COUNT(*) as c FROM config');
    if (parseInt(configRes.rows[0].c) === 0) {
      await client.query("INSERT INTO config (key, value) VALUES ('whatsapp_number', '5491121655405')");
      await client.query("INSERT INTO config (key, value) VALUES ('site_title', 'ALRA Planes')");
    }

    // Seed planes if empty
    const planesRes = await client.query('SELECT COUNT(*) as c FROM planes');
    if (parseInt(planesRes.rows[0].c) === 0) {
      console.log('📦 Base vacía, cargando planes iniciales...');

      const seedPlanes = [
        { modelo: 'Volkswagen Tera', version: 'Trend MSI MT · 84 cuotas', valor: '$36.755.250', anticipo: '$11.026.575', cuota: '$350.574', tipo: '70/30', adjudicacion: 'cuota 2', whatsapp_texto: 'Hola! Quiero info sobre el plan del Tera 70/30', imagen: 'https://www.alravw.com/files/modelos/tera/01.png' },
        { modelo: 'Volkswagen Nivus', version: 'Comfortline AT · 84 cuotas', valor: '$46.875.950', anticipo: '$14.062.785', cuota: '$447.190', tipo: '70/30', adjudicacion: 'cuota 2', whatsapp_texto: 'Hola! Quiero info sobre el plan del Nivus 70/30', imagen: 'https://www.alravw.com/files/modelos/nivus/01.png' },
        { modelo: 'Volkswagen T-Cross', version: 'Trendline MSI MT · 84 cuotas', valor: '$47.320.500', anticipo: '$14.196.150', cuota: '$451.434', tipo: '70/30', adjudicacion: 'cuota 2', whatsapp_texto: 'Hola! Quiero info sobre el plan del T-Cross 70/30', imagen: 'https://www.alravw.com/files/modelos/tcross/01.png' },
        { modelo: 'Volkswagen Taos', version: 'Trendline TSI MT · 84 cuotas', valor: '$55.406.000', anticipo: '$16.621.800', cuota: '$528.625', tipo: '70/30', adjudicacion: 'cuota 2', whatsapp_texto: 'Hola! Quiero info sobre el plan del Taos 70/30', imagen: 'https://www.alravw.com/files/modelos/taos/01.png' },
        { modelo: 'Volkswagen Amarok', version: 'Comfortline V6 AT · 84 cuotas', valor: '$79.752.100', anticipo: '$23.925.630', cuota: '$761.378', tipo: '70/30', adjudicacion: 'cuota 2', whatsapp_texto: 'Hola! Quiero info sobre el plan de la Amarok 70/30', imagen: 'https://www.alravw.com/files/modelos/amarok/01.png' }
      ];

      for (let i = 0; i < seedPlanes.length; i++) {
        const p = seedPlanes[i];
        const res = await client.query(
          'INSERT INTO planes (modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [p.modelo, p.version, p.valor, p.anticipo, p.cuota, p.tipo, p.adjudicacion, p.whatsapp_texto, i]
        );
        await client.query('INSERT INTO plan_imagenes (plan_id, url, orden) VALUES ($1, $2, 0)', [res.rows[0].id, p.imagen]);
      }
      console.log('✅ 5 planes cargados');
    }

    console.log('✅ Base de datos inicializada');
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════
// AUTH
// ═══════════════════════════════════════
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: username });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

// ═══════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════
app.get('/api/planes', async (req, res) => {
  try {
    const planes = await pool.query('SELECT * FROM planes WHERE activo = 1 ORDER BY orden, id');
    const result = [];
    for (const p of planes.rows) {
      const imgs = await pool.query('SELECT id, url, public_id, orden FROM plan_imagenes WHERE plan_id = $1 ORDER BY orden', [p.id]);
      result.push({ ...p, imagenes: imgs.rows });
    }
    res.json(result);
  } catch (e) {
    console.error('Error:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/config', async (req, res) => {
  try {
    const rows = await pool.query('SELECT key, value FROM config');
    const config = {};
    rows.rows.forEach(r => config[r.key] = r.value);
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════
app.get('/api/admin/planes', authMiddleware, async (req, res) => {
  try {
    const planes = await pool.query('SELECT * FROM planes ORDER BY orden, id');
    const result = [];
    for (const p of planes.rows) {
      const imgs = await pool.query('SELECT id, url, public_id, orden FROM plan_imagenes WHERE plan_id = $1 ORDER BY orden', [p.id]);
      result.push({ ...p, imagenes: imgs.rows });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/admin/planes', authMiddleware, async (req, res) => {
  const { modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, orden } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO planes (modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [modelo, version, valor || '', anticipo || '', cuota || '', tipo || '70/30', adjudicacion || 'cuota 2', whatsapp_texto || '', orden || 0]
    );
    res.json({ id: result.rows[0].id, message: 'Plan creado' });
  } catch (e) {
    res.status(500).json({ error: 'Error creando plan' });
  }
});

app.put('/api/admin/planes/:id', authMiddleware, async (req, res) => {
  const { modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, activo, orden } = req.body;
  try {
    await pool.query(
      'UPDATE planes SET modelo=$1, version=$2, valor=$3, anticipo=$4, cuota=$5, tipo=$6, adjudicacion=$7, whatsapp_texto=$8, activo=$9, orden=$10, updated_at=NOW() WHERE id=$11',
      [modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, activo ?? 1, orden ?? 0, req.params.id]
    );
    res.json({ message: 'Plan actualizado' });
  } catch (e) {
    res.status(500).json({ error: 'Error actualizando' });
  }
});

app.delete('/api/admin/planes/:id', authMiddleware, async (req, res) => {
  try {
    const imgs = await pool.query('SELECT public_id FROM plan_imagenes WHERE plan_id = $1', [req.params.id]);
    for (const img of imgs.rows) {
      if (img.public_id) cloudinary.uploader.destroy(img.public_id).catch(() => {});
    }
    await pool.query('DELETE FROM plan_imagenes WHERE plan_id = $1', [req.params.id]);
    await pool.query('DELETE FROM planes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Plan eliminado' });
  } catch (e) {
    res.status(500).json({ error: 'Error eliminando' });
  }
});

// --- IMAGENES ---
app.post('/api/admin/planes/:id/imagenes', authMiddleware, upload.single('imagen'), async (req, res) => {
  try {
    const planId = req.params.id;
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'alra-planes', quality: 'auto', fetch_format: 'auto' },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    const maxOrden = await pool.query('SELECT COALESCE(MAX(orden), 0) as m FROM plan_imagenes WHERE plan_id = $1', [planId]);
    const dbResult = await pool.query(
      'INSERT INTO plan_imagenes (plan_id, url, public_id, orden) VALUES ($1, $2, $3, $4) RETURNING id',
      [planId, result.secure_url, result.public_id, maxOrden.rows[0].m + 1]
    );

    res.json({ id: dbResult.rows[0].id, url: result.secure_url, public_id: result.public_id, message: 'Imagen subida' });
  } catch (e) {
    console.error('Error subiendo imagen:', e);
    res.status(500).json({ error: 'Error subiendo imagen: ' + e.message });
  }
});

app.post('/api/admin/planes/:id/imagenes-url', authMiddleware, async (req, res) => {
  try {
    const planId = req.params.id;
    const { url } = req.body;
    const result = await cloudinary.uploader.upload(url, { folder: 'alra-planes', quality: 'auto', fetch_format: 'auto' });
    const maxOrden = await pool.query('SELECT COALESCE(MAX(orden), 0) as m FROM plan_imagenes WHERE plan_id = $1', [planId]);
    const dbResult = await pool.query(
      'INSERT INTO plan_imagenes (plan_id, url, public_id, orden) VALUES ($1, $2, $3, $4) RETURNING id',
      [planId, result.secure_url, result.public_id, maxOrden.rows[0].m + 1]
    );
    res.json({ id: dbResult.rows[0].id, url: result.secure_url, message: 'Imagen migrada' });
  } catch (e) {
    res.status(500).json({ error: 'Error: ' + e.message });
  }
});

app.delete('/api/admin/imagenes/:id', authMiddleware, async (req, res) => {
  try {
    const img = await pool.query('SELECT public_id FROM plan_imagenes WHERE id = $1', [req.params.id]);
    if (img.rows[0]?.public_id) cloudinary.uploader.destroy(img.rows[0].public_id).catch(() => {});
    await pool.query('DELETE FROM plan_imagenes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Imagen eliminada' });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.put('/api/admin/imagenes/reorder', authMiddleware, async (req, res) => {
  try {
    for (const item of req.body.orden) {
      await pool.query('UPDATE plan_imagenes SET orden = $1 WHERE id = $2', [item.orden, item.id]);
    }
    res.json({ message: 'Orden actualizado' });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

// --- CONFIG ---
app.put('/api/admin/config', authMiddleware, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await pool.query('INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $3', [key, value, value]);
    }
    res.json({ message: 'Config actualizada' });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚗 ALRA Planes API corriendo en puerto ${PORT}`);
    console.log(`📊 Admin: http://localhost:${PORT}/admin.html`);
  });
}).catch(err => {
  console.error('❌ Error inicializando DB:', err);
  process.exit(1);
});