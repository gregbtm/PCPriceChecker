import { classifyMemory } from './memory-classifier.js';

// Static compatibility rules for PC component combinations.
// No external API needed — data based on manufacturer specifications.

export interface CompatIssue {
  severity: 'error' | 'warning';
  type: string;
  message: string;
  affectedComponents: string[];
}

export interface CompatibilityResult {
  isCompatible: boolean;
  issues: CompatIssue[];
  warnings: CompatIssue[];
  summary: string;
  estimatedPsuWatts?: number;
}

export interface ComponentList {
  cpu?: string;
  motherboard?: string;
  ram?: string;
  gpu?: string;
  psu?: string;
  case?: string;
  cooler?: string;
  storage?: string;
  /** Optional platform limits (P1-4), e.g. from a hardware profile: slot count and maximum total memory. */
  ramSlots?: number;
  maxMemoryGb?: number;
}

// ── Socket detection ───────────────────────────────────────────────────────

type CpuSocket = 'AM4' | 'AM5' | 'LGA1700' | 'LGA1851' | 'unknown';
type MemoryStandard = 'DDR4' | 'DDR5' | 'DDR4/DDR5' | 'unknown';

function detectCpuSocket(cpu: string): CpuSocket {
  const c = cpu.toLowerCase();
  if (detectMobileCpu(cpu)) return 'unknown';   // a mobile part is not an AM5/LGA desktop socket (P1-4)
  // Ryzen 9000 / 7000 → AM5
  if (/ryzen\s+[579]\s+[79][0-9]{3}/.test(c)) return 'AM5';
  // Ryzen 5000 / 3000 / 2000 / 1000 → AM4
  if (/ryzen\s+[579]\s+[1-5][0-9]{3}/.test(c)) return 'AM4';
  if (/athlon\s+3\d{3}/.test(c)) return 'AM4';
  // Intel Core Ultra (Arrow Lake) → LGA1851
  if (/core ultra/.test(c) && /[2-9]\d{2}k/.test(c)) return 'LGA1851';
  // Intel 12th/13th/14th gen → LGA1700
  if (/i[3579]-1[2-4]\d{3}/.test(c)) return 'LGA1700';
  if (/core i[3579] 1[2-4]\d{3}/.test(c)) return 'LGA1700';
  return 'unknown';
}

/**
 * Mobile/APU parts (P1-4): the Ryzen 7 255 class (three-digit 200-series), Ryzen 7040/8040 H/U/HS parts and Core Ultra H/U.
 * They are soldered or SO-DIMM platforms, never an AM5 desktop socket, so they must be recognised BEFORE the AM5 pattern,
 * which would otherwise read "Ryzen 7 7840HS" as a desktop 7000-series chip. All of these use DDR5.
 */
export function detectMobileCpu(cpu: string): boolean {
  const c = cpu.toLowerCase();
  return /ryzen\s+[3579]\s+2[0-9]{2}\b(?!\s*[a-z]*x)/.test(c)          // Ryzen 5 240, Ryzen 7 255
    || /ryzen\s+[3579]\s+[5-9][0-9]{3}\s*(?:hs|h|u|hx3d|hx)\b/.test(c)   // 7840HS, 8845HS, 7945HX
    || /ryzen\s+ai\b/.test(c)
    || /core\s+ultra\s+[579]\s+\d{3}[hu]\b/.test(c);
}

function detectMoboSocket(mobo: string): CpuSocket {
  const m = mobo.toLowerCase();
  if (/\b(b550|x570|b450|x470|b350|a520|b520)\b/.test(m)) return 'AM4';
  if (/\b(b650|b650e|x670|x670e|a620)\b/.test(m)) return 'AM5';
  if (/\b(z690|z790|h670|h770|b660|b760|h610)\b/.test(m)) return 'LGA1700';
  if (/\b(z890|b860|h870)\b/.test(m)) return 'LGA1851';
  return 'unknown';
}

