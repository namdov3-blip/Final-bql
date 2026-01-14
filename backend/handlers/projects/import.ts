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
                if (rawData.length === 0) continue;

                let nameIdx = -1, amountIdx = -1, cccdIdx = -1, maHoIdx = -1, qdIdx = -1, dateIdx = -1;
                let pCodeIdx = -1, pNameIdx = -1, payTypeIdx = -1;
                let dataStartRow = 0;

                // Find headers
                for (let i = 0; i < Math.min(rawData.length, 30); i++) {
                    const row = rawData[i];
                    if (!row || row.length < 2) continue;

                    const combinedRowCells: string[] = [];
                    for (let c = 0; c < row.length; c++) {
                        let combined = '';
                        for (let r = Math.max(0, i - 3); r <= Math.min(rawData.length - 1, i + 3); r++) {
                            const val = rawData[r][c];
                            if (val && isNaN(Number(val))) {
                                const s = val.toString().trim();
                                if (!combined.includes(s)) combined = (combined + ' ' + s).trim();
                            }
                        }
                        combinedRowCells[c] = combined;
                    }

                    const foundName = findInKeys(combinedRowCells, namePatterns);
                    const foundAmount = findInKeys(combinedRowCells, amountPatterns);

                    if (foundName && foundAmount) {
                        nameIdx = combinedRowCells.indexOf(foundName);
                        amountIdx = combinedRowCells.indexOf(foundAmount);

                        const detectIdx = (patterns: string[]) => {
                            const found = findInKeys(combinedRowCells, patterns);
                            return found ? combinedRowCells.indexOf(found) : -1;
                        };

                        cccdIdx = detectIdx(cccdPatterns);
                        maHoIdx = detectIdx(maHoPatterns);
                        qdIdx = detectIdx(qdPatterns);
                        dateIdx = detectIdx(datePatterns);
                        pCodeIdx = detectIdx(pCodePatterns);
                        pNameIdx = detectIdx(pNamePatterns);
                        payTypeIdx = detectIdx(payTypePatterns);

                        dataStartRow = i + 1;
                        break;
                    }
                }

                if (nameIdx !== -1 && amountIdx !== -1) {
                    for (let i = dataStartRow; i < rawData.length; i++) {
                        const row = rawData[i];
                        if (!row) continue;

                        const name = row[nameIdx]?.toString().trim();
                        const amount = parseVietnameseNumber(row[amountIdx]);

                        if (!name || name === '') continue;
                        const normName = normalize(name);
                        if (normName === 'tongcong' || normName === 'cong' || normName.startsWith('ghichu')) continue;
                        if (amount <= 0) continue;

                        const getVal = (idx: number) => (idx !== -1 ? row[idx] : undefined);

                        transactionsData.push({
                            name,
                            cccd: getVal(cccdIdx)?.toString() || '',
                            maHo: getVal(maHoIdx)?.toString() || '',
                            qd: getVal(qdIdx)?.toString() || '',
                            date: parseExcelDate(getVal(dateIdx)),
                            projectCode: getVal(pCodeIdx)?.toString() || projectCode || '',
                            projectName: getVal(pNameIdx)?.toString() || projectName || '',
                            paymentType: getVal(payTypeIdx)?.toString() || '',
                            amount
                        });
                        totalBudget += amount;
                    }
                    if (transactionsData.length > 0) break; // Found data in this sheet, stop
                }
            }
        }

        if (transactionsData.length === 0) {
            return res.status(400).json({ error: 'Không tìm thấy dữ liệu hợp lệ trong file' });
        }

        const baseProjectCode = (projectCode || transactionsData[0]?.projectCode || `DA-${Date.now()}`).toString().trim();
        const baseProjectName = (projectName || transactionsData[0]?.projectName || `Dự án ${baseProjectCode}`).toString().trim();

        const previewResult = {
            project: {
                code: baseProjectCode,
                name: baseProjectName,
                location: location || 'Chưa xác định',
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
                        address: location || 'Chưa xác định',
                        landOrigin: '',
                        landArea: 0,
                        decisionNumber: row.qd || '',
                        decisionDate: row.date
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
                    status: 'Chưa giải ngân'
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
            let project = await (Project as any).findOne({ code: baseProjectCode, organization: currentUser.organization });
            if (!project) {
                project = await (Project as any).create({
                    code: baseProjectCode,
                    name: baseProjectName,
                    location: (location || 'Chưa xác định').trim(),
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
            } else {
                project.totalBudget = (project.totalBudget || 0) + totalBudget;
                project.updatedAt = new Date();
                await project.save();
            }

            const lastBankTx = await (BankTransaction as any).findOne({ organization: currentUser.organization }).sort({ date: -1 });
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

