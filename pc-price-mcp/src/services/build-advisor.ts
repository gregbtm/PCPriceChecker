// Build vs Buy, Budget Builder, and Upgrade Advisor logic.

import { findCpuBenchmark, findGpuBenchmark, CPU_BENCHMARKS, GPU_BENCHMARKS, type ComponentTier } from '../data/benchmarks.js';
import * as db from '../db.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type UseCase =
  | 'gaming_1080p'
  | 'gaming_1440p'
  | 'gaming_4k'
  | 'workstation'
  | 'streaming'
  | 'general';

export interface BuildVsBuyResult {
  buildCost: number | null;
  cheapestPrebuilt: { name: string; price: number; retailer: string; url: string | null } | null;
  verdict: 'build' | 'buy' | 'similar' | 'insufficient_data';
  savingsIfBuild: number | null;
  notes: string[];
  buildComponents: { category: string; name: string; price: number | null; retailer: string | null }[];
}

export interface BudgetAllocation {
  category: string;
  label: string;
  budgetPounds: number;
  allocationPercent: number;
  suggestion: string;
  searchQuery: string;
  tier: ComponentTier;
}

export interface BudgetBuildResult {
  budget: number;
  useCase: UseCase;
  useCaseLabel: string;
  allocations: BudgetAllocation[];
  totalAllocated: number;
  notes: string[];
  pcPartPickerUrl: string;
}

export interface UpgradeOption {
  component: 'cpu' | 'gpu' | 'ram';
  reason: string;
  suggestion: string;
  searchQuery: string;
  estimatedCostPounds: number;
  currentScore: number | null;
  upgradeScore: number | null;
  gainPercent: number | null;
  valueScore: number | null; // gain% per £100 spent
}

export interface UpgradeAdvisorResult {
  currentCpu: string;
  currentGpu: string;
  budget: number;
  useCase: UseCase;
  bottleneck: 'cpu' | 'gpu' | 'balanced' | 'unknown';
  bottleneckReason: string;
  recommendations: UpgradeOption[];
  notes: string[];
}

// ── Budget allocation templates ────────────────────────────────────────────

const USE_CASE_TEMPLATES: Record<UseCase, { label: string; allocation: Record<string, number>; notes: string[] }> = {
  gaming_1080p: {
    label: '1080p Gaming',
    allocation: { gpu: 28, cpu: 22, motherboard: 10, ram: 10, storage: 12, psu: 9, case: 6, cooling: 3 },
    notes: ['At 1080p a mid-tier GPU is plenty — invest in CPU and storage.', 'Target 16GB DDR4/DDR5 minimum.'],
  },
  gaming_1440p: {
    label: '1440p Gaming',
    allocation: { gpu: 34, cpu: 20, motherboard: 10, ram: 9, storage: 10, psu: 8, case: 6, cooling: 3 },
    notes: ['1440p is GPU-heavy. Prioritise GPU budget over CPU.', 'A Ryzen 5 or i5 is sufficient paired with a strong GPU.'],
  },
  gaming_4k: {
    label: '4K Gaming',
    allocation: { gpu: 40, cpu: 17, motherboard: 9, ram: 8, storage: 9, psu: 8, case: 5, cooling: 4 },
    notes: ['4K is almost entirely GPU-limited. Spend as much as possible on the GPU.', 'CPU bottleneck is rare at 4K — a mid-tier CPU is fine.'],
  },
  workstation: {
    label: 'Workstation (3D / Video / Rendering)',
    allocation: { cpu: 28, gpu: 22, motherboard: 12, ram: 18, storage: 12, psu: 5, case: 2, cooling: 1 },
    notes: ['Rendering and compiling are CPU and RAM heavy.', 'Consider 32GB+ RAM for video editing or 3D work.', 'GPU matters mainly for GPU-accelerated tasks (CUDA/OpenCL).'],
  },
  streaming: {
    label: 'Streaming + Gaming',
    allocation: { gpu: 30, cpu: 25, motherboard: 10, ram: 10, storage: 10, psu: 7, case: 5, cooling: 3 },
    notes: ['Streaming benefits from more CPU cores — consider Ryzen 7 or i7.', '32GB RAM helps if streaming while running heavy games.'],
  },
  general: {
    label: 'General Purpose',
    allocation: { cpu: 22, gpu: 18, motherboard: 12, ram: 12, storage: 16, psu: 8, case: 7, cooling: 5 },
    notes: ['Balanced build suitable for everyday work and light gaming.', 'Integrated graphics may suffice if dedicated GPU is skipped.'],
  },
};

