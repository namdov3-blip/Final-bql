import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { Project, Transaction, AuditLog, BankTransaction, User } from '../../../lib/models';
import { authMiddleware } from '../../../lib/auth';
import * as XLSX from 'xlsx';

// Helper to format currency
function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// Parse Vietnamese currency/number strings
function parseVietnameseNumber(val: any): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let s = val.toString().trim();
    // Remove "₫", "VND" and spaces
    s = s.replace(/[₫VND\s]/gi, '');

    // Heuristic for VN/US formats: 
    // If it has both . and , (e.g. 1.234.567,89) -> remove dots, replace comma with dot.
    // If it has only dots and the last dot is 3 chars away -> 1.234.567 -> remove dots.
    // If it has only one dot/comma near the end -> 123.45 -> keep it.

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    if (hasComma && hasDot) {
        // Assume format like 1.234.567,89 or 1,234,567.89
        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        if (lastComma > lastDot) { // VN style: 1.234,56
            return parseFloat(s.replace(/\./g, '').replace(',', '.'));
        } else { // US style: 1,234.56
            return parseFloat(s.replace(/,/g, ''));
        }
    } else if (hasComma) {
        // Only commas. If it's like 1,000,000 -> remove. If 123,45 -> decimal.
        const parts = s.split(',');
        if (parts.length > 1 && parts[parts.length - 1].length === 3) {
            return parseFloat(s.replace(/,/g, ''));
        }
        return parseFloat(s.replace(',', '.'));
    } else if (hasDot) {
        // Only dots. If it's like 1.000.000 -> remove. If 123.45 -> decimal.
        const parts = s.split('.');
        if (parts.length > 1 && parts[parts.length - 1].length === 3) {
            return parseFloat(s.replace(/\./g, ''));
        }
        return parseFloat(s);
    }

    return parseFloat(s) || 0;
}

// Parse Excel date and return Date object (for database)
function parseExcelDateToDate(value: any): Date {
    if (!value) return new Date();

    if (typeof value === 'number') {
        // Excel serial date
        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + value * 86400000);
    } else if (typeof value === 'string') {
        // Try DD/MM/YYYY format first
        const parts = value.split('/');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
        return new Date(value);
    }

    return new Date();
}

