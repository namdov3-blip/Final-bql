
const XLSX = require('xlsx');
const filePath = 'C:\\Users\\Vu Anh Tuan\\Downloads\\CanDeleted\\quanlygiaodich\\Template file (Dữ liệu Giao dịch đến 31.12.2025).xlsx';

try {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    console.log('Total raw rows:', rawData.length);

    // Find data start row
    let dataStartRow = -1;
    for (let i = 0; i < 30; i++) {
        const row = rawData[i];
        if (row && row.some(cell => typeof cell === 'string' && (cell.toLowerCase().includes('ho va ten') || cell.toLowerCase().includes('stt')))) {
            dataStartRow = i;
            break;
        }
    }

    console.log('Data starts at row index:', dataStartRow);

    // Rows 0-3 are headers according to previous scan
    // Let's look at the last few rows
    console.log('\n--- LAST 15 RAW ROWS ---');
    for (let i = Math.max(0, rawData.length - 15); i < rawData.length; i++) {
        console.log(`R${i}:`, JSON.stringify(rawData[i]));
    }

    const dataObjects = XLSX.utils.sheet_to_json(sheet, { range: dataStartRow, defval: '' });
    console.log('\nTotal data objects:', dataObjects.length);

    console.log('\n--- LAST 10 DATA OBJECTS ---');
    dataObjects.slice(-10).forEach((obj, idx) => {
        console.log(`Obj ${dataObjects.length - 10 + idx}:`, JSON.stringify(obj));
    });

} catch (err) {
    console.error(err);
}
