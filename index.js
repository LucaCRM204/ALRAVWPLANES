import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
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

// Multer for image uploads (memory storage → Cloudinary)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ═══════════════════════════════════════
// DATABASE SETUP (SQLite)
// ═══════════════════════════════════════
const db = new Database(join(__dirname, 'data', 'alra.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS planes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plan_imagenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    public_id TEXT DEFAULT '',
    orden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Insert default config if empty
const configCount = db.prepare('SELECT COUNT(*) as c FROM config').get();
if (configCount.c === 0) {
  const insertConfig = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
  insertConfig.run('whatsapp_number', '5491121655405');
  insertConfig.run('site_title', 'ALRA Planes');
  insertConfig.run('hero_title', 'Tu Volkswagen 0km en cuotas sin interés');
  insertConfig.run('hero_subtitle', 'Financiá tu Volkswagen 0km. Adjudicación asegurada desde cuota 2. Más de 42 años acompañándote.');
}

// Import data dir
import { mkdirSync } from 'fs';
try { mkdirSync(join(__dirname, 'data'), { recursive: true }); } catch(e) {}

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
// PUBLIC ENDPOINTS (landing consume estos)
// ═══════════════════════════════════════
app.get('/api/planes', (req, res) => {
  const planes = db.prepare(`
    SELECT p.*, 
      (SELECT json_group_array(json_object('id', i.id, 'url', i.url, 'orden', i.orden))
       FROM plan_imagenes i WHERE i.plan_id = p.id ORDER BY i.orden) as imagenes_json
    FROM planes p 
    WHERE p.activo = 1 
    ORDER BY p.orden, p.id
  `).all();

  const result = planes.map(p => ({
    ...p,
    imagenes: JSON.parse(p.imagenes_json || '[]').filter(i => i.url),
    imagenes_json: undefined
  }));

  res.json(result);
});

app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const config = {};
  rows.forEach(r => config[r.key] = r.value);
  res.json(config);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════
// ADMIN ENDPOINTS (protegidos con JWT)
// ═══════════════════════════════════════

// --- PLANES CRUD ---
app.get('/api/admin/planes', authMiddleware, (req, res) => {
  const planes = db.prepare(`
    SELECT p.*, 
      (SELECT json_group_array(json_object('id', i.id, 'url', i.url, 'public_id', i.public_id, 'orden', i.orden))
       FROM plan_imagenes i WHERE i.plan_id = p.id ORDER BY i.orden) as imagenes_json
    FROM planes p ORDER BY p.orden, p.id
  `).all();

  const result = planes.map(p => ({
    ...p,
    imagenes: JSON.parse(p.imagenes_json || '[]').filter(i => i.url),
    imagenes_json: undefined
  }));

  res.json(result);
});

app.post('/api/admin/planes', authMiddleware, (req, res) => {
  const { modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, orden } = req.body;
  const result = db.prepare(`
    INSERT INTO planes (modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, orden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(modelo, version, valor || '', anticipo || '', cuota || '', tipo || '70/30', adjudicacion || 'cuota 2', whatsapp_texto || '', orden || 0);
  
  res.json({ id: result.lastInsertRowid, message: 'Plan creado' });
});

app.put('/api/admin/planes/:id', authMiddleware, (req, res) => {
  const { modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, activo, orden } = req.body;
  db.prepare(`
    UPDATE planes SET modelo=?, version=?, valor=?, anticipo=?, cuota=?, tipo=?, adjudicacion=?, whatsapp_texto=?, activo=?, orden=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(modelo, version, valor, anticipo, cuota, tipo, adjudicacion, whatsapp_texto, activo ?? 1, orden ?? 0, req.params.id);
  
  res.json({ message: 'Plan actualizado' });
});

app.delete('/api/admin/planes/:id', authMiddleware, (req, res) => {
  // Delete images from Cloudinary first
  const imagenes = db.prepare('SELECT public_id FROM plan_imagenes WHERE plan_id = ?').all(req.params.id);
  for (const img of imagenes) {
    if (img.public_id) {
      cloudinary.uploader.destroy(img.public_id).catch(() => {});
    }
  }
  db.prepare('DELETE FROM plan_imagenes WHERE plan_id = ?').run(req.params.id);
  db.prepare('DELETE FROM planes WHERE id = ?').run(req.params.id);
  res.json({ message: 'Plan eliminado' });
});

// --- IMAGENES ---
app.post('/api/admin/planes/:id/imagenes', authMiddleware, upload.single('imagen'), async (req, res) => {
  try {
    const planId = req.params.id;
    
    // Upload to Cloudinary from buffer
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { 
          folder: 'alra-planes',
          quality: 'auto',
          fetch_format: 'auto'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Get next order
    const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) as m FROM plan_imagenes WHERE plan_id = ?').get(planId);
    
    const insert = db.prepare('INSERT INTO plan_imagenes (plan_id, url, public_id, orden) VALUES (?, ?, ?, ?)');
    const dbResult = insert.run(planId, result.secure_url, result.public_id, maxOrden.m + 1);

    res.json({ 
      id: dbResult.lastInsertRowid, 
      url: result.secure_url, 
      public_id: result.public_id,
      message: 'Imagen subida' 
    });
  } catch (e) {
    console.error('Error subiendo imagen:', e);
    res.status(500).json({ error: 'Error subiendo imagen: ' + e.message });
  }
});

// Upload image from URL (for migrating existing images)
app.post('/api/admin/planes/:id/imagenes-url', authMiddleware, async (req, res) => {
  try {
    const planId = req.params.id;
    const { url } = req.body;

    const result = await cloudinary.uploader.upload(url, {
      folder: 'alra-planes',
      quality: 'auto',
      fetch_format: 'auto'
    });

    const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) as m FROM plan_imagenes WHERE plan_id = ?').get(planId);
    
    const insert = db.prepare('INSERT INTO plan_imagenes (plan_id, url, public_id, orden) VALUES (?, ?, ?, ?)');
    const dbResult = insert.run(planId, result.secure_url, result.public_id, maxOrden.m + 1);

    res.json({ 
      id: dbResult.lastInsertRowid,
      url: result.secure_url,
      message: 'Imagen migrada desde URL'
    });
  } catch (e) {
    res.status(500).json({ error: 'Error: ' + e.message });
  }
});

app.delete('/api/admin/imagenes/:id', authMiddleware, (req, res) => {
  const img = db.prepare('SELECT public_id FROM plan_imagenes WHERE id = ?').get(req.params.id);
  if (img?.public_id) {
    cloudinary.uploader.destroy(img.public_id).catch(() => {});
  }
  db.prepare('DELETE FROM plan_imagenes WHERE id = ?').run(req.params.id);
  res.json({ message: 'Imagen eliminada' });
});

// Reorder images
app.put('/api/admin/imagenes/reorder', authMiddleware, (req, res) => {
  const { orden } = req.body; // [{id: 1, orden: 0}, {id: 2, orden: 1}, ...]
  const stmt = db.prepare('UPDATE plan_imagenes SET orden = ? WHERE id = ?');
  for (const item of orden) {
    stmt.run(item.orden, item.id);
  }
  res.json({ message: 'Orden actualizado' });
});

// --- CONFIG ---
app.put('/api/admin/config', authMiddleware, (req, res) => {
  const upsert = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, value, value);
  }
  res.json({ message: 'Config actualizada' });
});

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚗 ALRA Planes API corriendo en puerto ${PORT}`);
  console.log(`📊 Admin: http://localhost:${PORT}/admin.html`);
});
