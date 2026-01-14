import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { Project, Transaction, AuditLog, BankTransaction, User } from '../../../lib/models';
import { authMiddleware } from '../../../lib/auth';
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
            // Case 2: Parse Excel file from base64 (Legacy/Real file)
            const base64Data = fileData.includes('base64,') ? fileData.split('base64,')[1] : fileData;
            const buffer = Buffer.from(base64Data, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

            if (jsonData.length === 0) {
                return res.status(400).json({ error: 'File Excel không có dữ liệu' });
            }

            // Auto-detect column names with robust matching
            const normalize = (str: string) => {
                return str.toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                    .replace(/[^a-z0-9]/g, ''); // Remove special chars/spaces
            };

            const findColumn = (patterns: string[]): string | undefined => {
                const normPatterns = patterns.map(p => normalize(p));
                return columnKeys.find(key => {
                    const normKey = normalize(key);
                    return normPatterns.some(p => normKey.includes(p) || p.includes(normKey));
                });
            };

            const nameCol = findColumn(['tên', 'họ tên', 'họ và tên', 'name', 'fullname', 'chủ hộ', 'người nhận', 'đối tượng']);
            const amountCol = findColumn(['số tiền', 'giá trị', 'thành tiền', 'tiền đền bù', 'tổng cộng', 'phê duyệt', 'amount', 'total', 'value']);
            const cccdCol = findColumn(['cccd', 'cmnd', 'số thẻ', 'định danh', 'nơi cấp', 'id card']);
            const maHoCol = findColumn(['mã hộ', 'mã số', 'mã hồ sơ', 'hồ sơ số', 'mã hs', 'ref']);
            const qdCol = findColumn(['quyết định', 'số qđ', 'văn bản', 'căn cứ', 'qd', 'số vb']);
            const dateCol = findColumn(['ngày', 'thời gian', 'kỳ hạn', 'date', 'time', 'ngày lập']);
            const projectCodeCol = findColumn(['mã dự án', 'dự án', 'mã da', 'project', 'pcode']);

            if (!nameCol || !amountCol) {
                return res.status(400).json({
                    error: `File Excel không có đủ dữ liệu. Cần cột "Tên" và "Số tiền".`,
                    detectedColumns: columnKeys,
                    suggestions: {
                        name: nameCol ? 'OK' : 'Không tìm thấy (Nên đặt là: Họ và tên)',
                        amount: amountCol ? 'OK' : 'Không tìm thấy (Nên đặt là: Số tiền)'
                    }
                });
            }

            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const name = row[nameCol];
                const amountVal = row[amountCol];
                const amount = typeof amountVal === 'number' ? amountVal : parseFloat(amountVal?.toString().replace(/[^0-9.-]+/g, "")) || 0;

                if (!name || amount <= 0) continue;

                totalBudget += amount;
                transactionsData.push({
                    stt: i + 1,
                    name: name?.toString().trim(),
                    cccd: row[cccdCol!]?.toString() || '',
                    maHo: row[maHoCol!]?.toString() || '',
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
        const finalProjectCode = projectCode || transactionsData[0]?.projectCode || `DA-${Date.now()}`;
        const finalProjectName = projectName || `Dự án ${finalProjectCode}`;

        // Prepare return data for preview
        const previewResult = {
            project: {
                code: finalProjectCode,
                name: finalProjectName,
                location: location || '',
                totalBudget,
                interestStartDate: interestStartDate ? new Date(interestStartDate) : new Date(),
                status: 'Active'
            },
            transactions: transactionsData.map((row, index) => ({
                id: `TEMP-${index}`,
                household: {
                    id: row.maHo || `HO-${index}`,
                    name: row.name,
                    cccd: row.cccd,
                    address: location || '',
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
                status: 'Chưa giải ngân'
            }))
        };

        if (previewOnly) {
            return res.status(200).json({
                success: true,
                data: previewResult
            });
        }

        // --- ACTUAL DB OPERATIONS ---
        // Check duplicate project code only for real import
        const existingProject = await (Project as any).findOne({ code: finalProjectCode, organization: currentUser.organization });
        if (existingProject) {
            return res.status(400).json({ error: `Mã dự án ${finalProjectCode} đã tồn tại trong tổ chức của bạn` });
        }

        // Create project with organization
        const project = await (Project as any).create({
            code: finalProjectCode,
            name: finalProjectName,
            location: location || '',
            totalBudget,
            interestStartDate: interestStartDate ? new Date(interestStartDate) : new Date(),
            uploadDate: new Date(),
            startDate: new Date(),
            status: 'Active',
            organization: currentUser.organization,
            uploadedBy: currentUser._id,
            updatedAt: new Date()
        });

        // Create transactions
        const transactions = await (Transaction as any).insertMany(
            previewResult.transactions.map(t => {
                const { id, ...txData } = t as any; // Remove temp id
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
            organization: currentUser.organization,
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

