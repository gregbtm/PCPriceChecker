export const RETAILER_LABELS = {
  currys: 'Currys', argos: 'Argos', johnlewis: 'John Lewis',
  scan: 'Scan', overclockers: 'Overclockers', ebuyer: 'Ebuyer', ccl: 'CCL',
  box: 'Box', novatech: 'Novatech', aria: 'Aria PC', awdit: 'AWD-IT',
  corsair: 'Corsair UK', nzxt: 'NZXT UK', coolermaster: 'Cooler Master UK',
  lianli: 'Lian Li', fractal: 'Fractal Design', thermaltake: 'Thermaltake UK',
  ao: 'AO.com', very: 'Very', chillblast: 'Chillblast', dell: 'Dell UK',
  hp: 'HP UK', amazon: 'Amazon', pallicomp: 'Pallicomp', costco: 'Costco UK',
  cyberpower: 'CyberPower PC', pcspecialist: 'PC Specialist', lenovo: 'Lenovo UK',
  bedrock: 'Bedrock Computers',
};

export const retailerList = (ids) => ids.map(id => ({ id, label: RETAILER_LABELS[id] ?? id }));

export const ALL_SEARCH_RETAILER_IDS = [
  'currys', 'argos', 'johnlewis', 'scan', 'overclockers', 'ebuyer', 'ccl',
  'box', 'novatech', 'aria', 'awdit', 'corsair', 'nzxt', 'coolermaster',
  'lianli', 'fractal', 'thermaltake',
];

// Sites known to return usable results without JS rendering — a sane default
// selection rather than pre-checking every retailer, several of which
// (corsair, nzxt, coolermaster, lianli, fractal, thermaltake) reliably fail.
export const DEFAULT_SEARCH_RETAILER_IDS = [
  'scan', 'overclockers', 'ebuyer', 'ccl', 'box', 'novatech', 'aria', 'awdit',
  'currys', 'argos', 'johnlewis',
];
