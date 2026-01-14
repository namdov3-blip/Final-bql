
const XLSX = require('xlsx');
const path = require('path');

const filePath = 'C:\\Users\\Vu Anh Tuan\\Downloads\\CanDeleted\\quanlygiaodich\\Template file (Dữ liệu Giao dịch đến 31.12.2025).xlsx';

try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    console.log('--- SHEET INFO ---');
    console.log('Sheet Name:', sheetName);
    const range = XLSX.utils.decode_range(sheet['!ref']);
    console.log('Total Cell Range:', sheet['!ref']);
    console.log('Max Row Index:', range.e.r);

    // Get all rows as raw arrays
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    console.log('\n--- FIRST 20 ROWS ---');
    rawData.slice(0, 20).forEach((row, idx) => {
        console.log(`R${idx}:`, JSON.stringify(row));
    });

    // Try to find the data starting point (where header is)
    let dataStartRow = -1;
    for (let i = 0; i < Math.min(rawData.length, 30); i++) {
        const row = rawData[i];
        if (row.some(cell => typeof cell === 'string' && (cell.toLowerCase().includes('ho va ten') || cell.toLowerCase().includes('stt')))) {
            dataStartRow = i;
            break;
        }
    }

    if (dataStartRow !== -1) {
        console.log('\n--- DATA ANALYSIS ---');
        console.log('Data starts at index:', dataStartRow);

        // Combine headers from rows above dataStartRow
        const headerRows = rawData.slice(0, dataStartRow + 1);
        const combinedHeaders = [];
        const maxCols = Math.max(...headerRows.map(r => r.length));

        for (let col = 0; col < maxCols; col++) {
            const fragments = [];
            for (let rowIdx = 0; rowIdx <= dataStartRow; rowIdx++) {
                const val = headerRows[rowIdx][col];
                if (val && !fragments.includes(String(val).trim())) {
                    fragments.push(String(val).trim());
                }
            }
            combinedHeaders[col] = fragments.join(' ');
        }
        console.log('Combined Headers:', JSON.stringify(combinedHeaders));

        // Get data objects starting from row after header if header is on one row, 
        // but xlsx sheet_to_json handles range properly.
        const dataObjects = XLSX.utils.sheet_to_json(sheet, { range: dataStartRow, defval: '' });
        console.log('Total Records found:', dataObjects.length);

        // Inspect skipping logic
        let countSkipped = 0;
        dataObjects.forEach((obj, idx) => {
            const rowKeys = Object.keys(obj);
            // Simulating extraction logic
            const nameKey = rowKeys.find(k => k.toLowerCase().includes('ho va ten'));
            const name = nameKey ? obj[nameKey] : '';
            if (!name || (typeof name === 'string' && name.trim() === '')) {
                countSkipped++;
                if (idx < 230) console.log(`[SKIP] Record ${idx} has no name:`, JSON.stringify(obj));
            }
        });
        console.log('Total potential skipped (no name):', countSkipped);

        console.log('\n--- SAMPLE DATA RECORDS (215 to 225) ---');
        dataObjects.slice(215, 230).forEach((obj, idx) => {
            console.log(`IDX ${idx + 215}:`, JSON.stringify(obj));
        });
    }

} catch (err) {
    console.error('Error reading file:', err.message);
}
