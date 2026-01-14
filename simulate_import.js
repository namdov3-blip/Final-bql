const XLSX = require('xlsx');

// EXACT COPY OF HANDLER HELPERS
function parseVietnameseNumber(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let s = val.toString().trim();
    s = s.replace(/[₫VND\s]/gi, '');
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        if (lastComma > lastDot) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
        else return parseFloat(s.replace(/,/g, ''));
    } else if (hasComma) {
        const parts = s.split(',');
        if (parts.length > 1 && parts[parts.length - 1].length === 3) return parseFloat(s.replace(/,/g, ''));
        return parseFloat(s.replace(',', '.'));
    } else if (hasDot) {
        const parts = s.split('.');
        if (parts.length > 1 && parts[parts.length - 1].length === 3) return parseFloat(s.replace(/\./g, ''));
        return parseFloat(s);
    }
    return parseFloat(s) || 0;
}

const normalize = (str) => {
    if (!str) return '';
    return str.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, '');
};

const findInKeys = (keys, patterns) => {
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

const file = 'c:\\Users\\Vu Anh Tuan\\Downloads\\CanDeleted\\quanlygiaodich\\Template file (Dữ liệu Giao dịch đến 31.12.2025).xlsx';
const workbook = XLSX.readFile(file);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const namePatterns = ['ho va ten', 'ten chu ho', 'nguoi nhan', 'ten chu su dung dat'];
const amountPatterns = ['tong tien chi tra', 'tong so tien chi tra', 'so tien duoc duyet', 'tong cong', 'so tien'];

let nameIdx = -1, amountIdx = -1;
let dataStartRow = 0;

for (let i = 0; i < Math.min(rawData.length, 30); i++) {
    const row = rawData[i];
    if (!row || row.length < 2) continue;

    const combinedRowCells = [];
    for (let c = 0; c < row.length; c++) {
        let combined = '';
        // HANDLER USES i-3 to i+3
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
        dataStartRow = i + 1;
        console.log(`SIMULATION: Matched at row ${i + 1}, nameIdx=${nameIdx}, amountIdx=${amountIdx}`);
        console.log(`SIMULATION: Combined Header for Amount: "${combinedRowCells[amountIdx]}"`);
        break;
    }
}

if (nameIdx !== -1) {
    console.log(`SIMULATION: Starting extraction from row ${dataStartRow + 1}`);
    for (let i = dataStartRow; i < Math.min(rawData.length, dataStartRow + 10); i++) {
        const row = rawData[i];
        if (!row) continue;
        const name = row[nameIdx];
        const rawAmt = row[amountIdx];
        const parsedAmt = parseVietnameseNumber(rawAmt);
        console.log(`Row ${i + 1}: Name="${name}", RawAmt="${rawAmt}", ParsedAmt=${parsedAmt}`);
    }
} else {
    console.log('SIMULATION: FAILED TO FIND HEADERS');
}
