require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// MySQL Credentials Configuration
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '150705'; // Yahan apna direct MySQL password fallback me daal sakte hain
const DB_NAME = process.env.DB_NAME || 'jangid_db';
const DB_PORT = Number(process.env.DB_PORT) || 3306;

// MySQL Connection Pool
const db = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  port: DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Database Auto Initialization
async function initDb() {
  try {
    const connection = await db.getConnection();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS gallery (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        src TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        project_type VARCHAR(100),
        budget VARCHAR(100),
        city VARCHAR(100),
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    connection.release();
    console.log('MySQL Database Connected & Tables Verified successfully.');
  } catch (err) {
    console.error('MySQL connection error:', err.message);
  }
}
initDb();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Jangid@2026';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const sessions = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function text(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
  }));
}

function setCookie(res, name, value, maxAge = 0) {
  const secure = COOKIE_SECURE ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function isAdmin(req) {
  const token = parseCookies(req).ji_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  json(res, 401, { error: 'Please sign in to access the admin area.' });
  return false;
}

function readBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('The uploaded image is larger than 8 MB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('Invalid upload request.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {};
  let file = null;
  let cursor = buffer.indexOf(boundary) + boundary.length + 2;
  while (cursor > boundary.length + 1 && cursor < buffer.length) {
    const nextBoundary = buffer.indexOf(boundary, cursor);
    if (nextBoundary === -1) break;
    const part = buffer.subarray(cursor, nextBoundary - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const value = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/i.exec(headers);
      const fileNameMatch = /filename="([^"]*)"/i.exec(headers);
      if (nameMatch) {
        if (fileNameMatch && fileNameMatch[1]) {
          const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
          file = { field: nameMatch[1], filename: path.basename(fileNameMatch[1]), mime: typeMatch ? typeMatch[1].trim() : '', data: value };
        } else {
          fields[nameMatch[1]] = value.toString('utf8').trim();
        }
      }
    }
    cursor = nextBoundary + boundary.length + 2;
  }
  return { fields, file };
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    text(res, 404, 'Page not found.');
    return;
  }
  res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/gallery') {
    try {
      const [rows] = await db.query('SELECT id, title, category, src, created_at AS createdAt FROM gallery ORDER BY created_at DESC');
      return json(res, 200, { gallery: rows });
    } catch (err) {
      return json(res, 500, { error: 'Failed to fetch gallery.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/enquiries') {
    try {
      const raw = await readBody(req, 40 * 1024);
      const body = JSON.parse(raw.toString('utf8') || '{}');
      await db.query(
        'INSERT INTO leads (name, phone, email, project_type, budget, city, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [body.name, body.phone, body.email || null, body.projectType || null, body.budget || null, body.city || null, body.message]
      );
      return json(res, 201, { message: 'Thank you. Your request has been received.' });
    } catch (error) {
      return json(res, 400, { error: 'Failed to submit enquiry.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    try {
      const raw = await readBody(req, 20 * 1024);
      const body = JSON.parse(raw.toString('utf8') || '{}');
      if (body.username === ADMIN_USERNAME && body.password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
        setCookie(res, 'ji_session', token, 24 * 60 * 60);
        return json(res, 200, { authenticated: true });
      }
      return json(res, 401, { error: 'Incorrect credentials.' });
    } catch {
      return json(res, 400, { error: 'Sign in failed.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const token = parseCookies(req).ji_session;
    if (token) sessions.delete(token);
    setCookie(res, 'ji_session', '', 0);
    return json(res, 200, { authenticated: false });
  }

  if (req.method === 'GET' && pathname === '/api/admin/session') {
    return json(res, 200, { authenticated: isAdmin(req) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/gallery') {
    if (!requireAdmin(req, res)) return;
    try {
      const [rows] = await db.query('SELECT id, title, category, src, created_at AS createdAt FROM gallery ORDER BY created_at DESC');
      return json(res, 200, { gallery: rows });
    } catch {
      return json(res, 500, { error: 'Failed to load gallery.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/gallery') {
    if (!requireAdmin(req, res)) return;
    try {
      const raw = await readBody(req);
      const { fields, file } = parseMultipart(raw, req.headers['content-type']);
      if (!fields.title || !fields.category || !file) throw new Error('Missing fields.');

      const ext = path.extname(file.filename) || '.jpg';
      const uniqueFileName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(UPLOADS_DIR, uniqueFileName);
      
      fs.writeFileSync(filePath, file.data);
      const publicSrc = `/uploads/${uniqueFileName}`;

      const [result] = await db.query(
        'INSERT INTO gallery (title, category, src) VALUES (?, ?, ?)',
        [fields.title, fields.category, publicSrc]
      );

      return json(res, 201, { photo: { id: result.insertId, title: fields.title, category: fields.category, src: publicSrc } });
    } catch (error) {
      return json(res, 400, { error: error.message || 'Image upload failed.' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/admin/enquiries') {
    if (!requireAdmin(req, res)) return;
    try {
      const [rows] = await db.query('SELECT id, name, phone, email, project_type AS projectType, budget, city, message, created_at AS createdAt FROM leads ORDER BY created_at DESC');
      return json(res, 200, { enquiries: rows });
    } catch {
      return json(res, 500, { error: 'Failed to load enquiries.' });
    }
  }

  const galleryDeleteMatch = /^\/api\/admin\/gallery\/([0-9]+)$/.exec(pathname);
  if (req.method === 'DELETE' && galleryDeleteMatch) {
    if (!requireAdmin(req, res)) return;
    const photoId = galleryDeleteMatch[1];
    try {
      const [photos] = await db.query('SELECT src FROM gallery WHERE id = ?', [photoId]);
      if (photos.length === 0) return json(res, 404, { error: 'Photo not found.' });

      const imagePath = path.join(PUBLIC_DIR, photos[0].src);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }

      await db.query('DELETE FROM gallery WHERE id = ?', [photoId]);
      return json(res, 200, { deleted: true });
    } catch {
      return json(res, 500, { error: 'Failed to delete photo.' });
    }
  }

  json(res, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method not allowed.');
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => console.log(`Jangid Interior running at http://localhost:${PORT}`));