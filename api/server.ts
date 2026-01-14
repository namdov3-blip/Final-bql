import { VercelRequest, VercelResponse } from '@vercel/node';

// Import all handlers
import authLogin from './auth/login';
import authMe from './auth/me';
import projectsIndex from './projects/index';
import projectsId from './projects/[id]';
import projectsImport from './projects/import';
import transactionsIndex from './transactions/index';
import transactionsId from './transactions/[id]';
import transactionsStatus from './transactions/[id]/status';
import transactionsRefund from './transactions/[id]/refund';
import transactionsQr from './transactions/[id]/qr';
import transactionsConfirm from './transactions/confirm/[token]';
import bankBalance from './bank/balance';
import bankTransactions from './bank/transactions';
import bankAdjustOpening from './bank/adjust-opening';
import bankCalculateInterest from './bank/calculate-interest';
import usersIndex from './users/index';
import usersId from './users/[id]';
import settingsInterestRate from './settings/interest-rate';
import auditLogs from './audit-logs';
import eventsPoll from './events/poll';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url } = req;
    if (!url) return res.status(400).json({ error: 'Invalid request' });

    // Extract path without query parameters
    const path = url.split('?')[0];

    try {
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
            return await transactionsConfirm(req, res);
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
            return await transactionsQr(req, res);
        }
        if (path.startsWith('/api/transactions/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await transactionsId(req, res);
        }

        // Bank
        if (path === '/api/bank/balance') return await bankBalance(req, res);
        if (path === '/api/bank/transactions') return await bankTransactions(req, res);
        if (path === '/api/bank/adjust-opening') return await bankAdjustOpening(req, res);
        if (path === '/api/bank/calculate-interest') return await bankCalculateInterest(req, res);

        // Users
        if (path === '/api/users') return await usersIndex(req, res);
        if (path.startsWith('/api/users/')) {
            const id = path.split('/')[3];
            req.query.id = id;
            return await usersId(req, res);
        }

        // Settings
        if (path === '/api/settings/interest-rate') return await settingsInterestRate(req, res);

        // Audit Logs
        if (path === '/api/audit-logs') return await auditLogs(req, res);

        // Events
        if (path === '/api/events/poll') return await eventsPoll(req, res);

        return res.status(404).json({ error: 'Route not found' });
    } catch (error: any) {
        console.error('Consolidated API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