// Map component budget → suggested product name and search query
function suggestCpu(budget: number): { name: string; query: string; tier: ComponentTier } {
  if (budget >= 450) return { name: 'Ryzen 9 7950X / Core Ultra 9 285K',   query: 'Ryzen 9 7950X',           tier: 'ultra' };
  if (budget >= 300) return { name: 'Ryzen 7 7800X3D / Core i7-14700K',    query: 'Ryzen 7 7800X3D',          tier: 'high' };
  if (budget >= 200) return { name: 'Ryzen 5 7600X / Core i5-14600K',      query: 'Ryzen 5 7600X Core i5 14600K', tier: 'mid-high' };
  if (budget >= 130) return { name: 'Ryzen 5 7600 / Core i5-13400F',       query: 'Ryzen 5 7600 i5 13400F',   tier: 'mid' };
  if (budget >= 90)  return { name: 'Ryzen 5 5600 / Core i3-13100F',       query: 'Ryzen 5 5600 i3 13100F',   tier: 'entry' };
  return              { name: 'Ryzen 5 5500 / Core i3-12100F',              query: 'Ryzen 5 5500 i3 12100F',   tier: 'budget' };
}

function suggestGpu(budget: number): { name: string; query: string; tier: ComponentTier } {
  if (budget >= 1300) return { name: 'RTX 4090 / RTX 5080',               query: 'RTX 4090 RTX 5080',      tier: 'ultra' };
  if (budget >= 900)  return { name: 'RTX 4080 Super / RX 7900 XTX',      query: 'RTX 4080 Super RX 7900 XTX', tier: 'ultra' };
  if (budget >= 650)  return { name: 'RTX 4070 Ti Super / RX 7900 GRE',   query: 'RTX 4070 Ti Super RX 7900 GRE', tier: 'high' };
  if (budget >= 450)  return { name: 'RTX 4070 Super / RX 7800 XT',       query: 'RTX 4070 Super RX 7800 XT', tier: 'high' };
  if (budget >= 330)  return { name: 'RTX 4070 / RX 7700 XT',             query: 'RTX 4070 RX 7700 XT',    tier: 'mid-high' };
  if (budget >= 250)  return { name: 'RTX 4060 Ti / RX 7600 XT',          query: 'RTX 4060 Ti RX 7600 XT', tier: 'mid' };
  if (budget >= 180)  return { name: 'RTX 4060 / RX 6600 XT',             query: 'RTX 4060 RX 6600 XT',    tier: 'mid' };
  if (budget >= 130)  return { name: 'RX 6600 / Arc B580',                query: 'RX 6600 Arc B580',       tier: 'entry' };
  return              { name: 'RX 6500 XT / GTX 1650 Super',               query: 'RX 6500 XT GTX 1650 Super', tier: 'budget' };
}

function suggestMotherboard(budget: number, cpuSuggestion: string): { name: string; query: string; tier: ComponentTier } {
  const isAm5 = /7[678]\d{2}|[789][69]\d{2}/.test(cpuSuggestion);
  if (isAm5) {
    if (budget >= 200) return { name: 'X670E board (ASRock / Asus / MSI)', query: 'AM5 X670E motherboard', tier: 'high' };
    if (budget >= 120) return { name: 'B650 board (Asus / Gigabyte)', query: 'AM5 B650 motherboard', tier: 'mid' };
    return              { name: 'B650 budget board', query: 'AM5 B650 motherboard budget', tier: 'entry' };
  }
  // LGA1700 / AM4 defaults
  if (budget >= 200) return { name: 'Z790 / Z690 (Asus / MSI)', query: 'Z790 Z690 LGA1700 motherboard', tier: 'high' };
  if (budget >= 120) return { name: 'B760 / B660 (Gigabyte / ASRock)', query: 'B760 B660 LGA1700 motherboard', tier: 'mid' };
  return              { name: 'B550 / B660 budget board', query: 'B550 B660 motherboard budget', tier: 'entry' };
}

