import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { Transaction, BankTransaction, AuditLog, Project, Settings } from '../../../lib/models';
import { authMiddleware } from '../../../lib/auth';

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
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

        const { refundedAmount } = req.body;
        // #region agent log
        fetch('http://127.0.0.1:7245/ingest/99173cb6-623f-4d60-9e61-53b6a11271d2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'refund.ts:34',message:'Received refundedAmount from frontend',data:{refundedAmount,transactionId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'refund-debug'})}).catch(()=>{});
        // #endregion
        if (!refundedAmount || refundedAmount <= 0) {
            return res.status(400).json({ error: 'Số tiền hoàn trả phải lớn hơn 0' });
        }

        // Get transaction to find project
        const transaction = await (Transaction as any).findById(id);
        // #region agent log
        fetch('http://127.0.0.1:7245/ingest/99173cb6-623f-4d60-9e61-53b6a11271d2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'refund.ts:43',message:'Transaction loaded for refund',data:{transactionId:id,status:transaction?.status,disbursedTotal:(transaction as any)?.disbursedTotal,totalApproved:transaction?.compensation?.totalApproved,supplementaryAmount:transaction?.supplementaryAmount,refundedAmount},timestamp:Date.now(),sessionId:'debug-session',runId:'refund-debug'})}).catch(()=>{});
        // #endregion
        if (!transaction) {
            return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
        }

        const project = await (Project as any).findById(transaction.projectId);
        const org = project?.organization;
        if (!org) {
            return res.status(400).json({ error: 'Không tìm thấy thông tin tổ chức của dự án' });
        }

        const now = new Date();

        // Get current bank balance for this organization
        const lastBankTx = await (BankTransaction as any).findOne({ organization: org }).sort({ _id: -1 });
        const settings = await (Settings as any).findOne({ key: 'global' });
        const openingBalance = settings?.bankOpeningBalance || 0;
        const currentBalance = lastBankTx?.runningBalance || openingBalance;

        // Create deposit (refund)
        const newBalance = currentBalance + refundedAmount;
        const bankTx = await (BankTransaction as any).create({
            type: 'Nạp tiền',
            amount: refundedAmount,
            date: now,
            note: `Hoàn quỹ hồ sơ: ${transaction._id} - Hộ: ${transaction.household.name}`,
            createdBy: payload.name,
            runningBalance: newBalance,
            organization: org,
            projectId: project?._id
        });
        // #region agent log
        fetch('http://127.0.0.1:7245/ingest/99173cb6-623f-4d60-9e61-53b6a11271d2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'refund.ts:76',message:'Bank transaction created for refund',data:{refundedAmount,bankTxAmount:bankTx.amount,currentBalance,newBalance,transactionId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'refund-debug'})}).catch(()=>{});
        // #endregion

        // Update transaction
        transaction.status = 'Tồn đọng/Giữ hộ';
        // FIX: Keep original principal (don't include old interest in totalApproved)
        // refundedAmount may include interest from disbursedTotal, but totalApproved should only be principal
        // transaction.compensation.totalApproved remains unchanged (stays as original principal)
        transaction.disbursementDate = undefined;
        // Set effectiveInterestDate to now (matching agribank-crm approach)
        // When calculateInterest uses setHours(0,0,0,0), this will normalize to today 00:00
        // and ensure no interest is calculated for today (days = 0)
        transaction.effectiveInterestDate = now;
        transaction.supplementaryAmount = 0;
        transaction.supplementaryNote = undefined;

        transaction.history.push({
            timestamp: now,
            action: 'Nạp tiền / Hoàn quỹ',
            details: `Hoàn lại ${formatCurrency(refundedAmount)}`,
            totalAmount: refundedAmount,
            actor: payload.name
        });

        await transaction.save();

        await (AuditLog as any).create({
            actor: payload.name,
            role: payload.role,
            action: 'Nạp tiền / Hoàn quỹ',
            target: `Giao dịch ${transaction._id}`,
            details: `Hoàn lại ${formatCurrency(refundedAmount)} cho hộ ${transaction.household.name}`
        });

        // Reload transaction to ensure all fields are properly serialized
        const updatedTransaction = await (Transaction as any).findById(id);
        const transactionData = updatedTransaction.toObject ? updatedTransaction.toObject({ virtuals: true }) : updatedTransaction;

        return res.status(200).json({ 
            success: true, 
            data: {
                ...transactionData,
                id: transactionData.id || transactionData._id?.toString()
            }
        });

    } catch (error: any) {
        console.error('Refund error:', error);
        return res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
}