function detectMoboMemory(mobo: string): MemoryStandard {
  const m = mobo.toLowerCase();
  if (/ddr5/.test(m)) return 'DDR5';
  if (/ddr4/.test(m)) return 'DDR4';
  // Infer from chipset
  if (/\b(b550|x570|b450|x470|b350|a520|b520)\b/.test(m)) return 'DDR4';
  if (/\b(b650|b650e|x670|x670e|a620)\b/.test(m)) return 'DDR5';
  if (/\b(z890|b860|h870)\b/.test(m)) return 'DDR5'; // Arrow Lake mandates DDR5
  if (/\b(z690|h670|b660)\b/.test(m)) return 'DDR4/DDR5';
  if (/\b(z790|h770|b760)\b/.test(m)) return 'DDR4/DDR5';
  return 'unknown';
}

function detectRamType(ram: string): 'DDR4' | 'DDR5' | 'unknown' {
  const r = ram.toLowerCase();
  if (/ddr5/.test(r) || /\b5\d{3}\b/.test(r)) return 'DDR5';
  if (/ddr4/.test(r) || /\b[23]\d{3}[^x]/.test(r)) return 'DDR4';
  return 'unknown';
}

function detectRamSpeedMhz(ram: string): number | null {
  const m = ram.match(/\b(4[0-9]{3}|5[0-9]{3}|6[0-9]{3}|7[0-9]{3}|8[0-9]{3}|3[2-9]\d{2}|2[4-9]\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}

function detectRamCapacityGb(ram: string): number | null {
  const m = ram.match(/(\d+)\s*gb/i);
  return m ? parseInt(m[1]) : null;
}

// ── PSU wattage estimation ─────────────────────────────────────────────────

import { findCpuBenchmark, findGpuBenchmark } from '../data/benchmarks.js';

function estimatePsuWatts(cpu?: string, gpu?: string): number {
  let cpuTdp = 65;
  let gpuTdp = 150;

  if (cpu) {
    const match = findCpuBenchmark(cpu);
    if (match) cpuTdp = match.tdp;
  }
  if (gpu) {
    const match = findGpuBenchmark(gpu);
    if (match) gpuTdp = match.tdp;
  }

  // System overhead: storage, RAM, mobo, fans ≈ 80W; headroom ≈ 20%
  return Math.ceil((cpuTdp + gpuTdp + 80) * 1.2 / 50) * 50;
}

function detectPsuWatts(psu: string): number | null {
  const m = psu.match(/(\d{3,4})\s*w/i);
  return m ? parseInt(m[1]) : null;
}

function detectFormFactor(str: string): string {
  const s = str.toLowerCase();
  if (/mini.?itx/.test(s)) return 'Mini-ITX';
  if (/micro.?atx|matx|m-atx/.test(s)) return 'Micro-ATX';
  if (/e.?atx/.test(s)) return 'E-ATX';
  if (/atx/.test(s)) return 'ATX';
  return 'unknown';
}

function detectMoboFormFactor(mobo: string): string {
  const s = mobo.toLowerCase();
  if (/mini.?itx/.test(s)) return 'Mini-ITX';
  if (/micro.?atx|matx/.test(s)) return 'Micro-ATX';
  if (/e.?atx/.test(s)) return 'E-ATX';
  return 'ATX'; // default assumption for desktops
}

// ── Socket → platform memory constraint ───────────────────────────────────

const SOCKET_MEMORY: Record<string, MemoryStandard> = {
  AM4: 'DDR4',
  AM5: 'DDR5',
  LGA1700: 'DDR4/DDR5',
  LGA1851: 'DDR5',
};

// ── Main compatibility checker ─────────────────────────────────────────────

export function checkCompatibility(components: ComponentList): CompatibilityResult {
  const issues: CompatIssue[] = [];
  const warnings: CompatIssue[] = [];

  const { cpu, motherboard, ram, gpu, psu, case: pcCase, cooler } = components;

  // 1. CPU ↔ Motherboard socket check
  if (cpu && motherboard) {
    const cpuSocket = detectCpuSocket(cpu);
    const moboSocket = detectMoboSocket(motherboard);
    if (cpuSocket !== 'unknown' && moboSocket !== 'unknown' && cpuSocket !== moboSocket) {
      issues.push({
        severity: 'error',
        type: 'socket_mismatch',
        message: `CPU uses ${cpuSocket} but motherboard uses ${moboSocket}. These are incompatible.`,
        affectedComponents: [cpu, motherboard],
      });
    }
  }

  // 2. Motherboard ↔ RAM memory standard check
  if (motherboard && ram) {
    const moboMem = detectMoboMemory(motherboard);
    const ramType = detectRamType(ram);
    if (moboMem !== 'unknown' && ramType !== 'unknown' && moboMem !== 'DDR4/DDR5') {
      if (moboMem !== ramType) {
        issues.push({
          severity: 'error',
          type: 'memory_standard_mismatch',
          message: `Motherboard supports ${moboMem} but RAM appears to be ${ramType}. They are physically incompatible.`,
          affectedComponents: [motherboard, ram],
        });
      }
    }
  }

  // 3. CPU platform ↔ RAM standard check (when no mobo specified)
  if (cpu && ram && !motherboard) {
    const cpuSocket = detectCpuSocket(cpu);
    const expectedMem = SOCKET_MEMORY[cpuSocket] as MemoryStandard | undefined;
    const ramType = detectRamType(ram);
    if (expectedMem && expectedMem !== 'DDR4/DDR5' && ramType !== 'unknown' && expectedMem !== ramType) {
      issues.push({
        severity: 'error',
        type: 'memory_platform_mismatch',
        message: `${cpu} (${cpuSocket}) requires ${expectedMem} but the RAM appears to be ${ramType}.`,
        affectedComponents: [cpu, ram],
      });
    }
  }

  // 3b. Form factor, ECC, slots and capacity (P1-4). Only when the text states enough to be sure.
  if (ram) {
    const listing = classifyMemory(ram);
    const mobile = !!cpu && detectMobileCpu(cpu);
    const desktopBoard = !!motherboard && detectMoboSocket(motherboard) !== 'unknown';
    if (listing.formFactor === 'SODIMM' && desktopBoard) {
      issues.push({ severity: 'error', type: 'form_factor_mismatch',
        message: 'This RAM is SO-DIMM (laptop/mini PC) but the motherboard is a desktop board that takes full-size DIMMs.',
        affectedComponents: [ram, motherboard!] });
    }
    if (listing.formFactor === 'DIMM' && mobile && !motherboard) {
      issues.push({ severity: 'error', type: 'form_factor_mismatch',
        message: `${cpu} is a mobile/mini-PC platform that takes SO-DIMM memory, but this RAM is a full-size desktop DIMM.`,
        affectedComponents: [cpu!, ram] });
    }
    if (mobile && !motherboard) {
      if (listing.ddr === 4) {
        issues.push({ severity: 'error', type: 'memory_platform_mismatch',
          message: `${cpu} uses DDR5 but the RAM appears to be DDR4.`, affectedComponents: [cpu!, ram] });
      }
    }
    if (listing.ecc === true) {
      warnings.push({ severity: 'warning', type: 'ecc_unsupported',
        message: 'ECC memory is only used as ECC on platforms that support it; most consumer and mini-PC boards run it as non-ECC or reject it. Check the board specification.',
        affectedComponents: [ram] });
    }
    if (components.ramSlots != null && listing.modules != null && listing.modules > components.ramSlots) {
      issues.push({ severity: 'error', type: 'ram_slots_exceeded',
        message: `${listing.modules} modules need ${listing.modules} slots but the platform has ${components.ramSlots}.`,
        affectedComponents: [ram] });
    }
    if (components.maxMemoryGb != null && listing.totalGb != null && listing.totalGb > components.maxMemoryGb) {
      issues.push({ severity: 'error', type: 'ram_capacity_exceeded',
        message: `${listing.totalGb}GB is above the platform maximum of ${components.maxMemoryGb}GB.`,
        affectedComponents: [ram] });
    }
  }

  // 4. RAM speed warnings
  if (ram && motherboard) {
    const ramSpeed = detectRamSpeedMhz(ram);
    const ramType = detectRamType(ram);
    if (ramType === 'DDR5' && ramSpeed && ramSpeed < 4800) {
      warnings.push({
        severity: 'warning',
        type: 'ram_speed_low',
        message: `DDR5 at ${ramSpeed}MHz is below the DDR5 minimum spec (4800MHz). Verify the kit is genuine DDR5.`,
        affectedComponents: [ram],
      });
    }
    if (ramType === 'DDR4' && ramSpeed && ramSpeed > 5200) {
      warnings.push({
        severity: 'warning',
        type: 'ram_speed_high',
        message: `${ramSpeed}MHz is very high for DDR4 — confirm BIOS XMP/EXPO support on the motherboard.`,
        affectedComponents: [ram, motherboard],
      });
    }
  }

  // 5. PSU wattage check
  const estimatedWatts = estimatePsuWatts(cpu, gpu);
  if (psu) {
    const psuWatts = detectPsuWatts(psu);
    if (psuWatts !== null) {
      if (psuWatts < estimatedWatts) {
        issues.push({
          severity: 'error',
          type: 'psu_underpowered',
          message: `Estimated system power draw ≈ ${estimatedWatts}W but PSU is only ${psuWatts}W. Risk of instability or shutdown under load.`,
          affectedComponents: psu ? [psu] : [],
        });
      } else if (psuWatts < estimatedWatts + 100) {
        warnings.push({
          severity: 'warning',
          type: 'psu_tight',
          message: `PSU (${psuWatts}W) provides little headroom over estimated draw (${estimatedWatts}W). Consider 50–100W more for longevity and future upgrades.`,
          affectedComponents: psu ? [psu] : [],
        });
      }
    }
  } else if (cpu || gpu) {
    warnings.push({
      severity: 'warning',
      type: 'psu_not_specified',
      message: `Estimated power requirement: ≈${estimatedWatts}W. Ensure your PSU meets or exceeds this.`,
      affectedComponents: [],
    });
  }

  // 6. Case form-factor vs motherboard check
  if (pcCase && motherboard) {
    const caseFF = detectFormFactor(pcCase);
    const moboFF = detectMoboFormFactor(motherboard);
    const ffHierarchy = ['Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX'];
    const caseIdx = ffHierarchy.indexOf(caseFF);
    const moboIdx = ffHierarchy.indexOf(moboFF);
    if (caseFF !== 'unknown' && moboFF !== 'unknown' && moboIdx > caseIdx) {
      issues.push({
        severity: 'error',
        type: 'form_factor_mismatch',
        message: `A ${moboFF} motherboard will not fit in a ${caseFF} case.`,
        affectedComponents: [pcCase, motherboard],
      });
    }
    if (caseFF !== 'unknown' && moboFF !== 'unknown' && caseIdx > moboIdx + 1) {
      warnings.push({
        severity: 'warning',
        type: 'case_oversized',
        message: `${caseFF} case is significantly larger than the ${moboFF} motherboard — valid but you may prefer a smaller case.`,
        affectedComponents: [pcCase, motherboard],
      });
    }
  }

  // 7. AM5 DDR5 only reminder
  if (cpu) {
    const sock = detectCpuSocket(cpu);
    if (sock === 'AM5' && !ram) {
      warnings.push({
        severity: 'warning',
        type: 'am5_ddr5_only',
        message: 'AM5 (Ryzen 7000/9000) requires DDR5 — ensure your RAM kit is DDR5.',
        affectedComponents: [cpu],
      });
    }
  }

  const errorCount = issues.length;
  const warnCount = warnings.length;
  const summary =
    errorCount === 0 && warnCount === 0
      ? 'All specified components appear compatible.'
      : errorCount > 0
      ? `${errorCount} compatibility error${errorCount > 1 ? 's' : ''} found — build will not work as listed.`
      : `No hard errors but ${warnCount} warning${warnCount > 1 ? 's' : ''} to review.`;

  return {
    isCompatible: errorCount === 0,
    issues,
    warnings,
    summary,
    estimatedPsuWatts: cpu || gpu ? estimatedWatts : undefined,
  };
}