function suggestRam(budget: number): { name: string; query: string; tier: ComponentTier } {
  if (budget >= 120) return { name: '32GB DDR5-6000 (Corsair / G.Skill)', query: '32GB DDR5 6000 RAM', tier: 'high' };
  if (budget >= 65)  return { name: '32GB DDR4-3600 / 16GB DDR5-6000', query: '32GB DDR4 3600 16GB DDR5 6000', tier: 'mid' };
  if (budget >= 40)  return { name: '16GB DDR4-3200 (Crucial / Kingston)', query: '16GB DDR4 3200 RAM', tier: 'entry' };
  return              { name: '16GB DDR4-3200 budget kit', query: '16GB DDR4 3200', tier: 'budget' };
}

function suggestStorage(budget: number): { name: string; query: string; tier: ComponentTier } {
  if (budget >= 120) return { name: '2TB NVMe Gen4 SSD (Samsung 990 Pro / WD Black)', query: '2TB NVMe Gen4 SSD', tier: 'high' };
  if (budget >= 70)  return { name: '1TB NVMe Gen4 SSD (Samsung 980 Pro / Seagate)', query: '1TB NVMe Gen4 SSD', tier: 'mid' };
  if (budget >= 40)  return { name: '1TB NVMe Gen3 SSD (Crucial P3 / Kingston)', query: '1TB NVMe SSD', tier: 'entry' };
  return              { name: '500GB NVMe SSD', query: '500GB NVMe SSD', tier: 'budget' };
}

function suggestPsu(budget: number): { name: string; query: string; tier: ComponentTier } {
  if (budget >= 120) return { name: '850W 80+ Gold (Seasonic / Corsair RM850x)', query: '850W 80+ Gold PSU modular', tier: 'high' };
  if (budget >= 80)  return { name: '750W 80+ Gold (be quiet! Pure Power)', query: '750W 80+ Gold PSU', tier: 'mid' };
  if (budget >= 55)  return { name: '650W 80+ Bronze (EVGA / Corsair)', query: '650W 80+ Bronze PSU', tier: 'entry' };
  return              { name: '550W 80+ Bronze budget PSU', query: '550W PSU 80 plus bronze', tier: 'budget' };
}

function suggestCase(budget: number): { name: string; query: string; tier: ComponentTier } {
  if (budget >= 100) return { name: 'Fractal Meshify 2 / Lian Li Lancool III', query: 'Fractal Meshify 2 Lian Li Lancool III', tier: 'high' };
  if (budget >= 60)  return { name: 'be quiet! Pure Base 500DX / NZXT H510', query: 'PC case mid tower ATX airflow', tier: 'mid' };
  return              { name: 'Budget ATX case (Montech AIR 100)', query: 'budget ATX PC case', tier: 'entry' };
}

function suggestCooler(budget: number, cpuTdp: number): { name: string; query: string; tier: ComponentTier } {
  if (cpuTdp >= 170 || budget >= 60) return { name: 'Noctua NH-D15 / be quiet! Dark Rock Pro 4', query: 'Noctua NH-D15 dark rock pro CPU cooler', tier: 'high' };
  if (budget >= 35 || cpuTdp >= 105) return { name: 'be quiet! Pure Rock 2 / DeepCool AK400', query: 'DeepCool AK400 be quiet Pure Rock 2', tier: 'mid' };
  return { name: 'Budget tower cooler (ID-Cooling SE-214-XT)', query: 'budget CPU air cooler tower', tier: 'entry' };
}

// ── Build vs Buy ───────────────────────────────────────────────────────────

