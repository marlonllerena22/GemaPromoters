import XLSX from 'xlsx';

export const LOCAL_REPORTS_IMPORT_TAG = 'IMPORT_REPORTES_LOCALES_2026';

const YEAR = 2026;
const monthMap = new Map([
  ['ENERO', 1],
  ['FEBRERO', 2],
  ['MARZO', 3],
  ['ABRIL', 4],
  ['MAYO', 5],
  ['MAY0', 5],
  ['JUNIO', 6],
  ['JULIO', 7],
  ['AGOSTO', 8],
  ['SEPTIEMBRE', 9],
  ['SETIEMBRE', 9],
  ['OCTUBRE', 10],
  ['NOVIEMBRE', 11],
  ['DICIEMBRE', 12]
]);

const salesSheets = [
  ['VENTA NORTE ', 'Local Marjorie Botas Norte'],
  ['VENTA VALLE ', 'Local Marjorie Botas Valle'],
  ['VENTA SUR ', 'Local Marjorie Botas Sur'],
  ['VENTA SEBASTIANS', 'Sebastians']
];

const expenseSheets = [
  ['GASTOS NORTE ', 'Local Marjorie Botas Norte'],
  ['GASTOS VALLE ', 'Local Marjorie Botas Valle'],
  ['GASTOS SUR ', 'Local Marjorie Botas Sur'],
  ['GASTOS SEBASTIANS', 'Sebastians']
];

const sellerMap = new Map([
  ['LILI', 'Liliana'],
  ['LILIANA', 'Liliana'],
  ['SELE', 'Selena'],
  ['SELENA', 'Selena'],
  ['NAYE', 'Nayely'],
  ['NAYELY', 'Nayely'],
  ['YAMI', 'Yamileth'],
  ['YAMILETH', 'Yamileth'],
  ['BELEN', 'Belen'],
  ['BELÉN', 'Belen'],
  ['MELA', 'Melani'],
  ['MELANI', 'Melani'],
  ['MISHELL', 'Michelle'],
  ['MICHELLE', 'Michelle'],
  ['MORE', 'More'],
  ['ABI', 'Abi']
]);

const attendanceStaffMap = new Map([
  ['LILI', { name: 'Liliana Jima', username: 'liliana', location: 'Norte', active: true }],
  ['LILIANA', { name: 'Liliana Jima', username: 'liliana', location: 'Norte', active: true }],
  ['SELE', { name: 'Selena Sarango', username: 'selena', location: 'Sur', active: true }],
  ['SELENA', { name: 'Selena Sarango', username: 'selena', location: 'Sur', active: true }],
  ['NAYE', { name: 'Nayely Vera', username: 'nayely', location: 'Valle', active: true }],
  ['NAYELY', { name: 'Nayely Vera', username: 'nayely', location: 'Valle', active: true }],
  ['YAMI', { name: 'Yamileth', username: 'yamileth', location: 'Valle', active: true }],
  ['YAMILETH', { name: 'Yamileth', username: 'yamileth', location: 'Valle', active: true }],
  ['BELEN', { name: 'Belen', username: 'belen', location: 'Bosque', active: true }],
  ['BELÉN', { name: 'Belen', username: 'belen', location: 'Bosque', active: true }],
  ['MELANI', { name: 'Melani', username: 'melani', location: 'Valle', active: false }],
  ['MELA', { name: 'Melani', username: 'melani', location: 'Valle', active: false }],
  ['MICHELLE', { name: 'Michelle', username: 'michelle', location: 'Valle', active: false }],
  ['MISHELL', { name: 'Michelle', username: 'michelle', location: 'Valle', active: false }]
]);

