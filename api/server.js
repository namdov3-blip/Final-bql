const authLogin = require('../backend/handlers/auth/login').default;
const authMe = require('../backend/handlers/auth/me').default;
const projectsIndex = require('../backend/handlers/projects/index').default;
const projectsImport = require('../backend/handlers/projects/import').default;
const projectsId = require('../backend/handlers/projects/_id').default;
const transactionsIndex = require('../backend/handlers/transactions/index').default;
const transactionsToken = require('../backend/handlers/transactions/confirm/_token').default;
const transactionsStatus = require('../backend/handlers/transactions/[id]/status').default;
const transactionsRefund = require('../backend/handlers/transactions/[id]/refund').default;
const transactionsQR = require('../backend/handlers/transactions/[id]/qr').default;
const transactionsId = require('../backend/handlers/transactions/_id').default;
const bankBalance = require('../backend/handlers/bank/balance').default;
const bankTransactions = require('../backend/handlers/bank/transactions').default;
const bankAdjust = require('../backend/handlers/bank/adjust-opening').default;
const bankInterest = require('../backend/handlers/bank/calculate-interest').default;
const usersIndex = require('../backend/handlers/users/index').default;
const usersId = require('../backend/handlers/users/_id').default;
const settingsInterest = require('../backend/handlers/settings/interest-rate').default;
const auditLogs = require('../backend/handlers/audit-logs').default;
const eventsPoll = require('../backend/handlers/events/poll').default;

module.exports = async (req, res) => {
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
                message: 'Consolidated API JS is working',
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
            req.query.id = path.split('/')[3];
            return await projectsId(req, res);
        }

        // Transactions
        if (path === '/api/transactions') return await transactionsIndex(req, res);
        if (path.startsWith('/api/transactions/confirm/')) {
            req.query.token = path.split('/')[4];
            return await transactionsToken(req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/status$/)) {
            req.query.id = path.split('/')[3];
            return await transactionsStatus(req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/refund$/)) {
            req.query.id = path.split('/')[3];
            return await transactionsRefund(req, res);
        }
        if (path.match(/\/api\/transactions\/[^/]+\/qr$/)) {
            req.query.id = path.split('/')[3];
            return await transactionsQR(req, res);
        }
        if (path.startsWith('/api/transactions/')) {
            req.query.id = path.split('/')[3];
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
            req.query.id = path.split('/')[3];
            return await usersId(req, res);
        }

        // Settings
        if (path === '/api/settings/interest-rate') return await settingsInterest(req, res);

        // Audit Logs
        if (path === '/api/audit-logs') return await auditLogs(req, res);

        // Events
        if (path === '/api/events/poll') return await eventsPoll(req, res);

        return res.status(404).json({ error: 'Route not found: ' + path });
    } catch (error) {
        console.error('API Router Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
