// server.js
// Main Application Server for NSS Unit 09 T-Shirt Registration & Payment Portal.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const url = require('node:url');

const config = require('./src/config');
const { sweepExpiredReservations } = require('./src/stock');
const { processQueue } = require('./src/syncQueue');

// Route Handlers
const studentRoutes = require('./src/routes/student');
const webhookRoutes = require('./src/routes/webhook');
const adminRoutes = require('./src/routes/admin');

const PUBLIC_DIR = path.resolve(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

/**
 * Serves static files from public/ directory
 */
function serveStaticFile(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied');
  }

  fs.stat(resolved, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback: If not found and not an API call, serve index.html
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('File Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(resolved, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Internal Server Error reading file');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

/**
 * Reads request body as Buffer and parses JSON if applicable
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      let jsonBody = null;
      if (rawBody.length > 0) {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            jsonBody = JSON.parse(rawBody.toString('utf8'));
          } catch (e) {
            // Leave jsonBody as null
          }
        }
      }
      resolve({ rawBody, jsonBody });
    });
    req.on('error', reject);
  });
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  // Global CORS and Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Signature');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const searchParams = parsedUrl.searchParams;

  try {
    // -------------------------------------------------------------
    // API Routes
    // -------------------------------------------------------------

    // Student: Live Stock
    if (req.method === 'GET' && pathname === '/api/stock') {
      return studentRoutes.handleGetStock(req, res);
    }

    // Student: Order Creation
    if (req.method === 'POST' && pathname === '/api/orders/create') {
      const { jsonBody } = await parseRequestBody(req);
      return await studentRoutes.handleCreateOrder(req, res, jsonBody);
    }

    // Student: Payment Verification
    if (req.method === 'POST' && pathname === '/api/payments/verify') {
      const { jsonBody } = await parseRequestBody(req);
      return await studentRoutes.handleVerifyPayment(req, res, jsonBody);
    }

    // Student: Secure Status Lookup
    if (req.method === 'GET' && pathname === '/api/orders/lookup') {
      return studentRoutes.handleLookupOrder(req, res, searchParams);
    }

    // Student: Razorpay Payment Link Return Callback
    if (req.method === 'GET' && pathname === '/api/payments/callback') {
      return studentRoutes.handlePaymentCallback(req, res, searchParams);
    }

    // Student: Submit Direct UPI Proof (UTR & Screenshot)
    if (req.method === 'POST' && pathname === '/api/orders/submit-proof') {
      const { jsonBody } = await parseRequestBody(req);
      return studentRoutes.handleSubmitProof(req, res, jsonBody);
    }

    // Razorpay Webhook (requires raw buffer for HMAC verification)
    if (req.method === 'POST' && pathname === '/api/payments/webhook') {
      const { rawBody } = await parseRequestBody(req);
      return await webhookRoutes.handleRazorpayWebhook(req, res, rawBody);
    }

    // Admin: Login
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const { jsonBody } = await parseRequestBody(req);
      return adminRoutes.handleAdminLogin(req, res, jsonBody);
    }

    // Admin: Summary Dashboard Stats
    if (req.method === 'GET' && pathname === '/api/admin/summary') {
      return adminRoutes.handleAdminSummary(req, res);
    }

    // Admin: List Registrations
    if (req.method === 'GET' && pathname === '/api/admin/registrations') {
      return adminRoutes.handleGetRegistrations(req, res, searchParams);
    }

    // Admin: Update Notes on Registration
    const notesMatch = pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/notes$/);
    if (req.method === 'POST' && notesMatch) {
      const regId = decodeURIComponent(notesMatch[1]);
      const { jsonBody } = await parseRequestBody(req);
      return adminRoutes.handleUpdateNotes(req, res, regId, jsonBody);
    }

    // Admin: Manual Resolution for Exception Cases
    const resolveMatch = pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/resolve$/);
    if (req.method === 'POST' && resolveMatch) {
      const regId = decodeURIComponent(resolveMatch[1]);
      const { jsonBody } = await parseRequestBody(req);
      return adminRoutes.handleResolveRegistration(req, res, regId, jsonBody);
    }

    // Admin: One-click Approve Order
    const approveMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const regId = decodeURIComponent(approveMatch[1]);
      return adminRoutes.handleApproveOrder(req, res, regId);
    }

    // Admin: One-click Reject Order
    const rejectMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      const regId = decodeURIComponent(rejectMatch[1]);
      const { jsonBody } = await parseRequestBody(req);
      return adminRoutes.handleRejectOrder(req, res, regId, jsonBody);
    }

    // Admin: Auto-Match UTRs from Email/SMS Text
    if (req.method === 'POST' && pathname === '/api/admin/auto-match') {
      const { jsonBody } = await parseRequestBody(req);
      return adminRoutes.handleAutoMatch(req, res, jsonBody);
    }

    // Admin: Export CSV
    if (req.method === 'GET' && pathname === '/api/admin/export/csv') {
      return adminRoutes.handleExportCSV(req, res);
    }

    // Admin: Manual Trigger Google Sheets Sync
    if (req.method === 'POST' && pathname === '/api/admin/sheets/sync') {
      return await adminRoutes.handleTriggerSheetSync(req, res);
    }

    // Admin: Get Settings
    if (req.method === 'GET' && pathname === '/api/admin/settings') {
      return adminRoutes.handleGetSettings(req, res);
    }

    // Admin: Update Settings
    if (req.method === 'POST' && pathname === '/api/admin/settings') {
      const { jsonBody } = await parseRequestBody(req);
      return adminRoutes.handleUpdateSettings(req, res, jsonBody);
    }

    // -------------------------------------------------------------
    // Static Files (Frontend UI)
    // -------------------------------------------------------------
    return serveStaticFile(req, res, pathname);

  } catch (err) {
    console.error('[Server] Unhandled request error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

// Start Server
const HOST = process.env.HOST || '0.0.0.0';
server.listen(config.port, HOST, () => {
  console.log('================================================================');
  console.log(`  NSS Unit 09 T-Shirt Registration & Payment Portal`);
  console.log(`  Running at: http://localhost:${config.port}`);
  console.log(`  Strict Stock Limit: ${config.totalStockLimit} T-Shirts`);
  console.log(`  Price Per T-Shirt: ${config.formatINR(config.unitPricePaise)} (${config.unitPricePaise} paise)`);
  console.log(`  Razorpay Mode: ${config.razorpay.isConfigured ? 'LIVE/TEST KEYS CONFIGURED' : (config.razorpay.enableDevMock ? 'DEV SIMULATION ENABLED' : 'PENDING KEYS')}`);
  console.log(`  Google Sheets Sync: ${config.sheets.isConfigured ? 'ACTIVE' : 'PLACEHOLDER MODE (Queued locally)'}`);
  console.log(`  Owner Admin Email: ${config.admin.email}`);
  console.log('================================================================');
});

// Background Tasks
// 1. Stock Sweeper: Releases expired reservations every 30 seconds
setInterval(() => {
  try {
    const expiredCount = sweepExpiredReservations();
    if (expiredCount > 0) {
      console.log(`[Sweeper] Automatically released ${expiredCount} expired reservation(s) back to stock pool.`);
    }
  } catch (err) {
    console.error('[Sweeper] Error in sweep interval:', err.message);
  }
}, 30 * 1000);

// 2. Google Sheets Queue Worker: Retries pending sync jobs every 20 seconds
setInterval(async () => {
  try {
    await processQueue();
  } catch (err) {
    console.error('[Queue Worker] Error in queue worker interval:', err.message);
  }
}, 20 * 1000);

module.exports = server;