export function buildVsBuy(options: {
  cpu?: string;
  gpu?: string;
  ramGb?: number;
  storageGb?: number;
}): BuildVsBuyResult {
  const buildComponents: BuildVsBuyResult['buildComponents'] = [];
  const notes: string[] = [];
  let buildCost = 0;
  let missingPrices = 0;

  // Find tracked components matching the specified parts
  const allComponents = db.getTrackedComponents();

  const lookup = (query: string | undefined, category: string) => {
    if (!query) return;
    const q = query.toLowerCase();
    const match = allComponents.find(c =>
      c.category === category && (
        c.name.toLowerCase().includes(q) ||
        c.search_query.toLowerCase().includes(q) ||
        q.includes(c.name.toLowerCase().split(' ').slice(-2).join(' '))
      )
    );
    if (match) {
      const best = db.getLatestPricePerRetailer(match.id)[0];
      buildComponents.push({
        category,
        name: match.name,
        price: best?.price ?? null,
        retailer: best?.retailer ?? null,
      });
      if (best?.price) buildCost += best.price;
      else missingPrices++;
    } else {
      buildComponents.push({ category, name: query, price: null, retailer: null });
      missingPrices++;
    }
  };

  lookup(options.cpu, 'cpu');
  lookup(options.gpu, 'gpu');

  if (options.ramGb) {
    const ramQ = `${options.ramGb}GB RAM`;
    lookup(ramQ, 'ram');
  }
  if (options.storageGb) {
    const stQ = `${options.storageGb}GB SSD`;
    lookup(stQ, 'storage');
  }

  if (missingPrices > 0) {
    notes.push(`${missingPrices} component(s) not found in your tracked list — prices are estimates. Add them with track_component to get live prices.`);
  }

  // Find pre-built systems in DB
  const prebuilt = db.getPrebuiltSystems();
  let cheapestPrebuilt: BuildVsBuyResult['cheapestPrebuilt'] = null;

  for (const sys of prebuilt) {
    const sysLatest = db.getLatestPrebuiltPricePerRetailer(sys.id)[0];
    if (!sysLatest) continue;

    const cpuMatch = options.cpu && sys.cpu
      ? sys.cpu.toLowerCase().includes(options.cpu.toLowerCase().slice(0, 6))
      : true;
    const gpuMatch = options.gpu && sys.gpu
      ? sys.gpu.toLowerCase().includes(options.gpu.toLowerCase().slice(0, 6))
      : true;

    if (cpuMatch && gpuMatch) {
      if (!cheapestPrebuilt || sysLatest.price < cheapestPrebuilt.price) {
        cheapestPrebuilt = {
          name: sys.name,
          price: sysLatest.price,
          retailer: sysLatest.retailer,
          url: sysLatest.url,
        };
      }
    }
  }

  if (prebuilt.length === 0) {
    notes.push('No pre-built systems are being tracked. Use search_prebuilt to find and track pre-built PCs for comparison.');
  }

  const savingsIfBuild =
    cheapestPrebuilt && buildCost > 0
      ? Math.round(cheapestPrebuilt.price - buildCost)
      : null;

  let verdict: BuildVsBuyResult['verdict'] = 'insufficient_data';
  if (buildCost > 0 && cheapestPrebuilt) {
    const diff = cheapestPrebuilt.price - buildCost;
    if (diff > 50) {
      verdict = 'build';
      notes.push(`Building saves approximately £${diff} vs the cheapest matching pre-built.`);
      notes.push('Building also gives full component choice, better upgrade path, and typically higher-quality PSU and cooling.');
    } else if (diff < -50) {
      verdict = 'buy';
      notes.push(`The pre-built (${cheapestPrebuilt.name}) is £${Math.abs(diff)} cheaper than sourcing parts separately.`);
      notes.push('Pre-builts sometimes include an OS licence which adds further value.');
    } else {
      verdict = 'similar';
      notes.push('Costs are similar. Build for control and upgradability; buy for convenience and warranty.');
    }
  }

  if (buildCost === 0) {
    notes.push('Start tracking individual components to get accurate build vs buy pricing.');
  }

  return { buildCost: buildCost || null, cheapestPrebuilt, verdict, savingsIfBuild, notes, buildComponents };
}

// ── Budget Builder ─────────────────────────────────────────────────────────

