const xlsx = require('xlsx');
const path = require('path');

const filePath = 'C:\\Users\\Vu Anh Tuan\\Downloads\\CanDeleted\\quanlygiaodich\\Template file (Dữ liệu Giao dịch đến 31.12.2025).xlsx';

function normalize(s) {
    if (!s) return '';
    return s.toString().toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
        .replace(/đ/g, 'd');
}

function findInKeys(keys, patterns) {
    // 1. Exact or starts-with priority
    for (const p of patterns) {
        const idx = keys.findIndex(k => normalize(k) === normalize(p));
        if (idx !== -1) return keys[idx];
    }
    // 2. Includes priority
    for (const p of patterns) {
        const idx = keys.findIndex(k => normalize(k).includes(normalize(p)));
        if (idx !== -1) return keys[idx];
    }
    return null;
}

const namePatterns = ['ho va ten', 'ten chu ho', 'ten chu su dung dat', 'ho ten', 'chu ho', 'ten'];
const amountPatterns = ['tong tien chi tra', 'tong so tien chi tra', 'so tien', 'tong tien', 'thanh tien', 'gia tri', 'kinh phi', 'tong'];

async function inspect() {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    console.log('--- HEADER SCAN (Rows 0-20) ---');
    let combinedHeaders = [];
    for (let i = 0; i < 20; i++) {
        const row = rawData[i] || [];
        row.forEach((cell, idx) => {
            if (!cell) return;
            const str = cell.toString().trim();
            if (!combinedHeaders[idx]) combinedHeaders[idx] = '';
            if (!combinedHeaders[idx].includes(str)) {
                combinedHeaders[idx] = (combinedHeaders[idx] + ' ' + str).trim();
            }
        });
    }

    console.log('Combined Headers Found:', combinedHeaders);

    const nameCol = findInKeys(combinedHeaders, namePatterns);
    const amountCol = findInKeys(combinedHeaders, amountPatterns);

    console.log('\n--- MAPPING RESULT ---');
    console.log(`nameCol: ${nameCol}`);
    console.log(`amountCol: ${amountCol}`);

    // If we can't find them, we can't proceed
    if (!nameCol || !amountCol) {
        console.log('FAILED TO MAP NAME OR AMOUNT');
        return;
    }

    const nameIdx = combinedHeaders.indexOf(nameCol);
    const amountIdx = combinedHeaders.indexOf(amountCol);

    console.log(`Indices: nameIdx=${nameIdx}, amountIdx=${amountIdx}`);

    const data = xlsx.utils.sheet_to_json(sheet, { range: 0 }); // range:0 means detect data area
    console.log(`\nTotal JSON rows detected: ${data.length}`);

    // Let's check the last 20 rows of JSON data
    console.log('\n--- LAST 20 ROWS DATA ---');
    const last20 = data.slice(-20);
    last20.forEach((row, i) => {
        const rawName = row[nameCol];
        const rawAmount = row[amountCol];
        console.log(`[${data.length - 20 + i}] NAME: ${rawName} | AMT: ${rawAmount}`);
    });
}

inspect().catch(console.error);
