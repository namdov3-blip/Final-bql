import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { Transaction, Project, BankTransaction, AuditLog, Settings } from '../../../lib/models';
import { authMiddleware } from '../../../lib/auth';

// Helper functions
function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function calculateInterest(
    principal: number,
    annualRate: number,
    startDate: Date | string | undefined,
    endDate: Date
): number {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return 0;
    const dailyRate = annualRate / 100 / 365;
    return Math.round(principal * dailyRate * days);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'PUT') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const payload = await authMiddleware(req, res);
        if (!payload) return;

        await connectDB();

        const id = req.query.id || (req as any).params?.id;
        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Transaction ID is required' });
        }

        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const transaction = await (Transaction as any).findById(id);
        if (!transaction) {
            return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
        }

        const project = await (Project as any).findById(transaction.projectId);
        const settings = await (Settings as any).findOne({ key: 'global' }) || { interestRate: 6.5 };
        const interestRate = settings.interestRate;

        const now = new Date();
        const previousStatus = transaction.status;

        // Handle disbursement
        if (status === 'Đã giải ngân' && previousStatus !== 'Đã giải ngân') {
            const baseDate = transaction.effectiveInterestDate || project?.interestStartDate;
            const interest = calculateInterest(
                transaction.compensation.totalApproved,
                interestRate,
                baseDate,
                now
            );
            const supplementary = transaction.supplementaryAmount || 0;
            const totalFinal = transaction.compensation.totalApproved + interest + supplementary;

            // Get current bank balance for this organization
            const org = project?.organization;
            if (!org) {
                return res.status(400).json({ error: 'Không tìm thấy thông tin tổ chức của dự án' });
            }

            const lastBankTx = await (BankTransaction as any).findOne({ organization: org }).sort({ date: -1 });
            const settingsForBalance = await (Settings as any).findOne({ key: 'global' });
            const openingBalance = settingsForBalance?.bankOpeningBalance || 0;
            const currentBalance = lastBankTx?.runningBalance || openingBalance;

            // Create withdrawal
            await (BankTransaction as any).create({
                type: 'Rút tiền',
                amount: -totalFinal,
                date: now,
                note: `Chi trả dự án: ${project?.code} - Hộ: ${transaction.household.name}`,
                createdBy: payload.name,
                runningBalance: currentBalance - totalFinal,
                organization: org,
                projectId: project?._id
            });

            transaction.disbursementDate = now;
            transaction.history.push({
                timestamp: now,
                action: 'Xác nhận chi trả',
                details: `Giải ngân hồ sơ. Gốc: ${formatCurrency(transaction.compensation.totalApproved)}, Lãi: ${formatCurrency(interest)}, Bổ sung: ${formatCurrency(supplementary)}, Tổng: ${formatCurrency(totalFinal)}`,
                totalAmount: totalFinal,
                actor: payload.name
            });

            await (AuditLog as any).create({
                actor: payload.name,
                role: payload.role,
                action: 'Xác nhận chi trả',
                target: `Giao dịch ${transaction._id}`,
                details: `Giải ngân ${formatCurrency(totalFinal)} cho hộ ${transaction.household.name}`
            });
        }

        transaction.status = status;
        await transaction.save();

        return res.status(200).json({ success: true, data: transaction });

    } catch (error: any) {
        console.error('Status update error:', error);
        return res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
}
