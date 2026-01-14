import { VercelRequest, VercelResponse } from '@vercel/node';

// helper to safely import and run a handler
async function runHandler(importPromise: Promise<any>, req: VercelRequest, res: VercelResponse) {
    try {
        const module = await importPromise;
        const handler = module.default;
        if (typeof handler !== 'function') {
            throw new Error('Module does not export a default function handler');
        }
        return await handler(req, res);
    } catch (error: any) {
        console.error('Handler error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            details: error.message
        });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url, method } = req;
    if (!url) return res.status(400).json({ error: 'Invalid request' });

    console.log(`[API] ${method} ${url}`);

    // Extract path without query parameters
    const path = url.split('?')[0];

    try {
        // Health check
        if (path === '/api/health') {
            return res.status(200).json({
                status: 'ok',
                message: 'Consolidated API is working',
                env: {
                    hasMongo: !!process.env.MONGODB_URI,
                    hasJWT: !!process.env.JWT_SECRET
                }
            });
        }

        // Auth
        if (path === '/api/auth/login') return await runHandler(import('../backend/handlers/auth/login'), req, res);
        if (path === '/api/auth/me') return await runHandler(import('../backend/handlers/auth/me'), req, res);

        // Projects
        if (path === '/api/projects') return await runHandler(import('../backend/handlers/projects/index'), req, res);
        if (path === '/api/projects/import') return await runHandler(import('../backend/handlers/projects/import'), req, res);
        if (path.startsWith('/api/projects/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await runHandler(import('../backend/handlers/projects/_id'), req, res);
        }

        // Transactions
        if (path === '/api/transactions') return await runHandler(import('../backend/handlers/transactions/index'), req, res);
        if (path.startsWith('/api/transactions/confirm/')) {
            const token = path.split('/')[4];
            req.query.token = token;
            return await runHandler(import('../backend/handlers/transactions/confirm/_token'), req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/status$/)) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await runHandler(import('../backend/handlers/transactions/[id]/status'), req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/refund$/)) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await runHandler(import('../backend/handlers/transactions/[id]/refund'), req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/qr$/)) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await runHandler(import('../backend/handlers/transactions/[id]/qr'), req, res);
        }
        if (path.startsWith('/api/transactions/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await runHandler(import('../backend/handlers/transactions/_id'), req, res);
        }

        // Bank
        if (path === '/api/bank/balance') return await runHandler(import('../backend/handlers/bank/balance'), req, res);
        if (path === '/api/bank/transactions') return await runHandler(import('../backend/handlers/bank/transactions'), req, res);
        if (path === '/api/bank/adjust-opening') return await runHandler(import('../backend/handlers/bank/adjust-opening'), req, res);
        if (path === '/api/bank/calculate-interest') return await runHandler(import('../backend/handlers/bank/calculate-interest'), req, res);

        // Users
        if (path === '/api/users') return await runHandler(import('../backend/handlers/users/index'), req, res);
        if (path.startsWith('/api/users/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await runHandler(import('../backend/handlers/users/_id'), req, res);
        }

        // Settings
        if (path === '/api/settings/interest-rate') return await runHandler(import('../backend/handlers/settings/interest-rate'), req, res);

        // Audit Logs
        if (path === '/api/audit-logs') return await runHandler(import('../backend/handlers/audit-logs'), req, res);

        // Events
        if (path === '/api/events/poll') return await runHandler(import('../backend/handlers/events/poll'), req, res);

        return res.status(404).json({ error: 'Route not found' });
    } catch (error: any) {
        console.error('Consolidated API Router Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
