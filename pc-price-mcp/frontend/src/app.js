import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler } from 'chart.js';
import { fmtDate } from './lib/format.js';
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

const CURRENCY_SYMS = { GBP: '£', USD: '$', EUR: '€' };
const CHART_TICK_COLOR = '#a6adbb';
const CHART_GRID_COLOR = 'rgba(166,173,187,0.12)';

const RETAILER_LABELS = {
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
const retailerList = (ids) => ids.map(id => ({ id, label: RETAILER_LABELS[id] }));

function app() {
  return {
    activeTab: 'dashboard',

    // ── State ──────────────────────────────────────────────────────────────
    components: [],
    alerts: [],
    priceDrops: [],
    stockChanges: [],
    schedulerStatus: null,
    builds: [],
    selectedBuild: null,
    selectedBuildDetail: null,
    vatMode: 'inc_vat',

    // Help modal
    helpOpen: false,
    helpActiveTab: 'start',
    helpTabs: [
      { id: 'start',      icon: '🚀', label: 'Getting Started' },
      { id: 'dashboard',  icon: '📊', label: 'Dashboard' },
      { id: 'search',     icon: '🔍', label: 'Search' },
      { id: 'builds',     icon: '🖥️', label: 'Builds' },
      { id: 'advisor',    icon: '🧠', label: 'Advisor' },
      { id: 'parts',      icon: '🗂️', label: 'Parts DB' },
      { id: 'prebuilts',  icon: '💻', label: 'Pre-Built PCs' },
      { id: 'settings',   icon: '⚙️', label: 'Settings' },
      { id: 'tips',       icon: '💡', label: 'Tips & Tricks' },
    ],

    // Advisor
    advisorSubTab: 'budget',
    budgetAmount: 1000,
    budgetUseCase: 'gaming_1440p',
    budgetResult: null,
    budgetLoading: false,
    upgradeCpu: '',
    upgradeGpu: '',
    upgradeBudget: 500,
    upgradeUseCase: 'gaming_1440p',
    upgradeResult: null,
    upgradeLoading: false,
    bvbCpu: '',
    bvbGpu: '',
    bvbRam: null,
    bvbStorage: null,
    bvbResult: null,
    bvbLoading: false,
    compatComponents: { cpu: '', motherboard: '', ram: '', gpu: '', psu: '', case: '', cooler: '' },
    compatResult: null,
    compatLoading: false,
    benchmarkA: '',
    benchmarkB: '',
    benchmarkType: 'auto',
    benchmarkCompareResult: null,
    benchmarkLoading: false,
    dealScores: null,
    dealScoresLoading: false,
    valueType: 'gpu',
    valueBudgetMin: 0,
    valueBudgetMax: 500,
    valueResult: null,
    valueLoading: false,

    // Search
    searchQuery: '',
    lastSearchQuery: '',
    searchSource: 'retailers',
    selectedRetailers: ['scan', 'overclockers', 'ebuyer', 'ccl', 'box', 'novatech', 'aria', 'awdit', 'currys', 'argos', 'johnlewis'],
    allRetailers: retailerList([
      'currys', 'argos', 'johnlewis', 'scan', 'overclockers', 'ebuyer', 'ccl',
      'box', 'novatech', 'aria', 'awdit', 'corsair', 'nzxt', 'coolermaster',
      'lianli', 'fractal', 'thermaltake',
    ]),
    searchResults: null,
    searchLoading: false,

    // Modals
    showAddComponent: false,
    addForm: { name: '', search_query: '', category: 'other', alert_price: '' },

    showAlertModal: false,
    alertComponent: null,
    alertPrice: '',

    showHistoryModal: false,
    historyComponent: null,
    historyData: null,
    historyStats: null,
    historyDays: 30,
    historyChart: null,

    showCreateBuild: false,
    newBuildName: '',
    newBuildDesc: '',

    showAddToBuild: false,
    addToBuildCid: '',
    addToBuildQty: 1,

    // Search extras
    cexInStockOnly: false,

    // Settings
    notifDiscord: '',
    notifSlack: '',
    notifTelegram: '',
    notifTelegramChat: '',
    notifResend: '',
    notifEmail: '',
    notifNtfyTopic: '',
    notifNtfyServer: '',
    notifPushoverToken: '',
    notifPushoverUser: '',
    notifDropPct: '5',
    showSecrets: { discord: false, slack: false, telegram: false, resend: false,
                   pushoverToken: false, pushoverUser: false,
                   pricesapi: false, ebayId: false, ebaySec: false, keepa: false,
                   amzAccess: false, amzSecret: false, amzTag: false,
                   awinId: false, awinKey: false,
                   redditId: false, redditSec: false,
                   youtube: false, bing: false, anthropic: false,
                   openai: false, apify: false },

    // API keys
    apiKeyPricesApi: '',
    apiKeyEbayId: '', apiKeyEbaySec: '',
    apiKeyKeepa: '',
    apiKeyAmzAccess: '', apiKeyAmzSecret: '', apiKeyAmzTag: '',
    apiKeyAwinId: '', apiKeyAwinKey: '',
    apiKeyRedditId: '', apiKeyRedditSec: '',
    apiKeyYoutube: '',
    apiKeyBing: '',
    apiKeyAnthropic: '',
    apiKeyOpenAI: '',
    apiKeyApify: '',
    apiKeyStatus: {},

    // Sparklines (keyed by component id)
    sparklines: {},

    // Scraper settings
    scraperCamofoxUrl: '',
    scraperProxies: '',

    // Tags
    tags: [],
    activeTagFilter: null,

    // Needs attention
    needsAttention: [],

    // Component URLs modal
    showUrlsModal: false,
    urlsModalComponent: null,
    urlsModalList: [],
    urlsModalNew: { url: '', retailer: '', label: '' },

    // Component interval/unit modal
    showIntervalModal: false,
    intervalModalComponent: null,
    intervalModalMinutes: '',
    intervalModalUnitQty: '',
    intervalModalUnitType: '',

    // Gotify / Apprise notification fields
    notifGotifyUrl: '',
    notifGotifyToken: '',
    notifAppriseUrl: '',

    // Setup wizard
    wizardStep: 0,
    wizardSaving: {},
    wizardSaved: {},

    // Parts DB
    partsAllSlugs: [],
    partsCategory: 'video-card',
    partsQuery: '',
    partsPricedOnly: false,
    partsLoading: false,
    partsResults: null,

    // Pre-built PCs
    prebuilts: [],
    allPrebuiltRetailers: retailerList([
      'currys', 'argos', 'johnlewis', 'ao', 'very', 'ebuyer', 'scan',
      'overclockers', 'box', 'novatech', 'ccl', 'chillblast', 'dell', 'hp',
      'amazon', 'pallicomp', 'costco', 'cyberpower', 'pcspecialist', 'lenovo',
      'bedrock',
    ]),
    selectedPrebuiltRetailers: [],
    prebuiltSearchQuery: '',
    prebuiltSearchResults: null,
    prebuiltSearchLoading: false,
    showAddPrebuilt: false,
    addPrebuiltForm: { name: '', search_query: '', category: 'gaming', brand: '', cpu: '', gpu: '', ram: '', storage: '', os: '', alert_price: '' },
    showPrebuiltAlertModal: false,
    prebuiltAlertSystem: null,
    prebuiltAlertPrice: '',
    showPrebuiltHistory: false,
    prebuiltHistorySystem: null,
    prebuiltHistoryData: null,
    prebuiltHistoryStats: null,
    prebuiltHistoryDays: 30,
    prebuiltHistoryChart: null,

    // PCPartPicker search
    pcppCategory: 'gpu',
    pcppCategories: ['gpu', 'cpu', 'ram', 'motherboard', 'storage', 'psu', 'case', 'cooling', 'monitor'],

    // UI state
    refreshingAll: false,
    toast: null,
    _toastTimer: null,
    _schedulerTimer: null,

    // ── Computed ───────────────────────────────────────────────────────────
    get configStatus() {
      return {
        discord:  !!this.notifDiscord,
        slack:    !!this.notifSlack,
        telegram: !!(this.notifTelegram && this.notifTelegramChat),
        email:    !!(this.notifResend && this.notifEmail),
        ntfy:     !!this.notifNtfyTopic,
        pushover: !!(this.notifPushoverToken && this.notifPushoverUser),
        gotify:   !!(this.notifGotifyUrl && this.notifGotifyToken),
        apprise:  !!this.notifAppriseUrl,
      };
    },

    // ── Helpers ────────────────────────────────────────────────────────────
    closeMobileDrawer() {
      const toggle = document.getElementById('app-drawer');
      if (toggle) toggle.checked = false;
    },

    async loadFrom(url, prop, silent = false) {
      try {
        const r = await fetch(url);
        this[prop] = await r.json();
      } catch (e) { if (!silent) throw e; }
    },

    // ── Init ───────────────────────────────────────────────────────────────
    async init() {
      clearInterval(this._schedulerTimer);
      this.selectedPrebuiltRetailers = this.allPrebuiltRetailers.map(r => r.id);
      await Promise.all([
        this.loadComponents(),
        this.loadSchedulerStatus(),
        this.loadAlerts(),
        this.loadPriceDrops(),
        this.loadStockChanges(),
        this.loadBuilds(),
        this.loadConfig(),
        this.loadPrebuilts(),
        this.loadPartsSlugs(),
        this.loadSparklines(),
        this.loadTags(),
        this.loadNeedsAttention(),
      ]);
      this._schedulerTimer = setInterval(() => this.loadSchedulerStatus(), 30_000);
      window.addEventListener('pc:vat-changed', e => { this.vatMode = e.detail; });
      window.addEventListener('pc:components-changed', () => Promise.all([this.loadComponents(), this.loadTags()]));
      window.addEventListener('pc:config-changed', e => { if (e.detail?.source !== 'alpine') this.loadConfig(); });
    },

    // ── Data loaders ───────────────────────────────────────────────────────
    async loadComponents()     { await this.loadFrom('/api/components',              'components'); },
    async loadSchedulerStatus(){ await this.loadFrom('/api/scheduler',               'schedulerStatus'); },
    async loadAlerts()         { await this.loadFrom('/api/alerts',                  'alerts'); },
    async loadPriceDrops()     { await this.loadFrom('/api/price-drops?min_percent=2','priceDrops'); },
    async loadStockChanges()   { await this.loadFrom('/api/stock-changes?hours=24',  'stockChanges'); },
    async loadBuilds()         { await this.loadFrom('/api/builds',                  'builds'); },
    async loadPrebuilts()      { await this.loadFrom('/api/prebuilts',               'prebuilts'); },
    async loadSparklines()     { await this.loadFrom('/api/dashboard/sparklines',    'sparklines', true); },
    async loadTags()           { await this.loadFrom('/api/tags',                    'tags',       true); },
    async loadNeedsAttention() { await this.loadFrom('/api/needs-attention',         'needsAttention', true); },

    async loadConfig() {
      const r = await fetch('/api/config');
      const cfg = await r.json();
      this.vatMode = cfg.vat_mode ?? 'inc_vat';
      this.notifDropPct = cfg.notify_drop_percent ?? '5';
      this.notifDiscord        = cfg.discord_webhook_url  ?? '';
      this.notifSlack          = cfg.slack_webhook_url    ?? '';
      this.notifTelegram       = cfg.telegram_bot_token   ?? '';
      this.notifTelegramChat   = cfg.telegram_chat_id     ?? '';
      this.notifResend         = cfg.resend_api_key       ?? '';
      this.notifEmail          = cfg.alert_email          ?? '';
      this.notifNtfyTopic      = cfg.ntfy_topic           ?? '';
      this.notifNtfyServer     = cfg.ntfy_server          ?? '';
      this.notifPushoverToken  = cfg.pushover_app_token   ?? '';
      this.notifPushoverUser   = cfg.pushover_user_key    ?? '';
      this.notifGotifyUrl   = cfg.gotify_server_url ?? '';
      this.notifGotifyToken = cfg.gotify_app_token  ?? '';
      this.notifAppriseUrl  = cfg.apprise_url        ?? '';
      // API keys
      this.apiKeyPricesApi  = cfg.prices_api_key       ?? '';
      this.apiKeyEbayId     = cfg.ebay_client_id        ?? '';
      this.apiKeyEbaySec    = cfg.ebay_client_secret    ?? '';
      this.apiKeyKeepa      = cfg.keepa_api_key         ?? '';
      this.apiKeyAmzAccess  = cfg.amazon_access_key     ?? '';
      this.apiKeyAmzSecret  = cfg.amazon_secret_key     ?? '';
      this.apiKeyAmzTag     = cfg.amazon_associate_tag  ?? '';
      this.apiKeyAwinId     = cfg.awin_publisher_id     ?? '';
      this.apiKeyAwinKey    = cfg.awin_api_key          ?? '';
      this.apiKeyRedditId   = cfg.reddit_client_id      ?? '';
      this.apiKeyRedditSec  = cfg.reddit_client_secret  ?? '';
      this.apiKeyYoutube    = cfg.youtube_api_key       ?? '';
      this.apiKeyBing       = cfg.bing_api_key          ?? '';
      this.apiKeyAnthropic  = cfg.anthropic_api_key     ?? '';
      this.apiKeyOpenAI     = cfg.openai_api_key        ?? '';
      this.apiKeyApify      = cfg.apify_api_token       ?? '';
      this.apiKeyStatus = {
        pricesapi: !!cfg.prices_api_key,
        ebay:      !!(cfg.ebay_client_id && cfg.ebay_client_secret),
        keepa:     !!cfg.keepa_api_key,
        amazon:    !!(cfg.amazon_access_key && cfg.amazon_secret_key && cfg.amazon_associate_tag),
        awin:      !!(cfg.awin_publisher_id && cfg.awin_api_key),
        reddit:    !!(cfg.reddit_client_id && cfg.reddit_client_secret),
        youtube:   !!cfg.youtube_api_key,
        bing:      !!cfg.bing_api_key,
        anthropic: !!cfg.anthropic_api_key,
        openai:    !!cfg.openai_api_key,
        apify:     !!cfg.apify_api_token,
      };
      // Scraper settings
      this.scraperCamofoxUrl = cfg.camofox_url     ?? '';
      this.scraperProxies    = cfg.scrape_proxies  ?? '';
    },

    // ── Tag management ──────────────────────────────────────────────────────
    filteredComponents() {
      if (!this.activeTagFilter) return this.components;
      return this.components.filter(c => c._tags && c._tags.some(t => t.id === this.activeTagFilter));
    },

    async createTag() {
      const name = prompt('Tag name (e.g. "Gaming", "Work"):');
      if (!name) return;
      const color = prompt('Tag colour (hex, e.g. #6366f1):', '#6366f1') || '#6366f1';
      await fetch('/api/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      await this.loadTags();
      this.showToast(`✅ Tag "${name}" created`);
    },

    async deleteTag(tag) {
      if (!confirm(`Delete tag "${tag.name}"? It will be removed from all components.`)) return;
      await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
      if (this.activeTagFilter === tag.id) this.activeTagFilter = null;
      await this.loadTags();
      this.showToast(`🗑️ Tag "${tag.name}" deleted`);
    },

    // ── Component pause/resume ──────────────────────────────────────────────
    async togglePause(c) {
      const action = c.paused ? 'resume' : 'pause';
      await fetch(`/api/components/${c.id}/${action}`, { method: 'POST' });
      await this.loadComponents();
      this.showToast(c.paused ? `▶️ Resumed "${c.name}"` : `⏸️ Paused "${c.name}"`);
    },

    // ── Component interval / unit modal ────────────────────────────────────
    openIntervalModal(c) {
      this.intervalModalComponent = c;
      this.intervalModalMinutes = c.check_interval_minutes ?? '';
      this.intervalModalUnitQty = c.unit_quantity ?? '';
      this.intervalModalUnitType = c.unit_type ?? '';
      this.showIntervalModal = true;
    },
    async saveIntervalModal() {
      const c = this.intervalModalComponent;
      if (!c) return;
      const mins = this.intervalModalMinutes !== '' ? Number(this.intervalModalMinutes) : null;
      const qty  = this.intervalModalUnitQty  !== '' ? Number(this.intervalModalUnitQty)  : null;
      const type = this.intervalModalUnitType || null;
      await Promise.all([
        fetch(`/api/components/${c.id}/interval`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: mins }),
        }),
        fetch(`/api/components/${c.id}/unit`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: qty, unit_type: type }),
        }),
      ]);
      this.showIntervalModal = false;
      await this.loadComponents();
      this.showToast('✅ Component settings saved');
    },

    // ── Component URLs modal ────────────────────────────────────────────────
    async openUrlsModal(c) {
      this.urlsModalComponent = c;
      this.urlsModalNew = { url: '', retailer: '', label: '' };
      const r = await fetch(`/api/components/${c.id}/urls`);
      this.urlsModalList = await r.json();
      this.showUrlsModal = true;
    },
    async addComponentUrl() {
      if (!this.urlsModalNew.url) return;
      const r = await fetch(`/api/components/${this.urlsModalComponent.id}/urls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.urlsModalNew),
      });
      const created = await r.json();
      this.urlsModalList = [...this.urlsModalList, created];
      this.urlsModalNew = { url: '', retailer: '', label: '' };
      this.showToast('✅ URL added');
    },
    async removeComponentUrl(urlRecord) {
      await fetch(`/api/component-urls/${urlRecord.id}`, { method: 'DELETE' });
      this.urlsModalList = this.urlsModalList.filter(u => u.id !== urlRecord.id);
      this.showToast('🗑️ URL removed');
    },

    makeSvgSparkline(points) {
      if (!points || points.length < 2) return '';
      const prices = points.map(p => p.min_price);
      const min = prices.reduce((a, v) => v < a ? v : a, Infinity);
      const max = prices.reduce((a, v) => v > a ? v : a, -Infinity);
      const range = max - min || 1;
      const W = 72, H = 26;
      const coords = prices.map((p, i) => {
        const x = ((i / (prices.length - 1)) * W).toFixed(1);
        const y = (H - ((p - min) / range) * H * 0.8 - H * 0.1).toFixed(1);
        return `${x},${y}`;
      }).join(' ');
      const last = prices[prices.length - 1];
      const color = last < prices[0] ? '#34d399' : last > prices[0] ? '#f87171' : '#60a5fa';
      return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    },

    // ── Formatting ─────────────────────────────────────────────────────────
    fmtPrice(amount, currency = 'GBP') {
      if (amount == null) return '—';
      const sym = CURRENCY_SYMS[currency] ?? (currency + ' ');
      const v = this.vatMode === 'ex_vat' ? amount / 1.2 : amount;
      return sym + v.toFixed(2);
    },
    bestOfferPrice(offers) {
      const prices = offers.filter(o => o.inStock && o.price > 0).map(o => o.price);
      return prices.length > 0 ? prices.reduce((a, v) => v < a ? v : a, Infinity) : null;
    },
    isBestOffer(offer, offers) {
      const best = this.bestOfferPrice(offers);
      return best !== null && offer.inStock && offer.price === best;
    },
    fmtPriceRaw(amount, currency = 'GBP') {
      if (amount == null) return '—';
      return (CURRENCY_SYMS[currency] ?? (currency + ' ')) + Number(amount).toFixed(2);
    },
    fmtDate,
    showToast(message, type = 'success') {
      clearTimeout(this._toastTimer);
      this.toast = { message, type };
      this._toastTimer = setTimeout(() => this.toast = null, 3500);
    },

    // ── Components ─────────────────────────────────────────────────────────
    openAddComponent() {
      this.addForm = { name: '', search_query: '', category: 'other', alert_price: '' };
      this.showAddComponent = true;
    },
    prefillAdd(name, _retailer) {
      this.addForm = { name, search_query: name, category: 'other', alert_price: '' };
      this.showAddComponent = true;
    },
    async submitAddComponent() {
      if (!this.addForm.name || !this.addForm.search_query) {
        this.showToast('Name and search query are required', 'error');
        return;
      }
      const body = { ...this.addForm };
      if (!body.alert_price) delete body.alert_price;
      const r = await fetch('/api/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        this.showAddComponent = false;
        this.showToast(`✅ ${this.addForm.name} added to watchlist`);
        await this.loadComponents();
      } else {
        const e = await r.json();
        this.showToast(e.error ?? 'Error adding component', 'error');
      }
    },

    async _refreshOne(c) {
      this.components = this.components.map(x => x.id === c.id ? { ...x, _refreshing: true } : x);
      try {
        const r = await fetch(`/api/components/${c.id}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        return await r.json();
      } finally {
        this.components = this.components.map(x => x.id === c.id ? { ...x, _refreshing: false } : x);
      }
    },

    async refreshComponent(c) {
      try {
        const data = await this._refreshOne(c);
        this.showToast(`✅ ${c.name}: ${data.saved} offers saved`);
        await Promise.all([this.loadComponents(), this.loadPriceDrops(), this.loadAlerts()]);
      } catch (e) {
        this.showToast('❌ Network error', 'error');
      }
    },
    async refreshAll() {
      this.refreshingAll = true;
      await Promise.all(this.components.map(c => this._refreshOne(c).catch(() => {})));
      this.refreshingAll = false;
      await Promise.all([this.loadComponents(), this.loadPriceDrops(), this.loadAlerts(), this.loadStockChanges(), this.loadSparklines(), this.loadNeedsAttention()]);
      this.showToast('✅ All components refreshed');
    },
    async removeComponent(c) {
      if (!confirm(`Remove "${c.name}" and all its price history?`)) return;
      await fetch(`/api/components/${c.id}`, { method: 'DELETE' });
      this.showToast(`🗑️ ${c.name} removed`);
      await this.loadComponents();
    },
    openEditAlert(c) {
      this.alertComponent = c;
      this.alertPrice = c.alert_price ?? '';
      this.showAlertModal = true;
    },
    async _setAlert(price) {
      await fetch(`/api/components/${this.alertComponent.id}/alert`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_price: price }),
      });
      this.showAlertModal = false;
      this.showToast(price == null ? '🔕 Alert removed' : '🔔 Alert saved');
      await this.loadComponents();
    },
    async saveAlert()  { await this._setAlert(isNaN(parseFloat(this.alertPrice)) ? null : parseFloat(this.alertPrice)); },
    async clearAlert() { await this._setAlert(null); },

    // ── History chart ──────────────────────────────────────────────────────
    async openHistory(c) {
      this.historyComponent = c;
      this.historyDays = 30;
      this.historyData = null;
      this.historyStats = null;
      this.showHistoryModal = true;
      await this.loadHistory(30);
    },
    async loadHistory(days) {
      this.historyDays = days;
      const [hr, sr] = await Promise.all([
        fetch(`/api/components/${this.historyComponent.id}/history?days=${days}`),
        fetch(`/api/components/${this.historyComponent.id}/stats`),
      ]);
      this.historyData = await hr.json();
      this.historyStats = await sr.json();
      this.$nextTick(() => this.renderChart());
    },
    renderChart() {
      if (this.historyChart) { this.historyChart.destroy(); this.historyChart = null; }
      const canvas = document.getElementById('historyChart');
      if (!canvas || !this.historyData?.trend?.length) return;
      this.historyChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: this.historyData.trend.map(r => r.date),
          datasets: [
            {
              label: 'Min Price',
              data: this.historyData.trend.map(r => r.min_price),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59,130,246,0.08)',
              fill: true, tension: 0.35, pointRadius: 3,
            },
            {
              label: 'Avg Price',
              data: this.historyData.trend.map(r => r.avg_price),
              borderColor: 'rgba(166,173,187,0.5)',
              borderDash: [5, 5],
              fill: false, tension: 0.35, pointRadius: 2,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: CHART_TICK_COLOR, boxWidth: 12, font: { size: 11 } } },
          },
          scales: {
            x: { ticks: { color: CHART_TICK_COLOR, maxTicksLimit: 8 }, grid: { color: CHART_GRID_COLOR } },
            y: {
              ticks: { color: CHART_TICK_COLOR, callback: v => '£' + Number(v).toFixed(0) },
              grid: { color: CHART_GRID_COLOR },
            },
          },
        },
      });
    },
    closeHistory() {
      this.showHistoryModal = false;
      if (this.historyChart) { this.historyChart.destroy(); this.historyChart = null; }
    },

    // ── Search ─────────────────────────────────────────────────────────────
    async doSearch() {
      if (!this.searchQuery || this.searchLoading) return;
      this.searchLoading = true;
      this.searchResults = null;
      this.lastSearchQuery = this.searchQuery;
      try {
        if (this.searchSource === 'retailers') {
          const p = new URLSearchParams({ q: this.searchQuery, retailers: this.selectedRetailers.join(',') });
          const r = await fetch(`/api/search/retailers?${p}`);
          this.searchResults = await r.json();
        } else if (this.searchSource === 'cex') {
          const p = new URLSearchParams({ q: this.searchQuery, limit: '25' });
          if (this.cexInStockOnly) p.set('in_stock', '1');
          const r = await fetch(`/api/cex/search?${p}`);
          this.searchResults = await r.json();
        } else if (this.searchSource === 'pcpartpicker') {
          const p = new URLSearchParams({ category: this.pcppCategory, limit: '30' });
          if (this.searchQuery) p.set('q', this.searchQuery);
          const r = await fetch(`/api/pcpartpicker/search?${p}`);
          this.searchResults = await r.json();
        } else {
          const p = new URLSearchParams({ q: this.searchQuery, country: 'gb' });
          const r = await fetch(`/api/search/api?${p}`);
          this.searchResults = await r.json();
        }
      } catch (e) {
        this.showToast('❌ Search failed: ' + e.message, 'error');
      } finally {
        this.searchLoading = false;
      }
    },

    // ── Builds ─────────────────────────────────────────────────────────────
    async selectBuild(b) {
      this.selectedBuild = b;
      const r = await fetch(`/api/builds/${b.id}`);
      this.selectedBuildDetail = await r.json();
    },
    openCreateBuild() { this.newBuildName = ''; this.newBuildDesc = ''; this.showCreateBuild = true; },
    async submitCreateBuild() {
      if (!this.newBuildName) return;
      const r = await fetch('/api/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.newBuildName, description: this.newBuildDesc }),
      });
      const b = await r.json();
      this.showCreateBuild = false;
      this.showToast(`✅ Build "${b.name}" created`);
      await this.loadBuilds();
      await this.selectBuild(b);
    },
    async deleteBuild(b) {
      if (!confirm(`Delete build "${b.name}"? The tracked components will remain in your watchlist.`)) return;
      await fetch(`/api/builds/${b.id}`, { method: 'DELETE' });
      if (this.selectedBuild?.id === b.id) { this.selectedBuild = null; this.selectedBuildDetail = null; }
      this.showToast(`🗑️ Build "${b.name}" deleted`);
      await this.loadBuilds();
    },
    openAddToBuild() { this.addToBuildCid = ''; this.addToBuildQty = 1; this.showAddToBuild = true; },
    async submitAddToBuild() {
      if (!this.addToBuildCid || !this.selectedBuild) return;
      await fetch(`/api/builds/${this.selectedBuild.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component_id: parseInt(this.addToBuildCid), quantity: parseInt(this.addToBuildQty) }),
      });
      this.showAddToBuild = false;
      await Promise.all([this.selectBuild(this.selectedBuild), this.loadBuilds()]);
      this.showToast('✅ Component added to build');
    },
    async removeFromBuild(item) {
      await fetch(`/api/builds/${this.selectedBuild.id}/items/${item.component_id}`, { method: 'DELETE' });
      await Promise.all([this.selectBuild(this.selectedBuild), this.loadBuilds()]);
      this.showToast('🗑️ Component removed from build');
    },

    // ── Settings ───────────────────────────────────────────────────────────
    closeWizard() {
      document.getElementById('setup-wizard-modal').close();
    },
    async wizardSaveField(configKey, value) {
      this.wizardSaving = { ...this.wizardSaving, [configKey]: true };
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: configKey, value }),
        });
        this.wizardSaving = { ...this.wizardSaving, [configKey]: false };
        this.wizardSaved  = { ...this.wizardSaved,  [configKey]: true };
        setTimeout(() => { this.wizardSaved = { ...this.wizardSaved, [configKey]: false }; }, 2000);
        await this.loadConfig();
        window.dispatchEvent(new CustomEvent('pc:config-changed', { detail: { source: 'alpine' } }));
      } catch {
        this.wizardSaving = { ...this.wizardSaving, [configKey]: false };
      }
    },
    async testNotification() {
      const r = await fetch('/api/notifications/test', { method: 'POST' });
      const d = await r.json();
      const parts = [];
      if (d.discord  !== undefined) parts.push('Discord '  + (d.discord  ? '✅' : '❌'));
      if (d.slack    !== undefined) parts.push('Slack '    + (d.slack    ? '✅' : '❌'));
      if (d.telegram !== undefined) parts.push('Telegram ' + (d.telegram ? '✅' : '❌'));
      if (d.email    !== undefined) parts.push('Email '    + (d.email    ? '✅' : '❌'));
      if (d.ntfy     !== undefined) parts.push('ntfy '     + (d.ntfy     ? '✅' : '❌'));
      if (d.pushover !== undefined) parts.push('Pushover ' + (d.pushover ? '✅' : '❌'));
      if (d.gotify   !== undefined) parts.push('Gotify '   + (d.gotify   ? '✅' : '❌'));
      if (d.apprise  !== undefined) parts.push('Apprise '  + (d.apprise  ? '✅' : '❌'));
      const ok = d.discord || d.slack || d.telegram || d.email || d.ntfy || d.pushover || d.gotify || d.apprise;
      this.showToast(parts.join(' · ') || 'No notifications configured', ok ? 'success' : 'error');
    },
    // ── Pre-built PCs ───────────────────────────────────────────────────────
    async refreshPrebuilt(s) {
      this.showToast('⏳ Refreshing prices across 15 retailers…');
      await fetch(`/api/prebuilts/${s.id}/refresh`, { method: 'POST' });
      await this.loadPrebuilts();
      this.showToast('✅ Prices refreshed');
    },
    async removePrebuilt(s) {
      if (!confirm(`Remove "${s.name}" from tracking? All price history will be deleted.`)) return;
      await fetch(`/api/prebuilts/${s.id}`, { method: 'DELETE' });
      await this.loadPrebuilts();
      this.showToast(`🗑️ "${s.name}" removed`);
    },
    openAddPrebuilt() {
      this.addPrebuiltForm = { name: '', search_query: '', category: 'gaming', brand: '', cpu: '', gpu: '', ram: '', storage: '', os: '', alert_price: '' };
      this.showAddPrebuilt = true;
    },
    async submitAddPrebuilt() {
      const f = this.addPrebuiltForm;
      if (!f.name || !f.search_query) return;
      const body = {
        name: f.name, search_query: f.search_query, category: f.category,
        brand: f.brand || undefined, cpu: f.cpu || undefined, gpu: f.gpu || undefined,
        ram: f.ram || undefined, storage: f.storage || undefined, os: f.os || undefined,
        alert_price: f.alert_price ? parseFloat(f.alert_price) : undefined,
      };
      const r = await fetch('/api/prebuilts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const sys = await r.json();
      this.showAddPrebuilt = false;
      await this.loadPrebuilts();
      this.showToast(`✅ "${sys.name}" added — fetching prices…`);
      await this.refreshPrebuilt(sys);
    },
    async trackPrebuiltResult(p) {
      const body = {
        name: p.name, search_query: this.prebuiltSearchQuery, category: 'gaming',
        brand: p.brand || undefined, cpu: p.cpu || undefined, gpu: p.gpu || undefined,
        ram: p.ram || undefined, storage: p.storage || undefined, os: p.os || undefined,
        form_factor: p.formFactor || undefined,
      };
      const r = await fetch('/api/prebuilts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const sys = await r.json();
      await this.loadPrebuilts();
      this.showToast(`✅ Now tracking "${sys.name}"`);
    },
    async searchPrebuilts() {
      if (!this.prebuiltSearchQuery.trim()) return;
      this.prebuiltSearchLoading = true;
      this.prebuiltSearchResults = null;
      try {
        const params = new URLSearchParams({ q: this.prebuiltSearchQuery, retailers: this.selectedPrebuiltRetailers.join(',') });
        const r = await fetch(`/api/search/prebuilts?${params}`);
        this.prebuiltSearchResults = await r.json();
      } catch (e) { this.showToast('❌ Search failed: ' + e.message, 'error'); }
      finally { this.prebuiltSearchLoading = false; }
    },
    openPrebuiltAlert(s) { this.prebuiltAlertSystem = s; this.prebuiltAlertPrice = s.alert_price ?? ''; this.showPrebuiltAlertModal = true; },
    async savePrebuiltAlert() {
      if (!this.prebuiltAlertSystem) return;
      await fetch(`/api/prebuilts/${this.prebuiltAlertSystem.id}/alert`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_price: this.prebuiltAlertPrice ? parseFloat(this.prebuiltAlertPrice) : null }),
      });
      this.showPrebuiltAlertModal = false;
      await this.loadPrebuilts();
      this.showToast('✅ Alert price updated');
    },
    async openPrebuiltHistory(s) {
      this.prebuiltHistorySystem = s;
      this.prebuiltHistoryDays = 30;
      this.prebuiltHistoryData = null;
      this.prebuiltHistoryStats = null;
      this.showPrebuiltHistory = true;
      await this.loadPrebuiltHistory();
    },
    async loadPrebuiltHistory() {
      if (!this.prebuiltHistorySystem) return;
      const [histR, statsR] = await Promise.all([
        fetch(`/api/prebuilts/${this.prebuiltHistorySystem.id}/history?days=${this.prebuiltHistoryDays}`),
        fetch(`/api/prebuilts/${this.prebuiltHistorySystem.id}/stats`),
      ]);
      this.prebuiltHistoryData = await histR.json();
      this.prebuiltHistoryStats = await statsR.json();
      await this.$nextTick();
      if (this.prebuiltHistoryChart) { this.prebuiltHistoryChart.destroy(); this.prebuiltHistoryChart = null; }
      const canvas = document.getElementById('prebuiltHistoryChart');
      if (canvas && this.prebuiltHistoryData?.trend?.length > 0) {
        this.prebuiltHistoryChart = new Chart(canvas, {
          type: 'line',
          data: {
            labels: this.prebuiltHistoryData.trend.map(t => t.date),
            datasets: [{
              label: 'Min Price',
              data: this.prebuiltHistoryData.trend.map(t => t.min_price),
              borderColor: '#60a5fa', backgroundColor: '#60a5fa22', tension: 0.3, fill: true,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              y: { ticks: { callback: v => '£' + v }, grid: { color: CHART_GRID_COLOR } },
              x: { grid: { color: CHART_GRID_COLOR } },
            },
            plugins: { legend: { display: false } },
          },
        });
      }
    },
    closePrebuiltHistory() {
      this.showPrebuiltHistory = false;
      if (this.prebuiltHistoryChart) { this.prebuiltHistoryChart.destroy(); this.prebuiltHistoryChart = null; }
    },

    // ── Advisor ────────────────────────────────────────────────────────────
    async runBudgetBuilder() {
      this.budgetLoading = true;
      try {
        const r = await fetch(`/api/advisor/budget?budget=${this.budgetAmount}&use_case=${this.budgetUseCase}`);
        this.budgetResult = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.budgetLoading = false; }
    },
    async runUpgradeAdvisor() {
      this.upgradeLoading = true;
      try {
        const r = await fetch('/api/advisor/upgrade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_cpu: this.upgradeCpu, current_gpu: this.upgradeGpu, budget: this.upgradeBudget, use_case: this.upgradeUseCase }),
        });
        this.upgradeResult = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.upgradeLoading = false; }
    },
    async runBuildVsBuy() {
      this.bvbLoading = true;
      try {
        const body = {};
        if (this.bvbCpu) body.cpu = this.bvbCpu;
        if (this.bvbGpu) body.gpu = this.bvbGpu;
        if (this.bvbRam) body.ram_gb = this.bvbRam;
        if (this.bvbStorage) body.storage_gb = this.bvbStorage;
        const r = await fetch('/api/advisor/build-vs-buy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        this.bvbResult = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.bvbLoading = false; }
    },
    async runCompatCheck() {
      this.compatLoading = true;
      try {
        const body = Object.fromEntries(Object.entries(this.compatComponents).filter(([, v]) => v));
        const r = await fetch('/api/advisor/compat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        this.compatResult = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.compatLoading = false; }
    },
    async runBenchmarkCompare() {
      this.benchmarkLoading = true;
      try {
        const p = new URLSearchParams({ a: this.benchmarkA, b: this.benchmarkB, type: this.benchmarkType });
        const r = await fetch(`/api/advisor/benchmark-compare?${p}`);
        this.benchmarkCompareResult = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.benchmarkLoading = false; }
    },
    async loadDealScores() {
      this.dealScoresLoading = true;
      try {
        const r = await fetch('/api/advisor/deals');
        this.dealScores = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.dealScoresLoading = false; }
    },
    async runValueSearch() {
      this.valueLoading = true;
      try {
        const p = new URLSearchParams({ type: this.valueType, budget_min: this.valueBudgetMin, budget_max: this.valueBudgetMax, top_n: '15' });
        const r = await fetch(`/api/advisor/value?${p}`);
        this.valueResult = await r.json();
      } catch (e) { this.showToast('❌ Network error', 'error'); }
      finally { this.valueLoading = false; }
    },
    async quickTrackFromAdvisor(allocation) {
      try {
        const r = await fetch('/api/components', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: allocation.suggestion,
            search_query: allocation.searchQuery ?? allocation.suggestion,
            category: (allocation.category ?? allocation.label ?? 'other').toLowerCase(),
            fetch_now: false,
          }),
        });
        const d = await r.json();
        if (r.ok) {
          this.showToast(`✅ Tracking: ${allocation.suggestion}`);
          await this.loadComponents();
        } else {
          this.showToast('❌ ' + (d.error ?? 'Failed to track'), 'error');
        }
      } catch (e) { this.showToast('❌ Network error', 'error'); }
    },
    quickSearchFromAdvisor(query) {
      this.searchQuery = query;
      this.searchSource = 'retailers';
      this.activeTab = 'search';
      this.$nextTick(() => this.doSearch());
    },

    // ── Parts DB ───────────────────────────────────────────────────────────
    async loadPartsSlugs() {
      try {
        const r = await fetch('/api/dataset/slugs');
        const data = await r.json();
        this.partsAllSlugs = data.slugs ?? [];
        if (this.partsAllSlugs.length > 0 && !this.partsAllSlugs.includes(this.partsCategory)) {
          this.partsCategory = this.partsAllSlugs[0];
        }
      } catch {}
    },
    async loadPartsDb() {
      this.partsLoading = true;
      this.partsResults = null;
      try {
        const p = new URLSearchParams({ part_type: this.partsCategory, limit: '100' });
        if (this.partsPricedOnly) p.set('priced_only', '1');
        let endpoint = '/api/dataset/browse';
        if (this.partsQuery) { endpoint = '/api/dataset/search'; p.set('q', this.partsQuery); }
        const r = await fetch(`${endpoint}?${p}`);
        const data = await r.json();
        this.partsResults = data.results ?? [];
      } catch (e) {
        this.showToast('❌ Failed to load parts: ' + e.message, 'error');
      } finally {
        this.partsLoading = false;
      }
    },
  };
}

export { app };
