import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { Transaction, Project, Settings } from '../../../lib/models';
import { generateQRToken } from '../../../lib/auth';
import QRCode from 'qrcode';

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await connectDB();

        const id = req.query.id || (req as any).params?.id;
        const { format = 'json' } = req.query;

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Transaction ID is required' });
        }

        const transaction = await (Transaction as any).findById(id);
        if (!transaction) {
            return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
        }

        if (transaction.status === 'Đã giải ngân') {
            return res.status(400).json({ error: 'Giao dịch đã được giải ngân' });
        }

        const project = await (Project as any).findById(transaction.projectId);
        const settings = await (Settings as any).findOne({ key: 'global' }) || { interestRate: 6.5 };
        const interestRate = settings.interestRate;

        // Calculate current amounts
        const now = new Date();
        const baseDate = transaction.effectiveInterestDate || project?.interestStartDate;
        const interest = calculateInterest(
            transaction.compensation.totalApproved,
            interestRate,
            baseDate,
            now
        );
        const supplementary = transaction.supplementaryAmount || 0;
        const totalAmount = transaction.compensation.totalApproved + interest + supplementary;

        // Generate secure token
        const token = generateQRToken(id);

        // Get frontend URL
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const confirmUrl = `${frontendUrl}/confirm/${token}`;

        // QR content should be JUST the URL for scanners to recognize it as a link
        const qrContent = confirmUrl;

        // Generate QR code as base64 image (Used by both JSON and Image formats)
        const qrDataUrlResult = await QRCode.toDataURL(qrContent, {
            width: 400,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        if (format === 'json') {
            return res.status(200).json({
                success: true,
                qrDataUrl: qrDataUrlResult,
                data: {
                    transactionId: id,
                    token,
                    confirmUrl,
                    household: transaction.household.name,
                    projectCode: project?.code,
                    principal: transaction.compensation.totalApproved,
                    interest,
                    supplementary,
                    totalAmount
                }
            });
        }

        // Return as binary image if explicitly requested
        if (format === 'image') {
            const base64 = qrDataUrlResult.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64, 'base64');

            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Length', buffer.length.toString());
            return res.status(200).send(buffer);
        }

        // Default: return JSON with base64 Data URL (Used by Frontend)
        return res.status(200).json({
            success: true,
            qrDataUrl: qrDataUrlResult,
            transactionId: id,
            token,
            confirmUrl,
            household: transaction.household.name,
            totalAmount
        });

    } catch (error: any) {
        console.error('QR generation error:', error);
        return res.status(500).json({ error: 'Lỗi tạo QR: ' + error.message });
    }
}
