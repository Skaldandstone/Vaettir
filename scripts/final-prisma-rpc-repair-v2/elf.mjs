// Pure, bounded ELF32/64 section/dynamic-symbol reader, both endian forms.
export function elf(bytes) {
  const fail = (v, why) => { if (!v) throw Error(why); };
  fail(Buffer.isBuffer(bytes) && bytes.length >= 64, "ELF header absent");
  fail(bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && [1,2].includes(bytes[4]) && [1,2].includes(bytes[5]), "Unsupported ELF class/endian");
  const wide = bytes[4] === 2, little = bytes[5] === 1;
  const u16 = at => little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
  const u32 = at => little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  const u64 = (at) => {
    fail(at >= 0 && at + 8 <= bytes.length, "ELF offset outside bytes");
    const n = little ? bytes.readBigUInt64LE(at) : bytes.readBigUInt64BE(at);
    fail(n <= BigInt(Number.MAX_SAFE_INTEGER), "ELF integer overflow");
    return Number(n);
  };
  const slice = (start, size) => {
    fail(Number.isSafeInteger(start + size) && start >= 0 && size >= 0 && start + size <= bytes.length, "ELF range outside bytes");
    return bytes.subarray(start, start + size);
  };
  const word = wide ? u64 : u32;
  const shoff = word(wide ? 40 : 32), stride = u16(wide ? 58 : 46), count = u16(wide ? 60 : 48);
  fail(stride === (wide ? 64 : 40) && count > 0 && count < 8192, "Unsupported ELF section inventory");
  slice(shoff, stride * count);
  const sections = Array.from({ length: count }, (_, i) => {
    const at = shoff + stride * i;
    return { type: u32(at + 4), offset: word(at + (wide ? 24 : 16)), size: word(at + (wide ? 32 : 20)), link: u32(at + (wide ? 40 : 24)), entry: word(at + (wide ? 56 : 36)) };
  });
  const string = (table, offset) => {
    fail(table?.type === 3 && offset < table.size, "Invalid ELF string reference");
    const data = slice(table.offset, table.size), end = data.indexOf(0, offset);
    fail(end >= offset && end - offset < 65536, "Unterminated ELF string");
    return data.subarray(offset, end).toString("utf8");
  };
  const defined = [], undefinedSymbols = [], needed = [], sonames = [], paths = [];
  for (const s of sections) {
    if (s.type === 11) {
      const entry = wide ? 24 : 16;
      fail(s.entry === entry && s.size % entry === 0, "Invalid dynamic symbol table");
      slice(s.offset, s.size);
      for (let p = s.offset; p < s.offset + s.size; p += entry) {
        const name = string(sections[s.link], u32(p));
        if (!name) continue;
        const bind = bytes[p + (wide ? 4 : 12)] >> 4, visibility = bytes[p + (wide ? 5 : 13)] & 3;
        if (u16(p + (wide ? 6 : 14)) === 0) undefinedSymbols.push(name);
        else if ([1, 2].includes(bind) && [0, 3].includes(visibility)) defined.push(name);
      }
    }
    if (s.type === 6) {
      const entry = wide ? 16 : 8;
      fail(s.entry === entry && s.size % entry === 0, "Invalid ELF dynamic table");
      slice(s.offset, s.size);
      let terminated = false;
      for (let p = s.offset; p < s.offset + s.size; p += entry) {
        const tag = word(p), value = word(p + (wide ? 8 : 4));
        if (tag === 0) { terminated = true; break; }
        if ([1, 14, 15, 29].includes(tag)) {
          const text = string(sections[s.link], value);
          (tag === 1 ? needed : tag === 14 ? sonames : paths).push(text);
        }
      }
      fail(terminated, "Missing ELF dynamic terminator");
    }
  }
  const unique = (x) => [...new Set(x)].sort();
  return { machine: u16(18), defined: unique(defined), undefined: unique(undefinedSymbols), needed: unique(needed), sonames: unique(sonames), searchPaths: unique(paths) };
}
