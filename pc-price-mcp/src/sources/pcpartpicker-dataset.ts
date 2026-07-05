/**
 * PC part specs database sourced from docyx/pc-part-dataset.
 * Data: https://raw.githubusercontent.com/docyx/pc-part-dataset/main/data/json/{slug}.json
 * 66,000+ components, last updated July 2025. Prices are USD reference only.
 */

const BASE_URL = 'https://raw.githubusercontent.com/docyx/pc-part-dataset/main/data/json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — dataset updates monthly

export const DATASET_SLUGS = [
  'cpu', 'cpu-cooler', 'motherboard', 'memory', 'internal-hard-drive',
  'video-card', 'power-supply', 'case', 'case-fan', 'fan-controller',
  'thermal-paste', 'optical-drive', 'sound-card', 'wired-network-card',
  'wireless-network-card', 'monitor', 'external-hard-drive', 'headphones',
  'keyboard', 'mouse', 'speakers', 'webcam', 'ups', 'os', 'case-accessory',
] as const;

export type DatasetSlug = typeof DATASET_SLUGS[number];

export const CATEGORY_TO_DATASET_SLUG: Partial<Record<string, DatasetSlug>> = {
  gpu: 'video-card',
  cpu: 'cpu',
  ram: 'memory',
  motherboard: 'motherboard',
  storage: 'internal-hard-drive',
  psu: 'power-supply',
  case: 'case',
  cooling: 'cpu-cooler',
  monitor: 'monitor',
};

export interface DatasetComponent {
  name: string;
  price: number | null; // USD reference price from PCPartPicker
  slug: DatasetSlug;
  specs: Record<string, string | number>;
  filters: Record<string, number>;
}

// ── Filterable attributes ────────────────────────────────────────────────────
// A subset of specs, kept as raw numbers (not the formatted display strings in
// `specs`) so range filters (min/max) work. Only defined for categories with a
// clear, commonly-compared numeric spec — the rest still get search + sort.

export interface FilterField {
  key: string;
  label: string;
  unit?: string;
}

export const FILTER_SCHEMA: Partial<Record<DatasetSlug, FilterField[]>> = {
  cpu: [
    { key: 'cores', label: 'Cores' },
    { key: 'tdp', label: 'TDP', unit: 'W' },
  ],
  'video-card': [
    { key: 'vram', label: 'VRAM', unit: 'GB' },
    { key: 'length', label: 'Length', unit: 'mm' },
  ],
  motherboard: [
    { key: 'max_memory', label: 'Max RAM', unit: 'GB' },
  ],
  memory: [
    { key: 'capacity', label: 'Kit Capacity', unit: 'GB' },
    { key: 'speed', label: 'Speed', unit: 'MT/s' },
  ],
  'internal-hard-drive': [
    { key: 'capacity', label: 'Capacity', unit: 'GB' },
  ],
  'power-supply': [
    { key: 'wattage', label: 'Wattage', unit: 'W' },
  ],
  case: [
    { key: 'volume', label: 'Volume', unit: 'L' },
  ],
  monitor: [
    { key: 'screen_size', label: 'Screen Size', unit: '"' },
    { key: 'refresh_rate', label: 'Refresh Rate', unit: 'Hz' },
  ],
  'cpu-cooler': [
    { key: 'radiator_size', label: 'Radiator', unit: 'mm' },
  ],
};

