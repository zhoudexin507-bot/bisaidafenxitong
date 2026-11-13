// —— 无依赖 ZIP(store 存储)工具:二维码图片包、画面导出图片包共用 ——
export function crc32(bytes) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crc32.table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

// 无压缩（store）ZIP：PNG 本就很小，免引第三方打包库。
// 文件名置 UTF-8 标志位，现代解压器均可正确显示中文名。
export function zipStore(files) {
  const encoder = new TextEncoder();
  const local = [],
    central = [];
  let offset = 0;
  const now = new Date();
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  for (const file of files) {
    const name = encoder.encode(file.name),
      size = file.bytes.length,
      crc = crc32(file.bytes);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 file names
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, size, true);
    header.setUint32(22, size, true);
    header.setUint16(26, name.length, true);
    local.push(new Uint8Array(header.buffer), name, file.bytes);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + size;
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, new Uint8Array(end.buffer)], {
    type: "application/zip",
  });
}