export function budgetBuilder(budget: number, useCase: UseCase = 'gaming_1440p'): BudgetBuildResult {
  const template = USE_CASE_TEMPLATES[useCase];
  const allocations: BudgetAllocation[] = [];
  let totalAllocated = 0;

  const gpuBudget = Math.round(budget * template.allocation.gpu / 100);
  const cpuBudget = Math.round(budget * template.allocation.cpu / 100);
  const moboBudget = Math.round(budget * template.allocation.motherboard / 100);
  const ramBudget = Math.round(budget * template.allocation.ram / 100);
  const storageBudget = Math.round(budget * template.allocation.storage / 100);
  const psuBudget = Math.round(budget * template.allocation.psu / 100);
  const caseBudget = Math.round(budget * template.allocation.case / 100);
  const coolerBudget = Math.round(budget * template.allocation.cooling / 100);

  const cpuSug = suggestCpu(cpuBudget);
  const gpuSug = suggestGpu(gpuBudget);
  const moboSug = suggestMotherboard(moboBudget, cpuSug.query);
  const ramSug = suggestRam(ramBudget);
  const storageSug = suggestStorage(storageBudget);
  const psuSug = suggestPsu(psuBudget);
  const caseSug = suggestCase(caseBudget);
  const cpuData = findCpuBenchmark(cpuSug.name);
  const coolerSug = suggestCooler(coolerBudget, cpuData?.tdp ?? 65);

  const parts = [
    { category: 'GPU', label: 'Graphics Card', budget: gpuBudget, pct: template.allocation.gpu, sug: gpuSug },
    { category: 'CPU', label: 'Processor', budget: cpuBudget, pct: template.allocation.cpu, sug: cpuSug },
    { category: 'Motherboard', label: 'Motherboard', budget: moboBudget, pct: template.allocation.motherboard, sug: moboSug },
    { category: 'RAM', label: 'Memory', budget: ramBudget, pct: template.allocation.ram, sug: ramSug },
    { category: 'Storage', label: 'Storage (SSD)', budget: storageBudget, pct: template.allocation.storage, sug: storageSug },
    { category: 'PSU', label: 'Power Supply', budget: psuBudget, pct: template.allocation.psu, sug: psuSug },
    { category: 'Case', label: 'Case', budget: caseBudget, pct: template.allocation.case, sug: caseSug },
    { category: 'Cooling', label: 'CPU Cooler', budget: coolerBudget, pct: template.allocation.cooling, sug: coolerSug },
  ];

  for (const p of parts) {
    allocations.push({
      category: p.category,
      label: p.label,
      budgetPounds: p.budget,
      allocationPercent: p.pct,
      suggestion: p.sug.name,
      searchQuery: p.sug.query,
      tier: p.sug.tier,
    });
    totalAllocated += p.budget;
  }

  const leftover = budget - totalAllocated;
  const notes = [...template.notes];
  if (leftover > 0) notes.push(`£${leftover} unallocated — put it toward the GPU or storage upgrade.`);
  notes.push('Prices fluctuate — use the price tracker to find the best current deals on each component.');
  notes.push('Windows 11 Home adds approximately £100–£120 if you need an OS licence.');

  const pcPartPickerUrl = `https://uk.pcpartpicker.com/list/`;

  return { budget, useCase, useCaseLabel: template.label, allocations, totalAllocated, notes, pcPartPickerUrl };
}

// ── Upgrade Advisor ────────────────────────────────────────────────────────

