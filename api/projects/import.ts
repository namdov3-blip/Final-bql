import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../lib/mongodb';
import { Project, Transaction, AuditLog, BankTransaction, User } from '../../lib/models';
import { authMiddleware } from '../../lib/auth';
import * as XLSX from 'xlsx';

// Helper to format currency
function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// Parse Excel date
function parseExcelDate(value: any): Date {
    if (!value) return new Date();

    if (typeof value === 'number') {
        // Excel serial date
        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + value * 86400000);
    }

    if (typeof value === 'string') {
        // Try DD/MM/YYYY format
        const parts = value.split('/');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
        return new Date(value);
    }

    return new Date();
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

        // Get user's organization
        const currentUser = await (User as any).findById(payload.userId);
        if (!currentUser || !currentUser.organization) {
            return res.status(400).json({ error: 'User must belong to an organization' });
        }

        const {
            fileData,
            projectCode,
            projectName,
            location,
            interestStartDate,
            transactions: directTransactions // [NEW] Support direct JSON
        } = req.body;

        if (!fileData && (!directTransactions || directTransactions.length === 0)) {
            return res.status(400).json({ error: 'Vui lòng upload file Excel hoặc cung cấp dữ liệu' });
        }

        let transactionsData: any[] = [];
        let totalBudget = 0;

        if (directTransactions && directTransactions.length > 0) {
            // Case 1: Use direct JSON data (from simulation/preview)
            transactionsData = directTransactions.map((t: any) => ({
                ...t,
                date: new Date(t.date || t.decisionDate || new Date())
            }));
            totalBudget = transactionsData.reduce((sum, t) => sum + (t.amount || t.compensation?.totalApproved || 0), 0);
        } else if (fileData) {
            // Case 2: Parse Excel file from base64 (Legacy/Real file)
            const buffer = Buffer.from(fileData, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            // ... (rest of parsing logic, but simplified to just fill transactionsData)
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

            if (jsonData.length === 0) {
                return res.status(400).json({ error: 'File Excel không có dữ liệu' });
            }

            // Auto-detect column names
            const firstRow = jsonData[0];
            const columnKeys = Object.keys(firstRow);
            const findColumn = (patterns: string[]): string | undefined => {
                return columnKeys.find(key => patterns.some(p => key.toLowerCase().includes(p.toLowerCase())));
            };

            const nameCol = findColumn(['tên', 'họ tên', 'name', 'ho ten']);
            const amountCol = findColumn(['số tiền', 'so tien', 'amount', 'tiền', 'tien']);
            const cccdCol = findColumn(['cccd', 'cmnd', 'căn cước', 'can cuoc']);
            const maHoCol = findColumn(['mã hộ', 'ma ho', 'mã hồ sơ', 'ma ho so']);
            const qdCol = findColumn(['quyết định', 'quyet dinh', 'số qđ', 'so qd']);
            const dateCol = findColumn(['ngày', 'ngay', 'date']);
            const projectCodeCol = findColumn(['mã dự án', 'ma du an', 'project code']);

            if (!nameCol || !amountCol) {
                return res.status(400).json({ error: 'File Excel phải có cột "Tên" và "Số tiền"' });
            }

            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const name = row[nameCol];
                const amount = parseFloat(row[amountCol]) || 0;

                if (!name || amount <= 0) continue;

                totalBudget += amount;
                transactionsData.push({
                    stt: i + 1,
                    name: name?.toString().trim(),
                    cccd: row[cccdCol!]?.toString() || '',
                    maHo: row[maHoCol!]?.toString() || `HO-${Date.now()}-${i}`,
                    qd: row[qdCol!]?.toString() || '',
                    date: parseExcelDate(row[dateCol!]),
                    projectCode: row[projectCodeCol!]?.toString() || projectCode || '',
                    amount
                });
            }
        }

        if (transactionsData.length === 0) {
            return res.status(400).json({ error: 'Không tìm thấy dữ liệu hợp lệ trong file' });
        }

        // Generate project code if not provided
        const finalProjectCode = projectCode || `DA-${Date.now()}`;

        // Check duplicate project code
        const existingProject = await (Project as any).findOne({ code: finalProjectCode });
        if (existingProject) {
            return res.status(400).json({ error: `Mã dự án ${finalProjectCode} đã tồn tại` });
        }

        // Create project with organization
        const project = await (Project as any).create({
            code: finalProjectCode,
            name: projectName || `Dự án ${finalProjectCode}`,
            location: location || '',
            totalBudget,
            interestStartDate: interestStartDate ? new Date(interestStartDate) : new Date(),
            uploadDate: new Date(),
            startDate: new Date(),
            status: 'Active',
            organization: currentUser.organization, // Set from current user
            uploadedBy: currentUser._id,
            updatedAt: new Date()
        });

        // Create transactions
        const transactions = await (Transaction as any).insertMany(
            transactionsData.map(row => {
                // [NEW] Support for Pre-structured data (Direct JSON from Frontend)
                if (row.household && row.compensation) {
                    return {
                        projectId: project._id,
                        household: row.household,
                        compensation: row.compensation,
                        status: row.status || 'Chưa giải ngân',
                        updatedAt: new Date(),
                        history: [{
                            timestamp: new Date(),
                            action: 'Import từ Excel (Preview)',
                            details: `Nhập hồ sơ từ dữ liệu xem trước`,
                            actor: payload.name
                        }]
                    };
                }

                // [Legacy] Support for Flat Excel rows
                return {
                    projectId: project._id,
                    household: {
                        id: row.maHo,
                        name: row.name,
                        cccd: row.cccd,
                        address: '',
                        landOrigin: '',
                        landArea: 0,
                        decisionNumber: row.qd,
                        decisionDate: row.date
                    },
                    compensation: {
                        landAmount: 0,
                        assetAmount: 0,
                        houseAmount: 0,
                        supportAmount: 0,
                        totalApproved: row.amount
                    },
                    status: 'Chưa giải ngân',
                    updatedAt: new Date(),
                    history: [{
                        timestamp: new Date(),
                        action: 'Import từ Excel',
                        details: `Nhập hồ sơ từ file Excel`,
                        actor: payload.name
                    }]
                };
            })
        );

        // Get current bank balance for this org
        const lastBankTx = await (BankTransaction as any).findOne({ organization: currentUser.organization }).sort({ date: -1 });
        const currentBalance = lastBankTx?.runningBalance || 0;

        // Create bank deposit transaction
        await (BankTransaction as any).create({
            type: 'Nạp tiền',
            amount: totalBudget,
            date: new Date(),
            note: `Tiền chưa giải ngân dự án ${finalProjectCode}`,
            createdBy: payload.name,
            runningBalance: currentBalance + totalBudget,
            organization: currentUser.organization, // Set from current user
            projectId: project._id,
            updatedAt: new Date()
        });

        // Create audit log
        await (AuditLog as any).create({
            actor: payload.name,
            role: payload.role,
            action: 'Import Excel',
            target: `Dự án ${finalProjectCode}`,
            details: `Import ${transactions.length} hộ dân. Tổng: ${formatCurrency(totalBudget)}. Org: ${currentUser.organization}`
        });

        const projectObj = project.toObject ? project.toObject({ virtuals: true }) : project;

        return res.status(201).json({
            success: true,
            data: {
                project: {
                    ...projectObj,
                    id: (projectObj.id || projectObj._id || project._id).toString()
                },
                transactionCount: transactions.length,
                totalBudget,
                organization: currentUser.organization
            }
        });

    } catch (error: any) {
        console.error('Import error:', error);
        return res.status(500).json({ error: 'Lỗi import: ' + error.message });
    }
}