function clean(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

function upper(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function money(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  const parsed = Number(String(value).replace(/[^0-9,.-]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function intish(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value).replace(/\.0$/, '');
  return clean(value);
}

function isoDate(monthNumber, dayNumber) {
  const day = Number(dayNumber);
  if (!monthNumber || !day || day < 1 || day > 31) return '';
  return `${YEAR}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateFromCell(value, monthNumber, fallback = '') {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value >= 1 && value <= 31) return isoDate(monthNumber, value);
  const text = clean(value);
  if (!text) return fallback;
  const excelDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (excelDate) return `${excelDate[1]}-${excelDate[2]}-${excelDate[3]}`;
  const day = text.match(/^\s*(\d{1,2})/) || text.match(/\b(\d{1,2})\b/);
  return day ? isoDate(monthNumber, day[1]) : fallback;
}

function localDailySaleCommission(localName, amountValue) {
  const amount = money(amountValue);
  const isSebastians = upper(localName).includes('SEBASTIAN');
  if (isSebastians) {
    if (amount >= 185) return 3;
    if (amount >= 160) return 2.5;
    if (amount >= 135) return 2;
    if (amount >= 110) return 1.5;
    if (amount >= 85) return 1;
    if (amount >= 60) return 0.75;
    if (amount >= 35) return 0.5;
    return 0;
  }
  if (amount >= 150) return 3;
  if (amount >= 120) return 2.5;
  if (amount >= 100) return 2;
  if (amount >= 80) return 1.5;
  if (amount >= 60) return 1;
  if (amount >= 40) return 0.75;
  if (amount >= 20) return 0.5;
  return 0;
}

function sheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
}

function monthFromRow(row) {
  for (const cell of row) {
    const text = upper(cell);
    for (const [name, number] of monthMap) {
      if (text.includes(name)) return number;
    }
  }
  return 0;
}

function normalizeHeader(value) {
  return upper(value).replace(/[^A-Z0-9#]+/g, '');
}

function findHeader(row, names) {
  const normalizedNames = names.map(normalizeHeader);
  return row.findIndex((value) => normalizedNames.includes(normalizeHeader(value)));
}

function isMonthTitleRow(row) {
  const text = row.map(upper).join(' ');
  return monthFromRow(row) && (text.includes('VENTAS') || text.includes('GASTOS') || text.includes('REPORTES'));
}

function paymentInfo(row, paymentCols) {
  const values = paymentCols
    .map((col) => ({ method: col.method, amount: money(row[col.index]) }))
    .filter((item) => item.amount > 0);
  if (!values.length) return { amount: 0, method: 'efectivo' };
  const amount = values.reduce((sum, item) => sum + item.amount, 0);
  const main = values.find((item) => item.method === 'tarjeta')
    || values.find((item) => item.method === 'transferencia')
    || values[0];
  return { amount: money(amount), method: main.method };
}

function saleKindFrom(row, numberIndex, modelIndex, colorIndex) {
  const text = upper([row[numberIndex], row[modelIndex], row[colorIndex]].join(' '));
  if (text.includes('SEP') || text.includes('SEPAR')) return 'separated';
  if (text.includes('MAYOR')) return 'wholesale';
  return 'normal';
}

function defaultSeller(localName) {
  if (localName.includes('Norte')) return 'Liliana';
  if (localName.includes('Sur')) return 'Selena';
  if (localName.includes('Valle')) return 'Nayely';
  if (localName.includes('Sebastians')) return 'Belen';
  return 'Local';
}

function sellerFromRow(row, sellerCols, localName) {
  for (const col of sellerCols) {
    if (money(row[col.index]) > 0 || clean(row[col.index])) {
      return sellerMap.get(col.key) || clean(col.label) || defaultSeller(localName);
    }
  }
  return defaultSeller(localName);
}

function localCode(localName) {
  if (localName.includes('Norte')) return 'NOR';
  if (localName.includes('Sur')) return 'SUR';
  if (localName.includes('Valle')) return 'VAL';
  if (localName.includes('Sebastians')) return 'SEB';
  return 'LOC';
}

function importedSaleNumber(localName, date, rowNumber, originalNumber) {
  const cleanOriginal = clean(originalNumber).replace(/[^A-Za-z0-9-]+/g, '');
  return `IMP-${date.replace(/-/g, '')}-${localCode(localName)}-${cleanOriginal || 'SN'}-F${rowNumber}`;
}

function parseSales(workbook) {
  const sales = [];
  for (const [sheetName, localName] of salesSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetRows(sheet);
    let monthNumber = 0;
    let header = null;
    let currentDate = '';
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (isMonthTitleRow(row)) {
        monthNumber = monthFromRow(row);
        header = null;
        currentDate = '';
        continue;
      }
      const first = normalizeHeader(row[0]);
      if (first === 'FECH' || first === 'FECHA') {
        const dateIndex = findHeader(row, ['FECH', 'FECHA']);
        const numberIndex = findHeader(row, ['#', 'NUM']);
        const modelIndex = findHeader(row, ['MODELO']);
        const colorIndex = findHeader(row, ['COLOR']);
        const sizeIndex = findHeader(row, ['TALLA']);
        const paymentCols = row
          .map((value, index) => ({ value: normalizeHeader(value), index }))
          .filter((item) => ['PEFEC', 'EFECT', 'EFECTIVO', 'PTARJE', 'TARJETA', 'TRANS', 'TRANSFER'].includes(item.value))
          .map((item) => ({
            index: item.index,
            method: item.value.includes('TARJ') ? 'tarjeta' : item.value.includes('TRANS') ? 'transferencia' : 'efectivo'
          }));
        const known = new Set([dateIndex, numberIndex, modelIndex, colorIndex, sizeIndex, ...paymentCols.map((item) => item.index)]);
        const sellerCols = row
          .map((value, index) => ({ label: clean(value), key: normalizeHeader(value), index }))
          .filter((item) => item.label && !known.has(item.index) && item.index > sizeIndex && item.key !== 'RED');
        header = { dateIndex, numberIndex, modelIndex, colorIndex, sizeIndex, paymentCols, sellerCols };
        continue;
      }
      if (!monthNumber || !header) continue;
      const rowDate = dateFromCell(row[header.dateIndex], monthNumber, currentDate);
      if (rowDate) currentDate = rowDate;
      const model = clean(row[header.modelIndex]);
      const color = clean(row[header.colorIndex]);
      const size = intish(row[header.sizeIndex]);
      const statusText = upper([model, color].join(' '));
      if (!model || statusText === 'X X' || statusText.includes('CERRADO') || statusText.includes('TOTAL')) continue;
      const payment = paymentInfo(row, header.paymentCols);
      if (!payment.amount || !currentDate) continue;
      sales.push({
        local_name: localName,
        sale_number: importedSaleNumber(localName, currentDate, r + 1, row[header.numberIndex]),
        model_code: model,
        color,
        size,
        quantity: 1,
        sale_kind: saleKindFrom(row, header.numberIndex, header.modelIndex, header.colorIndex),
        seller_name: sellerFromRow(row, header.sellerCols, localName),
        payment_method: payment.method,
        amount: payment.amount,
        commission: localDailySaleCommission(localName, payment.amount),
        sale_date: currentDate,
        notes: `${LOCAL_REPORTS_IMPORT_TAG} | ${sheetName.trim()} fila ${r + 1}`
      });
    }
  }
  return sales;
}

function financeGroupFor(detail) {
  const text = upper(detail);
  if (text.includes('INGRESO') || text.includes('CAJA') || text.includes('SALDO')) {
    return { entry_type: 'income', finance_group: 'income' };
  }
  if (text.includes('TRANSFER') || text.includes('TRANSFE') || text.includes('TRANSFR') || text.includes('DEPOSITO')) {
    return { entry_type: 'expense', finance_group: 'deposit' };
  }
  if (text.includes('INTERNET') || text.includes('ARRIENDO') || text.includes('ALICUOTA') || text.includes('LUZ') || text.includes('AGUA')) {
    return { entry_type: 'expense', finance_group: 'service' };
  }
  if (text.includes('PUBLICIDAD') || text.includes('PRODUCALZA')) {
    return { entry_type: 'expense', finance_group: 'admin' };
  }
  return { entry_type: 'expense', finance_group: 'various' };
}

function parseExpenses(workbook) {
  const rowsOut = [];
  for (const [sheetName, localName] of expenseSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetRows(sheet);
    let monthNumber = 0;
    let header = null;
    let currentDate = '';
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (isMonthTitleRow(row)) {
        monthNumber = monthFromRow(row);
        header = null;
        currentDate = '';
        continue;
      }
      if (row.map(normalizeHeader).includes('FECHA')) {
        header = {
          dateIndex: findHeader(row, ['FECHA']),
          detailIndex: findHeader(row, ['DETALLE']),
          amountIndex: findHeader(row, ['VALOR'])
        };
        continue;
      }
      if (!monthNumber || !header) continue;
      const rowDate = dateFromCell(row[header.dateIndex], monthNumber, currentDate);
      if (rowDate) currentDate = rowDate;
      const detail = clean(row[header.detailIndex]);
      const amount = money(row[header.amountIndex]);
      if (!detail || !amount || !currentDate || upper(detail).includes('TOTAL')) continue;
      const group = financeGroupFor(detail);
      rowsOut.push({
        local_name: localName,
        entry_type: group.entry_type,
        finance_group: group.finance_group,
        category: detail.slice(0, 120),
        amount,
        entry_date: currentDate,
        payee: '',
        pairs: 0,
        notes: `${LOCAL_REPORTS_IMPORT_TAG} | ${sheetName.trim()} fila ${r + 1}`
      });
    }
  }
  return rowsOut;
}

function parseTimePair(value) {
  const text = clean(value);
  const match = text.match(/(\d{1,2}):(\d{2})\s*\/\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const inHour = Number(match[1]);
  const inMinute = Number(match[2]);
  let outHour = Number(match[3]);
  const outMinute = Number(match[4]);
  if (outHour <= 7) outHour += 12;
  return {
    in_time: `${String(inHour).padStart(2, '0')}:${String(inMinute).padStart(2, '0')}`,
    out_time: `${String(outHour).padStart(2, '0')}:${String(outMinute).padStart(2, '0')}`
  };
}

function parseAttendance(workbook) {
  const sheet = workbook.Sheets['ASISTENCIA '];
  if (!sheet) return [];
  const rows = sheetRows(sheet);
  const attendance = [];
  let monthNumber = 0;
  let dayIndex = -1;
  let staffCols = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const foundMonth = monthFromRow(row);
    const text = row.map(upper).join(' ');
    if (foundMonth && text.includes('REPORTES')) {
      monthNumber = foundMonth;
      dayIndex = -1;
      staffCols = [];
      continue;
    }
    const normalized = row.map(normalizeHeader);
    if (normalized.includes('DIAS')) {
      const diasIndex = normalized.indexOf('DIAS');
      dayIndex = diasIndex + 1;
      staffCols = row
        .map((value, index) => ({ label: clean(value), key: normalizeHeader(value), index }))
        .filter((item) => item.index > diasIndex && attendanceStaffMap.has(item.key));
      continue;
    }
    if (!monthNumber || dayIndex < 0 || !staffCols.length) continue;
    const rowDate = dateFromCell(row[dayIndex], monthNumber, '');
    if (!rowDate) continue;
    for (const staffCol of staffCols) {
      const parsed = parseTimePair(row[staffCol.index]);
      if (!parsed) continue;
      const staff = attendanceStaffMap.get(staffCol.key);
      attendance.push({
        staff,
        local_date: rowDate,
        in_time: parsed.in_time,
        out_time: parsed.out_time,
        message: `${LOCAL_REPORTS_IMPORT_TAG} | ASISTENCIA fila ${r + 1}`
      });
    }
  }
  return attendance;
}

export function parseLocalReportsWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  return {
    sales: parseSales(workbook),
    expenses: parseExpenses(workbook),
    attendance: parseAttendance(workbook)
  };
}

export function localReportsSummary(parsed) {
  const byLocal = {};
  for (const sale of parsed.sales) {
    byLocal[sale.local_name] ||= { ventas: 0, valor: 0 };
    byLocal[sale.local_name].ventas += 1;
    byLocal[sale.local_name].valor = money(byLocal[sale.local_name].valor + sale.amount);
  }
  return {
    ventas: parsed.sales.length,
    gastos_movimientos: parsed.expenses.length,
    asistencias_dias: parsed.attendance.length,
    asistencias_registros_entrada_salida: parsed.attendance.length * 2,
    ventas_por_local: byLocal
  };
}