// Format date as DD/MM/YYYY string (for display)
function formatDateDDMMYYYY(value: any): string {
    if (!value) return '';

    const date = parseExcelDateToDate(value);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
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
            transactions: directTransactions,
            previewOnly // [NEW] Flag to just return parsed data
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
                date: new Date(t.date || t.decisionDate || (t.household?.decisionDate) || new Date())
            }));
            totalBudget = transactionsData.reduce((sum, t) => {
                const amount = t.amount || t.compensation?.totalApproved || 0;
                return sum + amount;
            }, 0);
        } else if (fileData) {
            // Case 2: Parse Excel file from base64
            const base64Data = fileData.includes('base64,') ? fileData.split('base64,')[1] : fileData;
            const buffer = Buffer.from(base64Data, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });

            const normalize = (str: any) => {
                if (!str) return '';
                return str.toString().toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                    .replace(/[^a-z0-9]/g, '');
            };

            const findInKeys = (keys: string[], patterns: string[]): string | undefined => {
                const normPatterns = patterns.map(p => normalize(p));
                const normKeys = keys.map(k => normalize(k));
                for (const p of normPatterns) {
                    const idx = normKeys.findIndex(nk => nk === p);
                    if (idx !== -1) return keys[idx];
                }
                for (const p of normPatterns) {
                    const idx = normKeys.findIndex(nk => nk && nk.includes(p));
                    if (idx !== -1) return keys[idx];
                }
                return undefined;
            };

            const namePatterns = ['ho va ten', 'ten chu ho', 'nguoi nhan', 'ten chu su dung dat'];
            const amountPatterns = ['tong tien chi tra', 'tong so tien chi tra', 'so tien duoc duyet', 'tong cong', 'so tien'];
            const cccdPatterns = ['cccd', 'cmnd', 'so the', 'dinh danh'];
            const maHoPatterns = ['ma ho', 'ma so', 'ma hs'];
            const qdPatterns = ['so qd', 'so quyet dinh', 'qd'];
            const datePatterns = ['ngay qd', 'ngay quyet dinh', 'ngay'];
            const pCodePatterns = ['ma du an', 'ma da'];
            const pNamePatterns = ['ten du an', 'du an'];
            const payTypePatterns = ['loai chi tra', 'hinh thuc', 'loai chi'];

            // Process sheets
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                if (rawData.length < 5) continue;

                // Rigid logic: skip first 4 rows (headers), start from index 4
                // Column mapping (0-indexed) from Bản 2:
                // Index 2: Họ và tên chủ sử dụng đất
                // Index 5: Số QĐ
                // Index 6: Ngày
                // Index 9: Loại Chi Trả
                // Index 10: Mã Hộ Dân
                // Index 23: Tổng số tiền bồi thường

                for (let i = 4; i < rawData.length; i++) {
                    const row = rawData[i];
                    if (!row || row.length < 3) continue;

                    const name = row[2]?.toString().trim();
                    if (!name || name === '') continue;

                    const amount = parseVietnameseNumber(row[23]);
                    if (amount <= 0) continue;

                    transactionsData.push({
                        name,
                        cccd: '',
                        maHo: row[10]?.toString() || `HO-${i}`,
                        qd: row[5]?.toString().trim() || '',
                        date: formatDateDDMMYYYY(row[6]), // For display in preview
                        dateObj: parseExcelDateToDate(row[6]), // For database storage
                        projectName: row[7]?.toString().trim() || '', // Column H - Tên dự án
                        projectCode: row[8]?.toString().trim() || '', // Column I - Mã dự án
                        paymentType: row[9]?.toString() || '',
                        amount,
                        stt: row[0]?.toString() || (i - 3).toString()
                    });
                    totalBudget += amount;
                }
                if (transactionsData.length > 0) break; // Found data
            }
        }

        if (transactionsData.length === 0) {
            return res.status(400).json({ error: 'Không tìm thấy dữ liệu hợp lệ trong file' });
        }

        // Get project code and name from first row of Excel data (if available)
        const firstRowProjectCode = transactionsData[0]?.projectCode;
        const firstRowProjectName = transactionsData[0]?.projectName;

        // Priority: Excel file data > Form input > Auto-generate
        const baseProjectCode = firstRowProjectCode || projectCode || `DA${Date.now()}`;
        const baseProjectName = firstRowProjectName || projectName || `Dự án ${baseProjectCode}`;

        const previewResult = {
            project: {
                code: baseProjectCode,
                name: baseProjectName,
                location: location || '',
                totalBudget,
                interestStartDate: interestStartDate ? new Date(interestStartDate) : new Date(),
                status: 'Active'
            },
            transactions: transactionsData.map((row, index) => {
                // If row already has household (it came from directTransactions JSON), preserve it
                if (row.household && row.compensation) {
                    return {
                        ...row,
                        id: row.id || `TEMP-${index}`,
                        status: row.status || 'Chưa giải ngân'
                    };
                }

                // Otherwise, map from flat row data (it came from Excel parsing)
                return {
                    id: `TEMP-${index}`,
                    household: {
                        id: row.maHo || `HO-${index}`,
                        name: row.name,
                        cccd: row.cccd || '',
                        address: location || '',
                        landOrigin: '',
                        landArea: 0,
                        decisionNumber: row.qd || '',
                        decisionDate: row.dateObj || new Date() // Use Date object for database
                    },
                    compensation: {
                        landAmount: 0,
                        assetAmount: 0,
                        houseAmount: 0,
                        supportAmount: 0,
                        totalApproved: row.amount
                    },
                    paymentType: row.paymentType,
                    projectCode: row.projectCode,
                    projectName: row.projectName,
                    status: 'Chưa giải ngân',
                    stt: row.stt || (index + 1).toString()
                };
            })
        };

        if (previewOnly) {
            return res.status(200).json({ success: true, data: previewResult });
        }

        // --- DB OPERATIONS ---
        const createdProjects: any[] = [];
        const createdBankTxs: any[] = [];

        try {
            // Check if project code already exists - reject import if duplicate
            const existingProject = await (Project as any).findOne({ code: baseProjectCode, organization: currentUser.organization });
            if (existingProject) {
                return res.status(409).json({
                    error: `Mã dự án "${baseProjectCode}" đã tồn tại. Vui lòng sử dụng mã khác hoặc xóa dự án cũ trước khi import.`
                });
            }

            // Create new project
            const project = await (Project as any).create({
                code: baseProjectCode,
                name: baseProjectName,
                location: (location || '').trim(),
                totalBudget: totalBudget,
                interestStartDate: previewResult.project.interestStartDate,
                uploadDate: new Date(),
                startDate: new Date(),
                status: 'Active',
                organization: currentUser.organization,
                uploadedBy: currentUser._id,
                updatedAt: new Date()
            });
            createdProjects.push(project);

            const lastBankTx = await (BankTransaction as any).findOne({ organization: currentUser.organization }).sort({ _id: -1 });
            const currentBalance = lastBankTx?.runningBalance || 0;

            const bankTx = await (BankTransaction as any).create({
                type: 'Nạp tiền',
                amount: totalBudget,
                date: new Date(),
                note: `Import ${transactionsData.length} hồ sơ dự án ${baseProjectCode}`,
                createdBy: payload.name,
                runningBalance: currentBalance + totalBudget,
                organization: currentUser.organization,
                projectId: project._id,
                updatedAt: new Date()
            });
            createdBankTxs.push(bankTx);

            const transactions = await (Transaction as any).insertMany(
                previewResult.transactions.map((t: any) => {
                    const { id, projectCode, projectName, ...txData } = t;
                    return {
                        ...txData,
                        projectId: project._id,
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

            await (AuditLog as any).create({
                actor: payload.name,
                role: payload.role,
                action: 'Import Excel',
                target: `Dự án ${baseProjectCode}`,
                details: `Import ${transactions.length} hộ dân vào dự án ${baseProjectName}. Tổng: ${formatCurrency(totalBudget)}`
            });

            return res.status(201).json({
                success: true,
                data: { transactionCount: transactions.length, totalBudget }
            });

        } catch (dbError: any) {
            console.error('[IMPORT_DB_FAIL] Rolling back...', dbError);
            for (const p of createdProjects) await (Project as any).deleteOne({ _id: p._id });
            for (const btx of createdBankTxs) await (BankTransaction as any).deleteOne({ _id: btx._id });
            return res.status(500).json({ error: 'Lỗi lưu dữ liệu: ' + dbError.message });
        }

    } catch (error: any) {
        console.error('Import error:', error);
        return res.status(500).json({ error: 'Lỗi hệ thống: ' + error.message });
    }
}

