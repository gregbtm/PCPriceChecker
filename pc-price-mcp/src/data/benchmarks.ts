// Static benchmark database derived from PassMark public charts.
// GPU scores = G3D Mark. CPU scores = PassMark multi-thread / single-thread.
// Refresh quarterly via passmark.com/products/performancetest/

export type ComponentTier = 'budget' | 'entry' | 'mid' | 'mid-high' | 'high' | 'ultra';
export type CpuSocket = 'AM4' | 'AM5' | 'LGA1700' | 'LGA1851';

export interface CpuBenchmark {
  name: string;
  score: number;       // PassMark multi-thread
  singleScore: number; // PassMark single-thread
  socket: CpuSocket;
  cores: number;
  threads: number;
  tdp: number;         // watts TDP
  tier: ComponentTier;
  brand: 'AMD' | 'Intel';
  keywords: string[];  // matched against component names/queries
}

export interface GpuBenchmark {
  name: string;
  score: number;       // PassMark G3D Mark
  vram: number;        // GB
  tdp: number;         // watts TBP
  tier: ComponentTier;
  brand: 'NVIDIA' | 'AMD' | 'Intel';
  architecture: string;
  memType: string;
  keywords: string[];
}

export const CPU_BENCHMARKS: CpuBenchmark[] = [
  // ── Intel Core Ultra 200 (Arrow Lake / LGA1851) ─────────────────────────
  { name:'Core Ultra 9 285K',  score:63000, singleScore:4400, socket:'LGA1851', cores:24, threads:24,  tdp:125, tier:'ultra',    brand:'Intel', keywords:['285k','ultra 9 285'] },
  { name:'Core Ultra 7 265K',  score:53000, singleScore:4200, socket:'LGA1851', cores:20, threads:20,  tdp:125, tier:'high',     brand:'Intel', keywords:['265k','ultra 7 265'] },
  { name:'Core Ultra 5 245K',  score:37000, singleScore:4100, socket:'LGA1851', cores:14, threads:14,  tdp:125, tier:'mid-high', brand:'Intel', keywords:['245k','ultra 5 245'] },
  { name:'Core Ultra 5 245KF', score:36500, singleScore:4050, socket:'LGA1851', cores:14, threads:14,  tdp:125, tier:'mid-high', brand:'Intel', keywords:['245kf'] },

  // ── Intel 14th gen (LGA1700) ─────────────────────────────────────────────
  { name:'Core i9-14900KS', score:62000, singleScore:4350, socket:'LGA1700', cores:24, threads:32, tdp:150, tier:'ultra',    brand:'Intel', keywords:['14900ks','i9-14900ks'] },
  { name:'Core i9-14900K',  score:59000, singleScore:4200, socket:'LGA1700', cores:24, threads:32, tdp:125, tier:'ultra',    brand:'Intel', keywords:['14900k ','i9-14900k'] },
  { name:'Core i9-14900F',  score:53000, singleScore:4100, socket:'LGA1700', cores:24, threads:32, tdp:65,  tier:'ultra',    brand:'Intel', keywords:['14900f','i9-14900f'] },
  { name:'Core i7-14700K',  score:52000, singleScore:4000, socket:'LGA1700', cores:20, threads:28, tdp:125, tier:'high',     brand:'Intel', keywords:['14700k','i7-14700k'] },
  { name:'Core i7-14700F',  score:48000, singleScore:3900, socket:'LGA1700', cores:20, threads:28, tdp:65,  tier:'high',     brand:'Intel', keywords:['14700f','i7-14700f'] },
  { name:'Core i5-14600K',  score:36000, singleScore:3900, socket:'LGA1700', cores:14, threads:20, tdp:125, tier:'mid-high', brand:'Intel', keywords:['14600k','i5-14600k'] },
  { name:'Core i5-14600KF', score:35500, singleScore:3850, socket:'LGA1700', cores:14, threads:20, tdp:125, tier:'mid-high', brand:'Intel', keywords:['14600kf'] },
  { name:'Core i5-14400F',  score:25000, singleScore:3700, socket:'LGA1700', cores:10, threads:16, tdp:65,  tier:'mid',      brand:'Intel', keywords:['14400f','i5-14400'] },
  { name:'Core i3-14100F',  score:15000, singleScore:3600, socket:'LGA1700', cores:4,  threads:8,  tdp:58,  tier:'entry',    brand:'Intel', keywords:['14100f','i3-14100'] },

  // ── Intel 13th gen (LGA1700) ─────────────────────────────────────────────
  { name:'Core i9-13900KS', score:63000, singleScore:4350, socket:'LGA1700', cores:24, threads:32, tdp:150, tier:'ultra',    brand:'Intel', keywords:['13900ks'] },
  { name:'Core i9-13900K',  score:59000, singleScore:4200, socket:'LGA1700', cores:24, threads:32, tdp:125, tier:'ultra',    brand:'Intel', keywords:['13900k ','i9-13900k'] },
  { name:'Core i7-13700K',  score:48000, singleScore:3950, socket:'LGA1700', cores:16, threads:24, tdp:125, tier:'high',     brand:'Intel', keywords:['13700k','i7-13700k'] },
  { name:'Core i7-13700F',  score:45000, singleScore:3850, socket:'LGA1700', cores:16, threads:24, tdp:65,  tier:'high',     brand:'Intel', keywords:['13700f'] },
  { name:'Core i5-13600K',  score:33000, singleScore:3850, socket:'LGA1700', cores:14, threads:20, tdp:125, tier:'mid-high', brand:'Intel', keywords:['13600k','i5-13600k'] },
  { name:'Core i5-13600KF', score:32500, singleScore:3800, socket:'LGA1700', cores:14, threads:20, tdp:125, tier:'mid-high', brand:'Intel', keywords:['13600kf'] },
  { name:'Core i5-13400F',  score:25000, singleScore:3700, socket:'LGA1700', cores:10, threads:16, tdp:65,  tier:'mid',      brand:'Intel', keywords:['13400f','i5-13400'] },
  { name:'Core i3-13100F',  score:14500, singleScore:3500, socket:'LGA1700', cores:4,  threads:8,  tdp:58,  tier:'entry',    brand:'Intel', keywords:['13100f','i3-13100'] },

  // ── Intel 12th gen (LGA1700) ─────────────────────────────────────────────
  { name:'Core i9-12900K',  score:42000, singleScore:3900, socket:'LGA1700', cores:16, threads:24, tdp:125, tier:'ultra',    brand:'Intel', keywords:['12900k','i9-12900'] },
  { name:'Core i7-12700K',  score:38000, singleScore:3750, socket:'LGA1700', cores:12, threads:20, tdp:125, tier:'high',     brand:'Intel', keywords:['12700k','i7-12700k'] },
  { name:'Core i7-12700F',  score:36000, singleScore:3700, socket:'LGA1700', cores:12, threads:20, tdp:65,  tier:'high',     brand:'Intel', keywords:['12700f'] },
  { name:'Core i5-12600K',  score:27000, singleScore:3700, socket:'LGA1700', cores:10, threads:16, tdp:125, tier:'mid-high', brand:'Intel', keywords:['12600k','i5-12600k'] },
  { name:'Core i5-12600KF', score:26500, singleScore:3650, socket:'LGA1700', cores:10, threads:16, tdp:125, tier:'mid-high', brand:'Intel', keywords:['12600kf'] },
  { name:'Core i5-12400F',  score:20000, singleScore:3600, socket:'LGA1700', cores:6,  threads:12, tdp:65,  tier:'mid',      brand:'Intel', keywords:['12400f','i5-12400'] },
  { name:'Core i3-12100F',  score:13500, singleScore:3400, socket:'LGA1700', cores:4,  threads:8,  tdp:58,  tier:'entry',    brand:'Intel', keywords:['12100f','i3-12100'] },

  // ── AMD Ryzen 9000 (Granite Ridge / AM5) ─────────────────────────────────
  { name:'Ryzen 9 9950X3D', score:72000, singleScore:4500, socket:'AM5', cores:16, threads:32, tdp:170, tier:'ultra',    brand:'AMD', keywords:['9950x3d'] },
  { name:'Ryzen 9 9950X',   score:64000, singleScore:4350, socket:'AM5', cores:16, threads:32, tdp:170, tier:'ultra',    brand:'AMD', keywords:['9950x ','9950x,'] },
  { name:'Ryzen 9 9900X',   score:54000, singleScore:4250, socket:'AM5', cores:12, threads:24, tdp:120, tier:'ultra',    brand:'AMD', keywords:['9900x'] },
  { name:'Ryzen 7 9800X3D', score:56000, singleScore:4200, socket:'AM5', cores:8,  threads:16, tdp:120, tier:'high',     brand:'AMD', keywords:['9800x3d'] },
  { name:'Ryzen 7 9700X',   score:46000, singleScore:4150, socket:'AM5', cores:8,  threads:16, tdp:65,  tier:'high',     brand:'AMD', keywords:['9700x'] },
  { name:'Ryzen 5 9600X',   score:29000, singleScore:4100, socket:'AM5', cores:6,  threads:12, tdp:65,  tier:'mid-high', brand:'AMD', keywords:['9600x'] },
  { name:'Ryzen 5 9600',    score:27000, singleScore:4000, socket:'AM5', cores:6,  threads:12, tdp:65,  tier:'mid-high', brand:'AMD', keywords:['ryzen 5 9600 ','r5 9600 '] },

  // ── AMD Ryzen 7000 (Zen 4 / AM5) ─────────────────────────────────────────
  { name:'Ryzen 9 7950X3D', score:63000, singleScore:3950, socket:'AM5', cores:16, threads:32, tdp:120, tier:'ultra',    brand:'AMD', keywords:['7950x3d'] },
  { name:'Ryzen 9 7950X',   score:60000, singleScore:3900, socket:'AM5', cores:16, threads:32, tdp:170, tier:'ultra',    brand:'AMD', keywords:['7950x ','7950x,'] },
  { name:'Ryzen 9 7900X3D', score:53000, singleScore:3900, socket:'AM5', cores:12, threads:24, tdp:120, tier:'ultra',    brand:'AMD', keywords:['7900x3d'] },
  { name:'Ryzen 9 7900X',   score:48000, singleScore:3850, socket:'AM5', cores:12, threads:24, tdp:170, tier:'high',     brand:'AMD', keywords:['7900x '] },
  { name:'Ryzen 9 7900',    score:44000, singleScore:3750, socket:'AM5', cores:12, threads:24, tdp:65,  tier:'high',     brand:'AMD', keywords:['ryzen 9 7900 '] },
  { name:'Ryzen 7 7800X3D', score:43000, singleScore:3800, socket:'AM5', cores:8,  threads:16, tdp:120, tier:'high',     brand:'AMD', keywords:['7800x3d'] },
  { name:'Ryzen 7 7700X',   score:39000, singleScore:3800, socket:'AM5', cores:8,  threads:16, tdp:105, tier:'mid-high', brand:'AMD', keywords:['7700x'] },
  { name:'Ryzen 7 7700',    score:37000, singleScore:3750, socket:'AM5', cores:8,  threads:16, tdp:65,  tier:'mid-high', brand:'AMD', keywords:['ryzen 7 7700 '] },
  { name:'Ryzen 5 7600X',   score:26000, singleScore:3700, socket:'AM5', cores:6,  threads:12, tdp:105, tier:'mid',      brand:'AMD', keywords:['7600x'] },
  { name:'Ryzen 5 7600',    score:24000, singleScore:3650, socket:'AM5', cores:6,  threads:12, tdp:65,  tier:'mid',      brand:'AMD', keywords:['ryzen 5 7600 '] },

  // ── AMD Ryzen 5000 (Zen 3 / AM4) ─────────────────────────────────────────
  { name:'Ryzen 9 5950X',   score:46000, singleScore:3500, socket:'AM4', cores:16, threads:32, tdp:105, tier:'ultra',    brand:'AMD', keywords:['5950x'] },
  { name:'Ryzen 9 5900X',   score:38000, singleScore:3450, socket:'AM4', cores:12, threads:24, tdp:105, tier:'high',     brand:'AMD', keywords:['5900x'] },
  { name:'Ryzen 7 5800X3D', score:31000, singleScore:3400, socket:'AM4', cores:8,  threads:16, tdp:105, tier:'high',     brand:'AMD', keywords:['5800x3d'] },
  { name:'Ryzen 7 5800X',   score:27000, singleScore:3400, socket:'AM4', cores:8,  threads:16, tdp:105, tier:'mid-high', brand:'AMD', keywords:['5800x ','5800x,'] },
  { name:'Ryzen 7 5700X',   score:24000, singleScore:3350, socket:'AM4', cores:8,  threads:16, tdp:65,  tier:'mid',      brand:'AMD', keywords:['5700x'] },
  { name:'Ryzen 5 5600X',   score:19500, singleScore:3400, socket:'AM4', cores:6,  threads:12, tdp:65,  tier:'mid',      brand:'AMD', keywords:['5600x'] },
  { name:'Ryzen 5 5600',    score:17500, singleScore:3300, socket:'AM4', cores:6,  threads:12, tdp:65,  tier:'mid',      brand:'AMD', keywords:['ryzen 5 5600 '] },
  { name:'Ryzen 5 5500',    score:14500, singleScore:3100, socket:'AM4', cores:6,  threads:12, tdp:65,  tier:'entry',    brand:'AMD', keywords:['5500'] },

  // ── AMD Ryzen 3000 (Zen 2 / AM4) ─────────────────────────────────────────
  { name:'Ryzen 9 3900X',   score:23000, singleScore:3000, socket:'AM4', cores:12, threads:24, tdp:105, tier:'high',  brand:'AMD', keywords:['3900x'] },
  { name:'Ryzen 7 3700X',   score:18000, singleScore:2950, socket:'AM4', cores:8,  threads:16, tdp:65,  tier:'mid',   brand:'AMD', keywords:['3700x'] },
  { name:'Ryzen 5 3600',    score:13000, singleScore:2900, socket:'AM4', cores:6,  threads:12, tdp:65,  tier:'entry', brand:'AMD', keywords:['3600'] },
];

