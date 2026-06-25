const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;

function pdfText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function displayDate(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function wrapText(value, maxCharacters) {
  const words = String(value || '-').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}

export function createProductionOrderPdf(order) {
  const commands = [];
  const models = order.models || [];
  const sizes = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
  const processes = [
    ['process_cut', 'C'],
    ['process_prepared', 'P'],
    ['process_stitched', 'A'],
    ['process_assembled', 'A'],
    ['process_planted', 'P'],
    ['process_finished', 'T']
  ];

  function line(x1, top1, x2, top2, width = 0.6) {
    commands.push(`${width} w ${x1.toFixed(2)} ${(PAGE_HEIGHT - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - top2).toFixed(2)} l S`);
  }

  function rect(x, top, width, height, fill = null) {
    if (fill) commands.push(`${fill} rg`);
    commands.push(`${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${fill ? 'B' : 'S'}`);
    if (fill) commands.push('0 0 0 rg');
  }

  function text(value, x, top, size = 8, bold = false, options = {}) {
    const font = bold ? 'F2' : 'F1';
    commands.push(`BT /${font} ${size.toFixed(2)} Tf ${x.toFixed(2)} ${(PAGE_HEIGHT - top - size).toFixed(2)} Td (${pdfText(value)}) Tj ET`);
    if (options.color) commands.push('0 0 0 rg');
  }

  function centered(value, x, top, width, size = 8, bold = false) {
    const estimatedWidth = String(value || '').length * size * 0.5;
    text(value, x + Math.max(2, (width - estimatedWidth) / 2), top, size, bold);
  }

  commands.push('0 0 0 RG 0 0 0 rg');
  text('PRODUCALZA', 20, 16, 17, true);
  text('HOJA UNICA DE PEDIDO Y PRODUCCION', 20, 37, 9, true);
  text(order.order_number || '', 690, 19, 15, true);
  line(20, 54, PAGE_WIDTH - 20, 54, 1.2);

  const info = [
    ['Cliente', order.client_name],
    ['Fecha', displayDate(order.order_date)],
    ['Marca', order.brand || '-'],
    ['Ciudad', order.city || '-']
  ];
  const infoTop = 63;
  const infoWidth = (PAGE_WIDTH - 40) / info.length;
  info.forEach(([label, value], index) => {
    const x = 20 + index * infoWidth;
    rect(x, infoTop, infoWidth, 36);
    text(label.toUpperCase(), x + 5, infoTop + 5, 6.5, true);
    text(value || '-', x + 5, infoTop + 17, 9, true);
  });

  text('PROCESO: C Cortado | P Preparado | A Aparado | A Armado | P Plantado | T Terminado', 365, 105, 6.5, true);

  const tableX = 20;
  const tableTop = 118;
  const tableWidth = PAGE_WIDTH - 40;
  const headerHeight = 24;
  const footerSpace = 53;
  const availableRowsHeight = PAGE_HEIGHT - tableTop - headerHeight - footerSpace;
  const rowHeight = Math.max(10, Math.min(25, availableRowsHeight / Math.max(models.length + 1, 1)));
  const fontSize = rowHeight < 15 ? 5.3 : rowHeight < 20 ? 6.2 : 7;
  const columns = [
    ['Tarj.', 31],
    ['Modelo', 48],
    ['Color / Material', 92],
    ...sizes.map((size) => [String(size), 22]),
    ['Total', 36],
    ...processes.map(([, letter]) => [letter, 20]),
    ['Observaciones', tableWidth - (31 + 48 + 92 + sizes.length * 22 + 36 + processes.length * 20)]
  ];

  rect(tableX, tableTop, tableWidth, headerHeight, '0.92 0.92 0.92');
  let currentX = tableX;
  for (const [label, width] of columns) {
    line(currentX, tableTop, currentX, tableTop + headerHeight + rowHeight * (models.length + 1));
    centered(label, currentX, tableTop + 7, width, 6.5, true);
    currentX += width;
  }
  line(currentX, tableTop, currentX, tableTop + headerHeight + rowHeight * (models.length + 1));
  line(tableX, tableTop, tableX + tableWidth, tableTop);
  line(tableX, tableTop + headerHeight, tableX + tableWidth, tableTop + headerHeight);

  models.forEach((model, modelIndex) => {
    const top = tableTop + headerHeight + modelIndex * rowHeight;
    let x = tableX;
    const colorMaterial = [model.color, model.material].filter(Boolean).join(' / ') || '-';
    const values = [
      model.card_number || '-',
      model.model_code || '-',
      colorMaterial,
      ...sizes.map((size) => model.sizes?.[size] || ''),
      model.total_pairs || 0,
      ...processes.map(([field]) => model[field] ? 'X' : ''),
      model.notes || '-'
    ];
    values.forEach((value, index) => {
      const width = columns[index][1];
      if (index === 2 || index === values.length - 1) {
        const maxChars = Math.max(8, Math.floor(width / (fontSize * 0.48)));
        wrapText(value, maxChars).slice(0, 2).forEach((part, lineIndex) => {
          text(part, x + 3, top + 3 + lineIndex * (fontSize + 1), fontSize, index === 2 && lineIndex === 0);
        });
      } else {
        centered(value, x, top + Math.max(2, (rowHeight - fontSize) / 2 - 1), width, fontSize, index === 1 || index === 13);
      }
      x += width;
    });
    line(tableX, top + rowHeight, tableX + tableWidth, top + rowHeight);
  });

  const totalTop = tableTop + headerHeight + models.length * rowHeight;
  rect(tableX, totalTop, tableWidth, rowHeight, '0.94 0.94 0.94');
  text('TOTAL DEL PEDIDO', tableX + 6, totalTop + Math.max(2, (rowHeight - 7) / 2), 7, true);
  const totalPairs = models.reduce((sum, model) => sum + Number(model.total_pairs || 0), 0);
  const totalColumnX = tableX + 31 + 48 + 92 + sizes.length * 22;
  centered(totalPairs, totalColumnX, totalTop + Math.max(2, (rowHeight - 8) / 2), 36, 8, true);
  line(tableX, totalTop + rowHeight, tableX + tableWidth, totalTop + rowHeight);

  const notesTop = totalTop + rowHeight + 7;
  text('OBSERVACIONES GENERALES', 20, notesTop, 6.5, true);
  text(order.general_notes || '-', 20, notesTop + 11, 7);
  text('Revisado por: __________________________', 20, PAGE_HEIGHT - 27, 7);
  text('Firma cliente: __________________________', 590, PAGE_HEIGHT - 27, 7);

  const stream = Buffer.from(commands.join('\n'), 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1')
    ])
  ];

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, 'latin1'));
    chunks.push(Buffer.isBuffer(object) ? object : Buffer.from(object, 'latin1'));
    chunks.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF'
  ].join('\n');
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
