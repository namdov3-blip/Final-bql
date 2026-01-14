import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../lib/mongodb';
import { Transaction, AuditLog } from '../../lib/models';
import { authMiddleware } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const payload = await authMiddleware(req, res);
        if (!payload) return;

        await connectDB();

        const id = req.query.id || (req as any).params?.id;
        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Transaction ID is required' });
        }

        // GET - Get transaction by ID
        if (req.method === 'GET') {
            const transaction = await (Transaction as any).findById(id)
                .populate('projectId', 'code name interestStartDate');

            if (!transaction) {
                return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
            }

            return res.status(200).json({ success: true, data: transaction });
        }

        // PUT - Update transaction
        if (req.method === 'PUT') {
            const {
                household,
                compensation,
                supplementaryAmount,
                supplementaryNote,
                effectiveInterestDate,
                notes
            } = req.body;

            const transaction = await (Transaction as any).findById(id);
            if (!transaction) {
                return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
            }

            // Update fields
            if (household) {
                transaction.household = { ...transaction.household, ...household };
            }
            if (compensation) {
                transaction.compensation = { ...transaction.compensation, ...compensation };
            }
            if (supplementaryAmount !== undefined) {
                transaction.supplementaryAmount = supplementaryAmount;
            }
            if (supplementaryNote !== undefined) {
                transaction.supplementaryNote = supplementaryNote;
            }
            if (effectiveInterestDate) {
                transaction.effectiveInterestDate = new Date(effectiveInterestDate);
            }
            if (notes !== undefined) {
                transaction.notes = notes;
            }

            // Add history
            transaction.history.push({
                timestamp: new Date(),
                action: 'Cập nhật thông tin',
                details: 'Đã cập nhật thông tin hồ sơ',
                actor: payload.name
            });

            await transaction.save();

            await (AuditLog as any).create({
                actor: payload.name,
                role: payload.role,
                action: 'Cập nhật giao dịch',
                target: `Giao dịch ${transaction._id}`,
                details: `Cập nhật hồ sơ hộ ${transaction.household.name}`
            });

            return res.status(200).json({ success: true, data: transaction });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error: any) {
        console.error('Transaction API error:', error);
        return res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
}