export const GPU_BENCHMARKS: GpuBenchmark[] = [
  // ── NVIDIA RTX 50 series ─────────────────────────────────────────────────
  { name:'RTX 5090',       score:45000, vram:32, tdp:575, tier:'ultra',    brand:'NVIDIA', architecture:'Blackwell', memType:'GDDR7', keywords:['5090'] },
  { name:'RTX 5080',       score:38000, vram:16, tdp:360, tier:'ultra',    brand:'NVIDIA', architecture:'Blackwell', memType:'GDDR7', keywords:['5080'] },
  { name:'RTX 5070 Ti',    score:33000, vram:16, tdp:300, tier:'ultra',    brand:'NVIDIA', architecture:'Blackwell', memType:'GDDR7', keywords:['5070 ti'] },
  { name:'RTX 5070',       score:28000, vram:12, tdp:250, tier:'high',     brand:'NVIDIA', architecture:'Blackwell', memType:'GDDR7', keywords:['rtx 5070 ','5070,'] },

  // ── NVIDIA RTX 40 series ─────────────────────────────────────────────────
  { name:'RTX 4090',       score:35000, vram:24, tdp:450, tier:'ultra',    brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['4090'] },
  { name:'RTX 4080 Super', score:30000, vram:16, tdp:320, tier:'ultra',    brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['4080 super'] },
  { name:'RTX 4080',       score:27500, vram:16, tdp:320, tier:'ultra',    brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['rtx 4080 ','4080,'] },
  { name:'RTX 4070 Ti Super', score:26000, vram:16, tdp:285, tier:'high',  brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['4070 ti super'] },
  { name:'RTX 4070 Ti',    score:23500, vram:12, tdp:285, tier:'high',     brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['4070 ti ','4070ti '] },
  { name:'RTX 4070 Super', score:21500, vram:12, tdp:220, tier:'high',     brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['4070 super'] },
  { name:'RTX 4070',       score:19500, vram:12, tdp:200, tier:'mid-high', brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6X', keywords:['rtx 4070 ','4070,'] },
  { name:'RTX 4060 Ti 16GB', score:17000, vram:16, tdp:165, tier:'mid',   brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6',  keywords:['4060 ti 16'] },
  { name:'RTX 4060 Ti',    score:16500, vram:8,  tdp:160, tier:'mid',      brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6',  keywords:['4060 ti ','4060ti '] },
  { name:'RTX 4060',       score:13500, vram:8,  tdp:115, tier:'mid',      brand:'NVIDIA', architecture:'Ada Lovelace', memType:'GDDR6',  keywords:['rtx 4060 ','4060,'] },

  // ── NVIDIA RTX 30 series ─────────────────────────────────────────────────
  { name:'RTX 3090 Ti',    score:23500, vram:24, tdp:450, tier:'ultra',    brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6X', keywords:['3090 ti'] },
  { name:'RTX 3090',       score:20500, vram:24, tdp:350, tier:'ultra',    brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6X', keywords:['rtx 3090 ','3090,'] },
  { name:'RTX 3080 Ti',    score:20000, vram:12, tdp:350, tier:'ultra',    brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6X', keywords:['3080 ti'] },
  { name:'RTX 3080 12GB',  score:19000, vram:12, tdp:350, tier:'ultra',    brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6X', keywords:['3080 12'] },
  { name:'RTX 3080',       score:18500, vram:10, tdp:320, tier:'high',     brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6X', keywords:['rtx 3080 ','3080,'] },
  { name:'RTX 3070 Ti',    score:16500, vram:8,  tdp:290, tier:'high',     brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6X', keywords:['3070 ti'] },
  { name:'RTX 3070',       score:15500, vram:8,  tdp:220, tier:'mid-high', brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6',  keywords:['rtx 3070 ','3070,'] },
  { name:'RTX 3060 Ti',    score:14500, vram:8,  tdp:200, tier:'mid-high', brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6',  keywords:['3060 ti'] },
  { name:'RTX 3060 12GB',  score:12000, vram:12, tdp:170, tier:'mid',      brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6',  keywords:['3060 12','rtx 3060 ','3060,'] },
  { name:'RTX 3050',       score:9500,  vram:8,  tdp:130, tier:'entry',    brand:'NVIDIA', architecture:'Ampere', memType:'GDDR6',  keywords:['rtx 3050'] },

  // ── NVIDIA RTX 20 series ─────────────────────────────────────────────────
  { name:'RTX 2080 Ti',    score:15500, vram:11, tdp:250, tier:'high',     brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['2080 ti'] },
  { name:'RTX 2080 Super', score:14000, vram:8,  tdp:250, tier:'high',     brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['2080 super'] },
  { name:'RTX 2080',       score:12500, vram:8,  tdp:215, tier:'mid-high', brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['rtx 2080 ','2080,'] },
  { name:'RTX 2070 Super', score:12000, vram:8,  tdp:215, tier:'mid-high', brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['2070 super'] },
  { name:'RTX 2070',       score:11000, vram:8,  tdp:175, tier:'mid',      brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['rtx 2070 '] },
  { name:'RTX 2060 Super', score:10500, vram:8,  tdp:175, tier:'mid',      brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['2060 super'] },
  { name:'RTX 2060',       score:9500,  vram:6,  tdp:160, tier:'entry',    brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['rtx 2060 '] },

  // ── NVIDIA GTX 16 series ─────────────────────────────────────────────────
  { name:'GTX 1660 Ti',    score:8500,  vram:6,  tdp:120, tier:'entry',  brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['1660 ti'] },
  { name:'GTX 1660 Super', score:8000,  vram:6,  tdp:125, tier:'entry',  brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['1660 super'] },
  { name:'GTX 1660',       score:7500,  vram:6,  tdp:120, tier:'entry',  brand:'NVIDIA', architecture:'Turing', memType:'GDDR5',  keywords:['gtx 1660 '] },
  { name:'GTX 1650 Super', score:6500,  vram:4,  tdp:100, tier:'budget', brand:'NVIDIA', architecture:'Turing', memType:'GDDR6',  keywords:['1650 super'] },
  { name:'GTX 1650',       score:5000,  vram:4,  tdp:75,  tier:'budget', brand:'NVIDIA', architecture:'Turing', memType:'GDDR5',  keywords:['gtx 1650 '] },

  // ── AMD RX 9000 series ───────────────────────────────────────────────────
  { name:'RX 9070 XT',     score:30000, vram:16, tdp:220, tier:'ultra',    brand:'AMD', architecture:'RDNA 4', memType:'GDDR6',  keywords:['9070 xt'] },
  { name:'RX 9070',        score:26000, vram:16, tdp:190, tier:'high',     brand:'AMD', architecture:'RDNA 4', memType:'GDDR6',  keywords:['rx 9070 ','9070,'] },

  // ── AMD RX 7000 series ───────────────────────────────────────────────────
  { name:'RX 7900 XTX',    score:32000, vram:24, tdp:355, tier:'ultra',    brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['7900 xtx'] },
  { name:'RX 7900 XT',     score:28500, vram:20, tdp:315, tier:'ultra',    brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['7900 xt '] },
  { name:'RX 7900 GRE',    score:25000, vram:16, tdp:260, tier:'high',     brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['7900 gre'] },
  { name:'RX 7800 XT',     score:21000, vram:16, tdp:263, tier:'high',     brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['7800 xt'] },
  { name:'RX 7700 XT',     score:18000, vram:12, tdp:245, tier:'mid-high', brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['7700 xt'] },
  { name:'RX 7600 XT',     score:14500, vram:16, tdp:190, tier:'mid',      brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['7600 xt'] },
  { name:'RX 7600',        score:13000, vram:8,  tdp:165, tier:'mid',      brand:'AMD', architecture:'RDNA 3', memType:'GDDR6',  keywords:['rx 7600 ','7600,'] },

  // ── AMD RX 6000 series ───────────────────────────────────────────────────
  { name:'RX 6950 XT',     score:23500, vram:16, tdp:335, tier:'ultra',    brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6950 xt'] },
  { name:'RX 6900 XT',     score:21500, vram:16, tdp:300, tier:'ultra',    brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6900 xt'] },
  { name:'RX 6800 XT',     score:20000, vram:16, tdp:300, tier:'high',     brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6800 xt'] },
  { name:'RX 6800',        score:19000, vram:16, tdp:250, tier:'high',     brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['rx 6800 ','6800,'] },
  { name:'RX 6750 XT',     score:16500, vram:12, tdp:250, tier:'mid-high', brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6750 xt'] },
  { name:'RX 6700 XT',     score:15500, vram:12, tdp:230, tier:'mid-high', brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6700 xt'] },
  { name:'RX 6700',        score:14000, vram:10, tdp:175, tier:'mid',      brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['rx 6700 ','6700,'] },
  { name:'RX 6650 XT',     score:13000, vram:8,  tdp:180, tier:'mid',      brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6650 xt'] },
  { name:'RX 6600 XT',     score:12000, vram:8,  tdp:160, tier:'mid',      brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6600 xt'] },
  { name:'RX 6600',        score:11000, vram:8,  tdp:132, tier:'entry',    brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['rx 6600 ','6600,'] },
  { name:'RX 6500 XT',     score:6500,  vram:4,  tdp:107, tier:'budget',   brand:'AMD', architecture:'RDNA 2', memType:'GDDR6',  keywords:['6500 xt'] },

  // ── Intel Arc ────────────────────────────────────────────────────────────
  { name:'Arc B580',       score:16000, vram:12, tdp:190, tier:'mid',      brand:'Intel', architecture:'Battlemage', memType:'GDDR6', keywords:['b580'] },
  { name:'Arc A770 16GB',  score:14500, vram:16, tdp:225, tier:'mid',      brand:'Intel', architecture:'Alchemist',  memType:'GDDR6', keywords:['a770 16'] },
  { name:'Arc A770',       score:13500, vram:8,  tdp:225, tier:'mid',      brand:'Intel', architecture:'Alchemist',  memType:'GDDR6', keywords:['arc a770'] },
  { name:'Arc A750',       score:12000, vram:8,  tdp:225, tier:'mid',      brand:'Intel', architecture:'Alchemist',  memType:'GDDR6', keywords:['a750'] },
  { name:'Arc A580',       score:9500,  vram:8,  tdp:185, tier:'entry',    brand:'Intel', architecture:'Alchemist',  memType:'GDDR6', keywords:['a580'] },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────

export function findCpuBenchmark(query: string): CpuBenchmark | null {
  const q = ` ${query.toLowerCase()} `;
  return CPU_BENCHMARKS.find(c =>
    c.keywords.some(k => q.includes(k.toLowerCase())) ||
    q.includes(c.name.toLowerCase())
  ) ?? null;
}

export function findGpuBenchmark(query: string): GpuBenchmark | null {
  const q = ` ${query.toLowerCase()} `;
  return GPU_BENCHMARKS.find(g =>
    g.keywords.some(k => q.includes(k.toLowerCase())) ||
    q.includes(g.name.toLowerCase())
  ) ?? null;
}

export function findBenchmark(query: string, type: 'cpu' | 'gpu' | 'auto' = 'auto'): CpuBenchmark | GpuBenchmark | null {
  if (type === 'cpu') return findCpuBenchmark(query);
  if (type === 'gpu') return findGpuBenchmark(query);
  return findGpuBenchmark(query) ?? findCpuBenchmark(query);
}

export function getCpusByTier(tier: ComponentTier): CpuBenchmark[] {
  return CPU_BENCHMARKS.filter(c => c.tier === tier).sort((a, b) => b.score - a.score);
}

export function getGpusByTier(tier: ComponentTier): GpuBenchmark[] {
  return GPU_BENCHMARKS.filter(g => g.tier === tier).sort((a, b) => b.score - a.score);
}

export function compareComponents(
  a: CpuBenchmark | GpuBenchmark,
  b: CpuBenchmark | GpuBenchmark,
): { faster: string; slowerPercent: number } {
  const diff = Math.abs(a.score - b.score) / Math.max(a.score, b.score) * 100;
  return { faster: a.score >= b.score ? a.name : b.name, slowerPercent: Math.round(diff) };
}
