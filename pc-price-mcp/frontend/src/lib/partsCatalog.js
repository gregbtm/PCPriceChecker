export const CATEGORY_GROUPS = [
  { label: 'Core', slugs: ['cpu', 'cpu-cooler', 'motherboard', 'memory'] },
  { label: 'Storage', slugs: ['internal-hard-drive', 'external-hard-drive', 'optical-drive'] },
  { label: 'Graphics & Display', slugs: ['video-card', 'monitor'] },
  { label: 'Power & Case', slugs: ['power-supply', 'case', 'case-fan', 'fan-controller', 'case-accessory', 'thermal-paste'] },
  { label: 'Connectivity', slugs: ['wired-network-card', 'wireless-network-card', 'sound-card'] },
  { label: 'Peripherals', slugs: ['keyboard', 'mouse', 'headphones', 'speakers', 'webcam', 'ups', 'os'] },
]

export const CATEGORY_LABELS = {
  cpu: 'CPU', 'cpu-cooler': 'CPU Cooler', motherboard: 'Motherboard', memory: 'Memory',
  'internal-hard-drive': 'Internal Storage', 'external-hard-drive': 'External Storage', 'optical-drive': 'Optical Drive',
  'video-card': 'Graphics Card', monitor: 'Monitor',
  'power-supply': 'Power Supply', case: 'Case', 'case-fan': 'Case Fan', 'fan-controller': 'Fan Controller',
  'case-accessory': 'Case Accessory', 'thermal-paste': 'Thermal Paste',
  'wired-network-card': 'Wired NIC', 'wireless-network-card': 'Wireless NIC', 'sound-card': 'Sound Card',
  keyboard: 'Keyboard', mouse: 'Mouse', headphones: 'Headphones', speakers: 'Speakers',
  webcam: 'Webcam', ups: 'UPS', os: 'OS',
}

// Which spec keys (from the backend's per-category `specs` object) get their
// own table column, in order. Categories not listed here fall back to
// showing the first few spec entries as inline chips.
export const COLUMN_SCHEMA = {
  cpu: ['Cores', 'Base Clock', 'Boost Clock', 'TDP'],
  'video-card': ['Chipset', 'VRAM', 'Boost Clock', 'Length'],
  motherboard: ['Socket', 'Form Factor', 'Max RAM'],
  memory: ['Speed', 'Kit', 'CAS Latency'],
  'internal-hard-drive': ['Capacity', 'Type', 'Interface'],
  'power-supply': ['Wattage', 'Efficiency', 'Modular'],
  case: ['Form Factor', 'Volume', 'Side Panel'],
  monitor: ['Size', 'Resolution', 'Refresh Rate', 'Panel'],
  'cpu-cooler': ['Radiator', 'Fan RPM', 'Noise'],
}

// Which displayed columns can be sorted server-side, and the raw filter key
// (from FILTER_SCHEMA on the backend) each one sorts by.
export const COLUMN_TO_FILTER_KEY = {
  cpu: { Cores: 'cores', TDP: 'tdp' },
  'video-card': { VRAM: 'vram', Length: 'length' },
  motherboard: { 'Max RAM': 'max_memory' },
  memory: { Speed: 'speed', Kit: 'capacity' },
  'internal-hard-drive': { Capacity: 'capacity' },
  'power-supply': { Wattage: 'wattage' },
  case: { Volume: 'volume' },
  monitor: { Size: 'screen_size', 'Refresh Rate': 'refresh_rate' },
  'cpu-cooler': { Radiator: 'radiator_size' },
}

// Maps a dataset slug to the tracked-component "category" value used by
// /api/components, for the Track / Add-to-Build actions. Unmapped slugs
// (mostly peripherals) fall back to 'other' at the call site.
export const SLUG_TO_COMPONENT_CATEGORY = {
  'video-card': 'gpu', cpu: 'cpu', memory: 'ram', motherboard: 'motherboard',
  'internal-hard-drive': 'storage', 'power-supply': 'psu', case: 'case',
  'cpu-cooler': 'cooling', monitor: 'monitor',
}

export function categoryLabel(slug) {
  return CATEGORY_LABELS[slug] ?? slug.replace(/-/g, ' ')
}
