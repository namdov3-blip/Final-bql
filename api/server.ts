import { VercelRequest, VercelResponse } from '@vercel/node';

// Import all handlers
import authLogin from '../backend/handlers/auth/login';
import authMe from '../backend/handlers/auth/me';
import projectsIndex from '../backend/handlers/projects/index';
import projectsImport from '../backend/handlers/projects/import';
import projectsId from '../backend/handlers/projects/_id';
import transactionsIndex from '../backend/handlers/transactions/index';
import transactionsToken from '../backend/handlers/transactions/confirm/_token';
import transactionsStatus from '../backend/handlers/transactions/update-status';
import transactionsRefund from '../backend/handlers/transactions/refund';
import transactionsQR from '../backend/handlers/transactions/generate-qr';
import transactionsId from '../backend/handlers/transactions/_id';
import bankBalance from '../backend/handlers/bank/balance';
import bankTransactions from '../backend/handlers/bank/transactions';
import bankAdjust from '../backend/handlers/bank/adjust-opening';
import bankInterest from '../backend/handlers/bank/calculate-interest';
import usersIndex from '../backend/handlers/users/index';
import usersId from '../backend/handlers/users/_id';
import settingsInterest from '../backend/handlers/settings/interest-rate';
import auditLogs from '../backend/handlers/audit-logs';
import eventsPoll from '../backend/handlers/events/poll';

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
                message: 'Consolidated API TS is working',
                env: {
                    hasMongo: !!process.env.MONGODB_URI,
                    hasJWT: !!process.env.JWT_SECRET
                }
            });
        }

        // Auth
        if (path === '/api/auth/login') return await authLogin(req, res);
        if (path === '/api/auth/me') return await authMe(req, res);

        // Projects
        if (path === '/api/projects') return await projectsIndex(req, res);
        if (path === '/api/projects/import') return await projectsImport(req, res);
        if (path.startsWith('/api/projects/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await projectsId(req, res);
        }

        // Transactions
        if (path === '/api/transactions') return await transactionsIndex(req, res);
        if (path.startsWith('/api/transactions/confirm/')) {
            const token = path.split('/')[4];
            req.query.token = token;
            return await transactionsToken(req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/status$/)) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await transactionsStatus(req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/refund$/)) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await transactionsRefund(req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/qr$/)) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await transactionsQR(req, res);
        }
        if (path.startsWith('/api/transactions/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await transactionsId(req, res);
        }

        // Bank
        if (path === '/api/bank/balance') return await bankBalance(req, res);
        if (path === '/api/bank/transactions') return await bankTransactions(req, res);
        if (path === '/api/bank/adjust-opening') return await bankAdjust(req, res);
        if (path === '/api/bank/calculate-interest') return await bankInterest(req, res);

        // Users
        if (path === '/api/users') return await usersIndex(req, res);
        if (path.startsWith('/api/users/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await usersId(req, res);
        }

        // Settings
        if (path === '/api/settings/interest-rate') return await settingsInterest(req, res);

        // Audit Logs
        if (path === '/api/audit-logs') return await auditLogs(req, res);

        // Events
        if (path === '/api/events/poll') return await eventsPoll(req, res);

        return res.status(404).json({ error: 'Route not found: ' + path });
    } catch (error: any) {
        console.error('Consolidated API Router Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