function extractFilters(raw: Record<string, unknown>, slug: DatasetSlug): Record<string, number> {
  const f: Record<string, number> = {};

  if (slug === 'cpu') {
    if (typeof raw.core_count === 'number') f.cores = raw.core_count;
    if (typeof raw.tdp === 'number') f.tdp = raw.tdp;

  } else if (slug === 'video-card') {
    if (typeof raw.memory === 'number') f.vram = raw.memory;
    if (typeof raw.length === 'number') f.length = raw.length;

  } else if (slug === 'motherboard') {
    if (typeof raw.max_memory === 'number') f.max_memory = raw.max_memory;

  } else if (slug === 'memory') {
    const mods = raw.modules as [number, number] | null;
    if (Array.isArray(mods)) f.capacity = mods[0] * mods[1];
    const speed = raw.speed as [number, number] | null;
    if (Array.isArray(speed)) f.speed = speed[1];

  } else if (slug === 'internal-hard-drive') {
    if (typeof raw.capacity === 'number') f.capacity = raw.capacity;

  } else if (slug === 'power-supply') {
    if (typeof raw.wattage === 'number') f.wattage = raw.wattage;

  } else if (slug === 'case') {
    if (typeof raw.external_volume === 'number') f.volume = raw.external_volume;

  } else if (slug === 'monitor') {
    if (typeof raw.screen_size === 'number') f.screen_size = raw.screen_size;
    if (typeof raw.refresh_rate === 'number') f.refresh_rate = raw.refresh_rate;

  } else if (slug === 'cpu-cooler') {
    if (typeof raw.size === 'number') f.radiator_size = raw.size;
  }

  return f;
}

export interface FilterRange { min?: number; max?: number }
export type FilterValues = Record<string, FilterRange>;

function matchesFilters(item: DatasetComponent, filters: FilterValues): boolean {
  for (const [key, range] of Object.entries(filters)) {
    const v = item.filters[key];
    if (v === undefined) return false;
    if (range.min != null && v < range.min) return false;
    if (range.max != null && v > range.max) return false;
  }
  return true;
}

// ── Spec formatters ─────────────────────────────────────────────────────────

type RangeVal = number | [number, number] | null;

function fmtRange(val: RangeVal, unit = ''): string | null {
  if (val == null) return null;
  if (Array.isArray(val)) return `${val[0]}–${val[1]}${unit ? ' ' + unit : ''}`;
  return `${val}${unit ? ' ' + unit : ''}`;
}

