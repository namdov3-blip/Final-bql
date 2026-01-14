// Local Express server for development testing (TypeScript version)
// Run with: npx tsx server.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: UNHANDLED REJECTION:', reason);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Helper to safely run Vercel handlers
async function handle(req: Request, res: Response, importPath: string) {
    try {
        const path = require('path');
        const apiDir = path.resolve(process.cwd());
        const handlerPath = path.resolve(apiDir, `${importPath}.ts`);

        // Clear cache to ensure hot-reloading works for dynamic requirements
        delete require.cache[require.resolve(handlerPath)];

        const handler = require(handlerPath).default;
        await handler(req as any, res as any);
    } catch (e: any) {
        console.error(`ERROR handling ${req.method} ${req.url} -> ${importPath}:`, e);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message || 'Internal Server Error' });
        }
    }
}

// ============ AUTH ============
app.post('/api/auth/login', (req, res) => handle(req, res, './api/auth/login'));
app.get('/api/auth/me', (req, res) => handle(req, res, './api/auth/me'));

// ============ PROJECTS ============
app.get('/api/projects', (req, res) => handle(req, res, './api/projects/index'));
app.post('/api/projects', (req, res) => handle(req, res, './api/projects/index'));

app.get('/api/projects/:id', (req, res) => {
    Object.assign(req.query, req.params);
    console.log(`[SERVER] GET Project: ID=${req.params.id}, Query:`, req.query);
    handle(req, res, './api/projects/[id]');
});
app.put('/api/projects/:id', (req, res) => {
    Object.assign(req.query, req.params);
    console.log(`[SERVER] PUT Project: ID=${req.params.id}, Query:`, req.query);
    handle(req, res, './api/projects/[id]');
});
app.delete('/api/projects/:id', (req, res) => {
    Object.assign(req.query, req.params);
    console.log(`[SERVER] DELETE Project: ID=${req.params.id}, Query:`, req.query);
    handle(req, res, './api/projects/[id]');
});

app.post('/api/projects/import', (req, res) => handle(req, res, './api/projects/import'));

// ============ TRANSACTIONS ============
app.get('/api/transactions', (req, res) => handle(req, res, './api/transactions/index'));

app.get('/api/transactions/:id', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    console.log(`[SERVER] GET Transaction ID: ${req.params.id}`);
    handle(req, res, './api/transactions/[id]');
});
app.put('/api/transactions/:id', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/transactions/[id]');
});
app.put('/api/transactions/:id/status', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/transactions/[id]/status');
});
app.post('/api/transactions/:id/refund', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/transactions/[id]/refund');
});
app.get('/api/transactions/:id/qr', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/transactions/[id]/qr');
});

app.all('/api/transactions/confirm/:token', (req, res) => {
    Object.assign(req.query, req.params);
    handle(req, res, './api/transactions/confirm/[token]');
});

// ============ BANK ============
app.get('/api/bank/balance', (req, res) => handle(req, res, './api/bank/balance'));
app.get('/api/bank/transactions', (req, res) => handle(req, res, './api/bank/transactions'));
app.post('/api/bank/transactions', (req, res) => handle(req, res, './api/bank/transactions'));
app.post('/api/bank/adjust-opening', (req, res) => handle(req, res, './api/bank/adjust-opening'));
app.all('/api/bank/calculate-interest', (req, res) => handle(req, res, './api/bank/calculate-interest'));

// ============ USERS ============
app.get('/api/users', (req, res) => handle(req, res, './api/users/index'));
app.post('/api/users', (req, res) => handle(req, res, './api/users/index'));

app.get('/api/users/:id', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/users/[id]');
});
app.put('/api/users/:id', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/users/[id]');
});
app.delete('/api/users/:id', (req, res) => {
    req.query = { ...req.query, id: req.params.id };
    handle(req, res, './api/users/[id]');
});

// ============ SETTINGS ============
app.get('/api/settings/interest-rate', (req, res) => handle(req, res, './api/settings/interest-rate'));
app.put('/api/settings/interest-rate', (req, res) => handle(req, res, './api/settings/interest-rate'));

// ============ AUDIT LOGS ============
app.get('/api/audit-logs', (req, res) => handle(req, res, './api/audit-logs'));

// ============ POLLING ============
app.get('/api/events/poll', (req, res) => handle(req, res, './api/events/poll'));

// Start server
const server = app.listen(PORT, () => {
    console.log(`
====================================
🚀 API Server running on http://localhost:${PORT}
====================================
  `);
});

server.on('error', (e) => {
    console.error('SERVER ERROR:', e);
});