export function upgradeAdvisor(options: {
  currentCpu: string;
  currentGpu: string;
  budget: number;
  useCase: UseCase;
}): UpgradeAdvisorResult {
  const { currentCpu, currentGpu, budget, useCase } = options;
  const notes: string[] = [];

  const cpuData = findCpuBenchmark(currentCpu);
  const gpuData = findGpuBenchmark(currentGpu);

  // Determine bottleneck
  let bottleneck: UpgradeAdvisorResult['bottleneck'] = 'unknown';
  let bottleneckReason = '';

  if (cpuData && gpuData) {
    const cpuScore = cpuData.score;
    const gpuScore = gpuData.score;
    const cpuTierIdx = ['budget', 'entry', 'mid', 'mid-high', 'high', 'ultra'].indexOf(cpuData.tier);
    const gpuTierIdx = ['budget', 'entry', 'mid', 'mid-high', 'high', 'ultra'].indexOf(gpuData.tier);

    if (useCase === 'gaming_4k') {
      bottleneck = 'gpu';
      bottleneckReason = '4K gaming is almost entirely GPU-limited — your CPU is rarely the constraint.';
    } else if (useCase === 'workstation') {
      bottleneck = 'cpu';
      bottleneckReason = 'Workstation tasks (rendering, compiling, encoding) are CPU and RAM bound.';
    } else if (gpuTierIdx < cpuTierIdx - 1) {
      bottleneck = 'gpu';
      bottleneckReason = `Your GPU (${gpuData.tier}) is significantly weaker than your CPU (${cpuData.tier}) — the GPU is holding you back.`;
    } else if (cpuTierIdx < gpuTierIdx - 1) {
      bottleneck = 'cpu';
      bottleneckReason = `Your CPU (${cpuData.tier}) is significantly weaker than your GPU (${gpuData.tier}) — the CPU is the bottleneck.`;
    } else {
      bottleneck = 'balanced';
      bottleneckReason = 'CPU and GPU are relatively balanced. Upgrade whichever component aligns with your performance goal.';
    }
  } else {
    if (!cpuData) notes.push(`Could not find benchmark data for "${currentCpu}" — try a more specific name.`);
    if (!gpuData) notes.push(`Could not find benchmark data for "${currentGpu}" — try a more specific name.`);
  }

  const recommendations: UpgradeOption[] = [];

  // GPU upgrade candidates
  if (bottleneck !== 'cpu') {
    const candidates = GPU_BENCHMARKS
      .filter(g => {
        if (!gpuData) return g.score > 12000; // default if unknown
        return g.score > gpuData.score * 1.2; // at least 20% faster
      })
      .sort((a, b) => {
        // Sort by performance gain per notional £100 (using tier-based price estimates)
        return b.score - a.score;
      })
      .slice(0, 3);

    for (const gpu of candidates) {
      const approxPrice = gpuTierToPrice(gpu.tier);
      if (approxPrice <= budget) {
        const gainPct = gpuData ? Math.round((gpu.score - gpuData.score) / gpuData.score * 100) : null;
        const valueScore = gainPct != null ? Math.round(gainPct / (approxPrice / 100)) : null;
        recommendations.push({
          component: 'gpu',
          reason: bottleneck === 'gpu' ? 'GPU is the primary bottleneck' : 'GPU upgrade provides the highest gaming gains',
          suggestion: gpu.name,
          searchQuery: gpu.name,
          estimatedCostPounds: approxPrice,
          currentScore: gpuData?.score ?? null,
          upgradeScore: gpu.score,
          gainPercent: gainPct,
          valueScore,
        });
      }
    }
  }

  // CPU upgrade candidates
  if (bottleneck !== 'gpu') {
    const candidates = CPU_BENCHMARKS
      .filter(c => {
        if (!cpuData) return c.score > 20000;
        // Must be same or compatible socket (or AM5/LGA1851 = new platform)
        return c.score > cpuData.score * 1.2;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const cpu of candidates) {
      const approxPrice = cpuTierToPrice(cpu.tier);
      if (approxPrice <= budget) {
        const newPlatform = cpuData && cpu.socket !== cpuData.socket;
        const gainPct = cpuData ? Math.round((cpu.score - cpuData.score) / cpuData.score * 100) : null;
        const totalCost = newPlatform ? approxPrice + 120 : approxPrice; // rough mobo cost if new platform
        const valueScore = gainPct != null ? Math.round(gainPct / (totalCost / 100)) : null;
        recommendations.push({
          component: 'cpu',
          reason: newPlatform
            ? `${cpu.name} uses ${cpu.socket} — new motherboard required (~£120 extra)`
            : `${cpu.name} is a drop-in upgrade on ${cpu.socket}`,
          suggestion: cpu.name,
          searchQuery: cpu.name,
          estimatedCostPounds: totalCost,
          currentScore: cpuData?.score ?? null,
          upgradeScore: cpu.score,
          gainPercent: gainPct,
          valueScore,
        });
      }
    }
  }

  // RAM upgrade hint
  if (useCase === 'workstation' || useCase === 'streaming') {
    recommendations.push({
      component: 'ram',
      reason: 'More RAM significantly helps workstation and streaming tasks',
      suggestion: '32GB DDR4-3600 / DDR5-6000',
      searchQuery: '32GB DDR5 6000 RAM',
      estimatedCostPounds: 60,
      currentScore: null,
      upgradeScore: null,
      gainPercent: null,
      valueScore: null,
    });
  }

  // Sort by value score descending, nulls last
  recommendations.sort((a, b) => (b.valueScore ?? -1) - (a.valueScore ?? -1));

  if (recommendations.length === 0) {
    notes.push(`No upgrades found within £${budget} that provide a meaningful performance gain. Consider increasing the budget.`);
  }

  return { currentCpu, currentGpu, budget, useCase, bottleneck, bottleneckReason, recommendations, notes };
}

function gpuTierToPrice(tier: ComponentTier): number {
  const prices: Record<ComponentTier, number> = {
    budget: 90, entry: 150, mid: 260, 'mid-high': 380, high: 550, ultra: 900,
  };
  return prices[tier];
}

function cpuTierToPrice(tier: ComponentTier): number {
  const prices: Record<ComponentTier, number> = {
    budget: 60, entry: 110, mid: 160, 'mid-high': 240, high: 380, ultra: 560,
  };
  return prices[tier];
}