function buildSpecs(raw: Record<string, unknown>, slug: DatasetSlug): Record<string, string | number> {
  const s: Record<string, string | number> = {};

  if (slug === 'cpu') {
    if (raw.core_count != null)      s['Cores']        = raw.core_count as number;
    if (raw.core_clock != null)      s['Base Clock']   = `${raw.core_clock} GHz`;
    if (raw.boost_clock != null)     s['Boost Clock']  = `${raw.boost_clock} GHz`;
    if (raw.microarchitecture)       s['Architecture'] = raw.microarchitecture as string;
    if (raw.tdp != null)             s['TDP']          = `${raw.tdp}W`;
    if (raw.graphics)                s['iGPU']         = raw.graphics as string;
    if (raw.smt != null)             s['SMT']          = raw.smt ? 'Yes' : 'No';

  } else if (slug === 'video-card') {
    if (raw.chipset)             s['Chipset']     = raw.chipset as string;
    if (raw.memory != null)      s['VRAM']        = `${raw.memory} GB`;
    if (raw.core_clock != null)  s['Core Clock']  = `${raw.core_clock} MHz`;
    if (raw.boost_clock != null) s['Boost Clock'] = `${raw.boost_clock} MHz`;
    if (raw.length != null)      s['Length']      = `${raw.length}mm`;
    if (raw.color)               s['Color']       = raw.color as string;

  } else if (slug === 'motherboard') {
    if (raw.socket)              s['Socket']      = raw.socket as string;
    if (raw.form_factor)         s['Form Factor'] = raw.form_factor as string;
    if (raw.max_memory != null)  s['Max RAM']     = `${raw.max_memory} GB`;
    if (raw.memory_slots != null) s['RAM Slots']  = raw.memory_slots as number;
    if (raw.color)               s['Color']       = raw.color as string;

  } else if (slug === 'memory') {
    const speed = raw.speed as [number, number] | null;
    if (speed)                            s['Speed']              = `DDR${speed[0]}-${speed[1]}`;
    const mods = raw.modules as [number, number] | null;
    if (mods)                             s['Kit']                = `${mods[0]}×${mods[1]} GB`;
    if (raw.cas_latency != null)          s['CAS Latency']        = `CL${raw.cas_latency}`;
    if (raw.first_word_latency != null)   s['First Word Latency'] = `${raw.first_word_latency} ns`;
    if (raw.color)                        s['Color']              = raw.color as string;

  } else if (slug === 'internal-hard-drive') {
    if (raw.capacity != null) {
      const gb = raw.capacity as number;
      s['Capacity'] = gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`;
    }
    if (raw.type)            s['Type']        = raw.type as string;
    if (raw.form_factor)     s['Form Factor'] = raw.form_factor as string;
    if (raw.interface)       s['Interface']   = raw.interface as string;
    if (raw.cache != null)   s['Cache']       = `${raw.cache} MB`;

  } else if (slug === 'power-supply') {
    if (raw.type)            s['Form Factor'] = raw.type as string;
    if (raw.wattage != null) s['Wattage']     = `${raw.wattage}W`;
    if (raw.efficiency)      s['Efficiency']  = raw.efficiency as string;
    if (raw.modular)         s['Modular']     = raw.modular as string;
    if (raw.color)           s['Color']       = raw.color as string;

  } else if (slug === 'case') {
    if (raw.type)                    s['Form Factor']  = raw.type as string;
    if (raw.side_panel)              s['Side Panel']   = raw.side_panel as string;
    if (raw.external_volume != null) s['Volume']       = `${raw.external_volume} L`;
    if (raw.internal_35_bays != null) s['3.5" Bays']  = raw.internal_35_bays as number;
    if (raw.psu != null)             s['Included PSU'] = `${raw.psu}W`;
    if (raw.color)                   s['Color']        = raw.color as string;

  } else if (slug === 'cpu-cooler') {
    const rpm = fmtRange(raw.rpm as RangeVal);
    if (rpm)           s['Fan RPM'] = rpm;
    const noise = fmtRange(raw.noise_level as RangeVal, 'dB');
    if (noise)         s['Noise']   = noise;
    if (raw.size != null) s['Radiator'] = `${raw.size}mm`;
    if (raw.color)     s['Color']   = raw.color as string;

  } else if (slug === 'monitor') {
    if (raw.screen_size != null)  s['Size']          = `${raw.screen_size}"`;
    const res = raw.resolution as [number, number] | null;
    if (res)                      s['Resolution']    = `${res[0]}×${res[1]}`;
    if (raw.refresh_rate != null) s['Refresh Rate']  = `${raw.refresh_rate} Hz`;
    if (raw.response_time != null) s['Response Time'] = `${raw.response_time} ms`;
    if (raw.panel_type)           s['Panel']         = raw.panel_type as string;
    if (raw.aspect_ratio)         s['Aspect Ratio']  = raw.aspect_ratio as string;

  } else if (slug === 'case-fan') {
    if (raw.size != null)       s['Size']    = `${raw.size}mm`;
    const rpm = fmtRange(raw.rpm as RangeVal);
    if (rpm)                    s['RPM']     = rpm;
    const af = fmtRange(raw.airflow as RangeVal, 'CFM');
    if (af)                     s['Airflow'] = af;
    const noise = fmtRange(raw.noise_level as RangeVal, 'dB');
    if (noise)                  s['Noise']   = noise;
    if (raw.pwm != null)        s['PWM']     = raw.pwm ? 'Yes' : 'No';
    if (raw.color)              s['Color']   = raw.color as string;

  } else if (slug === 'sound-card') {
    if (raw.channels != null)      s['Channels']    = raw.channels as string | number;
    if (raw.digital_audio)         s['Bit Depth']   = raw.digital_audio as string;
    if (raw.snr != null)           s['SNR']         = `${raw.snr} dB`;
    if (raw.sample_rate != null)   s['Sample Rate'] = `${raw.sample_rate} kHz`;
    if (raw.chipset)               s['Chipset']     = raw.chipset as string;
    if (raw.interface)             s['Interface']   = raw.interface as string;

  } else if (slug === 'headphones') {
    if (raw.type)              s['Type']     = raw.type as string;
    const freq = raw.frequency_response as [number, number] | null;
    if (freq)                  s['Freq Response'] = `${freq[0]}–${freq[1]} Hz`;
    if (raw.microphone != null) s['Microphone'] = raw.microphone ? 'Yes' : 'No';
    if (raw.wireless != null)  s['Wireless']  = raw.wireless ? 'Yes' : 'No';
    if (raw.enclosure_type)    s['Enclosure'] = raw.enclosure_type as string;
    if (raw.color)             s['Color']     = raw.color as string;

  } else if (slug === 'keyboard') {
    if (raw.style)             s['Style']      = raw.style as string;
    if (raw.switches)          s['Switches']   = raw.switches as string;
    if (raw.backlit)           s['Backlit']    = raw.backlit as string;
    if (raw.tenkeyless != null) s['Tenkeyless'] = raw.tenkeyless ? 'Yes' : 'No';
    if (raw.connection_type)   s['Connection'] = raw.connection_type as string;
    if (raw.color)             s['Color']      = raw.color as string;

  } else if (slug === 'mouse') {
    if (raw.tracking_method)   s['Tracking']    = raw.tracking_method as string;
    if (raw.connection_type)   s['Connection']  = raw.connection_type as string;
    if (raw.max_dpi != null)   s['Max DPI']     = raw.max_dpi as number;
    if (raw.hand_orientation)  s['Orientation'] = raw.hand_orientation as string;
    if (raw.color)             s['Color']       = raw.color as string;

  } else if (slug === 'thermal-paste') {
    if (raw.amount != null)    s['Amount'] = `${raw.amount}g`;

  } else if (slug === 'wireless-network-card') {
    if (raw.protocol)          s['Protocol']  = raw.protocol as string;
    if (raw.interface)         s['Interface'] = raw.interface as string;
    if (raw.color)             s['Color']     = raw.color as string;

  } else if (slug === 'wired-network-card') {
    if (raw.interface)         s['Interface'] = raw.interface as string;
    if (raw.color)             s['Color']     = raw.color as string;

  } else if (slug === 'ups') {
    if (raw.capacity_w != null)  s['Capacity']  = `${raw.capacity_w}W`;
    if (raw.capacity_va != null) s['VA Rating'] = `${raw.capacity_va} VA`;

  } else if (slug === 'speakers') {
    if (raw.configuration)      s['Config']   = raw.configuration as string;
    if (raw.wattage != null)    s['Wattage']  = `${raw.wattage}W`;
    const freq = raw.frequency_response as [number, number] | null;
    if (freq)                   s['Freq Response'] = `${freq[0]}–${freq[1]} Hz`;
    if (raw.color)              s['Color']    = raw.color as string;

  } else if (slug === 'webcam') {
    if (raw.fov != null)        s['FOV']        = `${raw.fov}°`;
    if (raw.focus_type)         s['Focus']      = raw.focus_type as string;
    if (raw.connection)         s['Connection'] = raw.connection as string;

  } else if (slug === 'fan-controller') {
    if (raw.channels != null)        s['Channels']         = raw.channels as number;
    if (raw.channel_wattage != null) s['Per-Channel Power'] = `${raw.channel_wattage}W`;
    if (raw.pwm != null)             s['PWM']              = raw.pwm ? 'Yes' : 'No';
    if (raw.form_factor)             s['Form Factor']      = raw.form_factor as string;
    if (raw.color)                   s['Color']            = raw.color as string;

  } else if (slug === 'os') {
    if (raw.mode != null) {
      const mode = raw.mode;
      s['Bit Mode'] = Array.isArray(mode) ? mode.join('/') + '-bit' : `${mode}-bit`;
    }
    if (raw.max_memory != null) s['Max RAM'] = `${raw.max_memory} GB`;
  }

  return s;
}

// ── Cache + fetch ───────────────────────────────────────────────────────────

const _cache = new Map<DatasetSlug, { data: DatasetComponent[]; fetchedAt: number }>();

export async function fetchDataset(slug: DatasetSlug): Promise<DatasetComponent[]> {
  const cached = _cache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const url = `${BASE_URL}/${slug}.json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`PC Part Dataset returned HTTP ${res.status} for ${slug}`);

  const raw: Record<string, unknown>[] = await res.json();
  const data = raw
    .filter((r) => typeof r.name === 'string' && r.name.length > 0)
    .map((r) => ({
      name: r.name as string,
      price: typeof r.price === 'number' && r.price > 0 ? r.price : null,
      slug,
      specs: buildSpecs(r, slug),
      filters: extractFilters(r, slug),
    }));

  _cache.set(slug, { data, fetchedAt: Date.now() });
  return data;
}

export interface FilterFieldWithBounds extends FilterField { min: number; max: number }

export async function getFilterSchema(slug: DatasetSlug): Promise<FilterFieldWithBounds[]> {
  const fields = FILTER_SCHEMA[slug];
  if (!fields) return [];
  const all = await fetchDataset(slug);
  return fields.flatMap((f) => {
    const values = all.map((item) => item.filters[f.key]).filter((v): v is number => v !== undefined);
    if (values.length === 0) return [];
    return [{ ...f, min: Math.floor(Math.min(...values)), max: Math.ceil(Math.max(...values)) }];
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface DatasetQueryOptions {
  pricedOnly?: boolean;
  filters?: FilterValues;
  offset?: number;
  limit?: number;
  sortKey?: string;  // 'price' or a filters key (e.g. 'vram'); default 'price'
  sortDir?: 'asc' | 'desc';
}

function sortComponents(items: DatasetComponent[], sortKey = 'price', sortDir: 'asc' | 'desc' = 'asc'): DatasetComponent[] {
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = sortKey === 'price' ? a.price : a.filters[sortKey];
    const bv = sortKey === 'price' ? b.price : b.filters[sortKey];
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
}

export async function searchDataset(
  query: string,
  slug: DatasetSlug,
  opts: DatasetQueryOptions = {},
): Promise<{ results: DatasetComponent[]; total: number }> {
  const { pricedOnly = false, filters = {}, offset = 0, limit = 25, sortKey, sortDir } = opts;
  const all = await fetchDataset(slug);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const matches = all.filter((p) => {
    if (pricedOnly && p.price === null) return false;
    if (!matchesFilters(p, filters)) return false;
    const haystack = [p.name, ...Object.values(p.specs).map(String)].join(' ').toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });

  const sorted = sortComponents(matches, sortKey, sortDir);
  return { results: sorted.slice(offset, offset + limit), total: matches.length };
}

export async function browseDataset(
  slug: DatasetSlug,
  opts: DatasetQueryOptions = {},
): Promise<{ results: DatasetComponent[]; total: number; totalPriced: number; totalMatching: number }> {
  const { pricedOnly = false, filters = {}, offset = 0, limit = 20, sortKey, sortDir } = opts;
  const all = await fetchDataset(slug);
  const totalPriced = all.filter((p) => p.price !== null).length;
  const matching = all.filter((p) => (!pricedOnly || p.price !== null) && matchesFilters(p, filters));
  const sorted = sortComponents(matching, sortKey, sortDir);
  return {
    results: sorted.slice(offset, offset + limit),
    total: all.length,
    totalPriced,
    totalMatching: matching.length,
  };
}

export function formatDatasetComponent(c: DatasetComponent, idx?: number): string {
  const prefix = idx != null ? `### ${idx + 1}. ` : '### ';
  const price = c.price != null ? `$${c.price.toFixed(2)} USD (PCPartPicker reference)` : 'No reference price';
  const specLines = Object.entries(c.specs).map(([k, v]) => `  - **${k}**: ${v}`).join('\n');
  return `${prefix}${c.name}\n**Price**: ${price}\n${specLines || '  *(no spec data)*'}`;
}
