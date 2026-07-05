import { useState, useEffect, useCallback } from 'react'
import { fmtDate } from '../lib/format.js'
import { post } from '../lib/api.js'
import { useToast, Toast } from '../lib/useToast.jsx'

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function EyeSlashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

function SecretInput({ value, onChange, placeholder, secretKey, showSecrets, setShowSecrets, className = '' }) {
  const visible = !!showSecrets[secretKey]
  return (
    <div className="flex gap-1">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        className={`flex-1 input input-bordered ${className}`}
      />
      <button
        type="button"
        onClick={() => setShowSecrets(s => ({ ...s, [secretKey]: !s[secretKey] }))}
        className="btn btn-ghost btn-xs p-1"
        title={visible ? 'Hide' : 'Show'}
      >
        {visible ? <EyeSlashIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-base-200 rounded-xl border border-base-300">
      <div className="px-4 py-3 border-b border-base-300">
        <h3 className="font-semibold text-base-content">{title}</h3>
        {subtitle && <p className="text-xs text-base-content/50 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  )
}

function StatusDot({ on }) {
  return <div className={`w-2 h-2 rounded-full ${on ? 'bg-success' : 'bg-base-300'}`} />
}

export default function SettingsTab() {
  // Scheduler
  const [schedulerStatus, setSchedulerStatus] = useState(null)
  const [schedulerInterval, setSchedulerInterval] = useState('')

  // Notifications
  const [notifDiscord, setNotifDiscord] = useState('')
  const [notifSlack, setNotifSlack] = useState('')
  const [notifTelegram, setNotifTelegram] = useState('')
  const [notifTelegramChat, setNotifTelegramChat] = useState('')
  const [notifResend, setNotifResend] = useState('')
  const [notifEmail, setNotifEmail] = useState('')
  const [notifNtfyTopic, setNotifNtfyTopic] = useState('')
  const [notifNtfyServer, setNotifNtfyServer] = useState('')
  const [notifPushoverToken, setNotifPushoverToken] = useState('')
  const [notifPushoverUser, setNotifPushoverUser] = useState('')
  const [notifGotifyUrl, setNotifGotifyUrl] = useState('')
  const [notifGotifyToken, setNotifGotifyToken] = useState('')
  const [notifAppriseUrl, setNotifAppriseUrl] = useState('')
  const [notifDropPct, setNotifDropPct] = useState('5')

  // API keys
  const [apiKeyPricesApi, setApiKeyPricesApi] = useState('')
  const [apiKeyEbayId, setApiKeyEbayId] = useState('')
  const [apiKeyEbaySec, setApiKeyEbaySec] = useState('')
  const [apiKeyKeepa, setApiKeyKeepa] = useState('')
  const [apiKeyAmzAccess, setApiKeyAmzAccess] = useState('')
  const [apiKeyAmzSecret, setApiKeyAmzSecret] = useState('')
  const [apiKeyAmzTag, setApiKeyAmzTag] = useState('')
  const [apiKeyAwinId, setApiKeyAwinId] = useState('')
  const [apiKeyAwinKey, setApiKeyAwinKey] = useState('')
  const [apiKeyRedditId, setApiKeyRedditId] = useState('')
  const [apiKeyRedditSec, setApiKeyRedditSec] = useState('')
  const [apiKeyYoutube, setApiKeyYoutube] = useState('')
  const [apiKeyBing, setApiKeyBing] = useState('')
  const [apiKeyAnthropic, setApiKeyAnthropic] = useState('')
  const [apiKeyOpenAI, setApiKeyOpenAI] = useState('')
  const [apiKeyApify, setApiKeyApify] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState({})

  // Scraper
  const [scraperCamofoxUrl, setScraperCamofoxUrl] = useState('')
  const [scraperProxies, setScraperProxies] = useState('')

  // VAT
  const [vatMode, setVatModeState] = useState('inc_vat')

  // Saved searches
  const [savedSearches, setSavedSearches] = useState([])
  const [savedSearchName, setSavedSearchName] = useState('')
  const [savedSearchQuery, setSavedSearchQuery] = useState('')
  const [savedSearchMaxPrice, setSavedSearchMaxPrice] = useState('')

  // Import
  const [importCsv, setImportCsv] = useState('')
  const [importCsvLoading, setImportCsvLoading] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importJsonLoading, setImportJsonLoading] = useState(false)

  // UI
  const [showSecrets, setShowSecrets] = useState({})
  const { toast, showToast } = useToast()

  const configStatus = {
    discord:  !!notifDiscord,
    slack:    !!notifSlack,
    telegram: !!(notifTelegram && notifTelegramChat),
    email:    !!(notifResend && notifEmail),
    ntfy:     !!notifNtfyTopic,
    pushover: !!(notifPushoverToken && notifPushoverUser),
    gotify:   !!(notifGotifyUrl && notifGotifyToken),
    apprise:  !!notifAppriseUrl,
  }

  const loadConfig = useCallback(async () => {
    let cfg
    try {
      const r = await fetch('/api/config')
      cfg = await r.json()
    } catch { return }
    setVatModeState(cfg.vat_mode ?? 'inc_vat')
    setSchedulerInterval(cfg.auto_refresh_interval_minutes ?? '')
    setNotifDropPct(cfg.notify_drop_percent ?? '5')
    setNotifDiscord(cfg.discord_webhook_url ?? '')
    setNotifSlack(cfg.slack_webhook_url ?? '')
    setNotifTelegram(cfg.telegram_bot_token ?? '')
    setNotifTelegramChat(cfg.telegram_chat_id ?? '')
    setNotifResend(cfg.resend_api_key ?? '')
    setNotifEmail(cfg.alert_email ?? '')
    setNotifNtfyTopic(cfg.ntfy_topic ?? '')
    setNotifNtfyServer(cfg.ntfy_server ?? '')
    setNotifPushoverToken(cfg.pushover_app_token ?? '')
    setNotifPushoverUser(cfg.pushover_user_key ?? '')
    setNotifGotifyUrl(cfg.gotify_server_url ?? '')
    setNotifGotifyToken(cfg.gotify_app_token ?? '')
    setNotifAppriseUrl(cfg.apprise_url ?? '')
    setApiKeyPricesApi(cfg.prices_api_key ?? '')
    setApiKeyEbayId(cfg.ebay_client_id ?? '')
    setApiKeyEbaySec(cfg.ebay_client_secret ?? '')
    setApiKeyKeepa(cfg.keepa_api_key ?? '')
    setApiKeyAmzAccess(cfg.amazon_access_key ?? '')
    setApiKeyAmzSecret(cfg.amazon_secret_key ?? '')
    setApiKeyAmzTag(cfg.amazon_associate_tag ?? '')
    setApiKeyAwinId(cfg.awin_publisher_id ?? '')
    setApiKeyAwinKey(cfg.awin_api_key ?? '')
    setApiKeyRedditId(cfg.reddit_client_id ?? '')
    setApiKeyRedditSec(cfg.reddit_client_secret ?? '')
    setApiKeyYoutube(cfg.youtube_api_key ?? '')
    setApiKeyBing(cfg.bing_api_key ?? '')
    setApiKeyAnthropic(cfg.anthropic_api_key ?? '')
    setApiKeyOpenAI(cfg.openai_api_key ?? '')
    setApiKeyApify(cfg.apify_api_token ?? '')
    setApiKeyStatus({
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
    })
    setScraperCamofoxUrl(cfg.camofox_url ?? '')
    setScraperProxies(cfg.scrape_proxies ?? '')
  }, [])

  const loadSchedulerStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/scheduler')
      setSchedulerStatus(await r.json())
    } catch { /* silent */ }
  }, [])

  const loadSavedSearches = useCallback(async () => {
    try {
      const r = await fetch('/api/saved-searches')
      setSavedSearches(await r.json())
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    loadConfig()
    loadSchedulerStatus()
    loadSavedSearches()
    const onConfigChanged = e => { if (e.detail?.source !== 'react') loadConfig() }
    window.addEventListener('pc:config-changed', onConfigChanged)
    return () => window.removeEventListener('pc:config-changed', onConfigChanged)
  }, [loadConfig, loadSchedulerStatus, loadSavedSearches])

  async function saveConfigFields(fields) {
    await Promise.all(fields.map(f => post('/api/config', f)))
    await loadConfig()
    window.dispatchEvent(new CustomEvent('pc:config-changed', { detail: { source: 'react' } }))
  }

  async function saveScheduler() {
    const mins = parseInt(schedulerInterval)
    const r = await post('/api/scheduler', { interval_minutes: isNaN(mins) ? 0 : mins })
    const d = await r.json()
    if (r.ok) {
      showToast(d.active ? `✅ Auto-refresh every ${d.intervalMinutes}m` : '✅ Scheduler disabled')
    } else {
      showToast(d.error ?? 'Error', 'error')
    }
    await loadSchedulerStatus()
  }

  async function saveNotifications() {
    await saveConfigFields([
      { key: 'notify_drop_percent', value: notifDropPct },
      { key: 'discord_webhook_url', value: notifDiscord },
      { key: 'slack_webhook_url',   value: notifSlack },
      { key: 'telegram_bot_token',  value: notifTelegram },
      { key: 'telegram_chat_id',    value: notifTelegramChat },
      { key: 'resend_api_key',      value: notifResend },
      { key: 'alert_email',         value: notifEmail },
      { key: 'ntfy_topic',          value: notifNtfyTopic },
      { key: 'ntfy_server',         value: notifNtfyServer },
      { key: 'pushover_app_token',  value: notifPushoverToken },
      { key: 'pushover_user_key',   value: notifPushoverUser },
      { key: 'gotify_server_url',   value: notifGotifyUrl },
      { key: 'gotify_app_token',    value: notifGotifyToken },
      { key: 'apprise_url',         value: notifAppriseUrl },
    ])
    showToast('✅ Notification settings saved')
  }

  async function testNotification() {
    const r = await post('/api/notifications/test', {})
    const d = await r.json()
    const parts = []
    if (d.discord  !== undefined) parts.push('Discord '  + (d.discord  ? '✅' : '❌'))
    if (d.slack    !== undefined) parts.push('Slack '    + (d.slack    ? '✅' : '❌'))
    if (d.telegram !== undefined) parts.push('Telegram ' + (d.telegram ? '✅' : '❌'))
    if (d.email    !== undefined) parts.push('Email '    + (d.email    ? '✅' : '❌'))
    if (d.ntfy     !== undefined) parts.push('ntfy '     + (d.ntfy     ? '✅' : '❌'))
    if (d.pushover !== undefined) parts.push('Pushover ' + (d.pushover ? '✅' : '❌'))
    if (d.gotify   !== undefined) parts.push('Gotify '   + (d.gotify   ? '✅' : '❌'))
    if (d.apprise  !== undefined) parts.push('Apprise '  + (d.apprise  ? '✅' : '❌'))
    const ok = d.discord || d.slack || d.telegram || d.email || d.ntfy || d.pushover || d.gotify || d.apprise
    showToast(parts.join(' · ') || 'No notifications configured', ok ? 'success' : 'error')
  }

  async function saveApiKeys() {
    await saveConfigFields([
      { key: 'prices_api_key',       value: apiKeyPricesApi },
      { key: 'ebay_client_id',       value: apiKeyEbayId },
      { key: 'ebay_client_secret',   value: apiKeyEbaySec },
      { key: 'keepa_api_key',        value: apiKeyKeepa },
      { key: 'amazon_access_key',    value: apiKeyAmzAccess },
      { key: 'amazon_secret_key',    value: apiKeyAmzSecret },
      { key: 'amazon_associate_tag', value: apiKeyAmzTag },
      { key: 'awin_publisher_id',    value: apiKeyAwinId },
      { key: 'awin_api_key',         value: apiKeyAwinKey },
      { key: 'reddit_client_id',     value: apiKeyRedditId },
      { key: 'reddit_client_secret', value: apiKeyRedditSec },
      { key: 'youtube_api_key',      value: apiKeyYoutube },
      { key: 'bing_api_key',         value: apiKeyBing },
      { key: 'anthropic_api_key',    value: apiKeyAnthropic },
      { key: 'openai_api_key',       value: apiKeyOpenAI },
      { key: 'apify_api_token',      value: apiKeyApify },
    ])
    showToast('✅ API keys saved')
  }

  async function saveScraperSettings() {
    await saveConfigFields([
      { key: 'camofox_url',    value: scraperCamofoxUrl },
      { key: 'scrape_proxies', value: scraperProxies },
    ])
    showToast('✅ Scraper settings saved')
  }

  async function handleSetVatMode(mode) {
    setVatModeState(mode)
    await post('/api/config', { key: 'vat_mode', value: mode })
    window.dispatchEvent(new CustomEvent('pc:vat-changed', { detail: mode }))
    showToast(mode === 'ex_vat' ? '✅ Prices shown ex-VAT (−20%)' : '✅ Prices shown inc. VAT')
  }

  async function addSavedSearch() {
    if (!savedSearchName || !savedSearchQuery) {
      showToast('Label and query are required', 'error')
      return
    }
    const body = { name: savedSearchName, query: savedSearchQuery }
    if (savedSearchMaxPrice) body.max_price = parseFloat(savedSearchMaxPrice)
    await post('/api/saved-searches', body)
    setSavedSearchName(''); setSavedSearchQuery(''); setSavedSearchMaxPrice('')
    showToast('✅ Saved search alert added')
    await loadSavedSearches()
  }

  async function deleteSavedSearch(id) {
    await fetch(`/api/saved-searches/${id}`, { method: 'DELETE' })
    showToast('🗑️ Saved search removed')
    await loadSavedSearches()
  }

  async function importFromCsv() {
    if (!importCsv.trim()) return
    setImportCsvLoading(true)
    try {
      const r = await post('/api/import/csv', { csv: importCsv })
      const d = await r.json()
      if (r.ok) {
        showToast(`✅ Imported ${d.imported} components, skipped ${d.skipped}`)
        setImportCsv('')
        window.dispatchEvent(new CustomEvent('pc:components-changed'))
      } else {
        showToast('❌ ' + (d.error ?? 'Import failed'), 'error')
      }
    } catch { showToast('❌ Network error', 'error') }
    finally { setImportCsvLoading(false) }
  }

  async function importFromJson() {
    if (!importJson.trim()) return
    setImportJsonLoading(true)
    try {
      let parsed
      try { parsed = JSON.parse(importJson) }
      catch { showToast('❌ Invalid JSON', 'error'); setImportJsonLoading(false); return }
      const r = await post('/api/import/json', parsed)
      const d = await r.json()
      if (r.ok) {
        showToast(`✅ Restored: ${d.components} components, ${d.tags} tags, ${d.rules} scrape rules`)
        setImportJson('')
        window.dispatchEvent(new CustomEvent('pc:components-changed'))
      } else {
        showToast('❌ ' + (d.error ?? 'Restore failed'), 'error')
      }
    } catch { showToast('❌ Network error', 'error') }
    finally { setImportJsonLoading(false) }
  }

  const apiKeyStatusRows = [
    ['PricesAPI', apiKeyStatus.pricesapi],
    ['eBay',      apiKeyStatus.ebay],
    ['Keepa',     apiKeyStatus.keepa],
    ['Amazon PA', apiKeyStatus.amazon],
    ['AWIN',      apiKeyStatus.awin],
    ['Reddit',    apiKeyStatus.reddit],
    ['YouTube',   apiKeyStatus.youtube],
    ['Bing',      apiKeyStatus.bing],
    ['Anthropic', apiKeyStatus.anthropic],
    ['OpenAI',    apiKeyStatus.openai],
    ['Apify',     apiKeyStatus.apify],
  ]

  const notifStatusRows = [
    ['Discord',  configStatus.discord],
    ['Slack',    configStatus.slack],
    ['Telegram', configStatus.telegram],
    ['Email',    configStatus.email],
    ['ntfy',     configStatus.ntfy],
    ['Pushover', configStatus.pushover],
    ['Gotify',   configStatus.gotify],
    ['Apprise',  configStatus.apprise],
  ]

  return (
    <div className="space-y-5">

      <Toast toast={toast} />

      {/* Setup Wizard banner */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-4">
        <div className="flex-shrink-0 text-primary">
          <svg className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base-content text-sm">Setup Wizard</p>
          <p className="text-xs text-base-content/60 mt-0.5">Connect your API keys, notification channels, and scrapers — step by step, with links and tips for each one.</p>
        </div>
        <button
          onClick={() => document.getElementById('setup-wizard-modal')?.showModal()}
          className="btn btn-primary btn-sm gap-2 flex-shrink-0"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
          Launch
        </button>
      </div>

      {/* Scheduler */}
      <Card title="⏱️ Auto-Refresh Scheduler">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${schedulerStatus?.active ? 'bg-success' : 'bg-base-300'}`} />
          <span className="text-sm text-base-content/70">
            {schedulerStatus?.active
              ? `Running — every ${schedulerStatus.intervalMinutes} minute(s)`
              : 'Stopped'}
          </span>
        </div>
        {schedulerStatus?.lastRunAt && (
          <div className="text-xs text-base-content/50">
            Last run: {fmtDate(schedulerStatus.lastRunAt)} · Runs completed: {schedulerStatus.runCount}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-base-content/60 block mb-1">
              Interval in minutes (0 to disable, minimum 1)
            </label>
            <input
              value={schedulerInterval}
              onChange={e => setSchedulerInterval(e.target.value)}
              type="number" min="0"
              className="w-full input input-bordered"
            />
          </div>
          <button onClick={saveScheduler} className="btn btn-primary">Save</button>
        </div>
      </Card>

      {/* Notifications */}
      <Card title="🔔 Notifications">
        <div className="grid grid-cols-3 gap-2 text-sm mb-2">
          {notifStatusRows.map(([label, on]) => (
            <div key={label} className="flex items-center gap-2">
              <StatusDot on={on} />
              <span className="text-base-content/70 text-xs">{label}</span>
              <span className="text-xs">{on ? '✅' : '❌'}</span>
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Discord Webhook URL</label>
          <SecretInput value={notifDiscord} onChange={setNotifDiscord} placeholder="https://discord.com/api/webhooks/…" secretKey="discord" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>
        <div>
          <label className="text-xs text-base-content/60 block mb-1">Slack Webhook URL</label>
          <SecretInput value={notifSlack} onChange={setNotifSlack} placeholder="https://hooks.slack.com/services/…" secretKey="slack" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Telegram Bot Token</label>
            <SecretInput value={notifTelegram} onChange={setNotifTelegram} placeholder="123456:ABC-DEF…" secretKey="telegram" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
          </div>
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Telegram Chat ID</label>
            <input value={notifTelegramChat} onChange={e => setNotifTelegramChat(e.target.value)} type="text" placeholder="-100123456789" className="w-full input input-bordered" />
          </div>
        </div>
        <p className="text-xs text-base-content/40">Telegram: create a bot via @BotFather, add it to a group, get the chat ID with @userinfobot.</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Resend API Key (email)</label>
            <SecretInput value={notifResend} onChange={setNotifResend} placeholder="re_xxxxxxxxxx" secretKey="resend" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
          </div>
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Alert Email Address</label>
            <input value={notifEmail} onChange={e => setNotifEmail(e.target.value)} type="email" placeholder="you@example.com" className="w-full input input-bordered" />
          </div>
        </div>
        <p className="text-xs text-base-content/40">
          Email via <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-info hover:underline">Resend.com</a> — free tier: 100 emails/day.
        </p>

        <div className="border-t border-base-300 pt-3">
          <p className="text-xs text-base-content/60 font-medium mb-2">ntfy — instant push to phone/desktop, no account needed</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-base-content/60 block mb-1">ntfy Topic <span className="text-base-content/40">(pick anything unique)</span></label>
              <input value={notifNtfyTopic} onChange={e => setNotifNtfyTopic(e.target.value)} type="text" placeholder="my-pc-price-alerts" className="w-full input input-bordered" />
            </div>
            <div>
              <label className="text-xs text-base-content/60 block mb-1">ntfy Server <span className="text-base-content/40">(blank = ntfy.sh)</span></label>
              <input value={notifNtfyServer} onChange={e => setNotifNtfyServer(e.target.value)} type="text" placeholder="https://ntfy.sh" className="w-full input input-bordered" />
            </div>
          </div>
          <p className="text-xs text-base-content/40 mt-1">Subscribe at <span className="text-info">ntfy.sh/[your-topic]</span> or in the ntfy app.</p>
        </div>

        <div className="border-t border-base-300 pt-3">
          <p className="text-xs text-base-content/60 font-medium mb-2">Pushover — rich mobile push notifications (one-time $5 app purchase)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-base-content/60 block mb-1">Pushover App Token</label>
              <SecretInput value={notifPushoverToken} onChange={setNotifPushoverToken} placeholder="a…" secretKey="pushoverToken" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
            <div>
              <label className="text-xs text-base-content/60 block mb-1">Pushover User Key</label>
              <SecretInput value={notifPushoverUser} onChange={setNotifPushoverUser} placeholder="u…" secretKey="pushoverUser" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
          </div>
        </div>

        <div className="border-t border-base-300 pt-3">
          <p className="text-xs text-base-content/60 font-medium mb-2">Gotify — self-hosted push notification server</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-base-content/60 block mb-1">Gotify Server URL</label>
              <input value={notifGotifyUrl} onChange={e => setNotifGotifyUrl(e.target.value)} type="url" placeholder="http://your-gotify:80" className="w-full input input-bordered" />
            </div>
            <div>
              <label className="text-xs text-base-content/60 block mb-1">Gotify App Token</label>
              <input value={notifGotifyToken} onChange={e => setNotifGotifyToken(e.target.value)} type="password" placeholder="A…" className="w-full input input-bordered" />
            </div>
          </div>
        </div>

        <div className="border-t border-base-300 pt-3">
          <p className="text-xs text-base-content/60 font-medium mb-2">Apprise — unified push to 80+ services</p>
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Apprise API URL</label>
            <input value={notifAppriseUrl} onChange={e => setNotifAppriseUrl(e.target.value)} type="url" placeholder="http://your-apprise:8000/notify/KEY" className="w-full input input-bordered" />
            <p className="text-xs text-base-content/40 mt-1">Must be the full Apprise API notify endpoint.</p>
          </div>
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Minimum drop % to notify</label>
          <input value={notifDropPct} onChange={e => setNotifDropPct(e.target.value)} type="number" min="0" max="100" className="w-28 input input-bordered" />
        </div>
        <div className="flex gap-2">
          <button onClick={saveNotifications} className="btn btn-primary">Save</button>
          <button onClick={testNotification} className="btn btn-ghost">Send Test</button>
        </div>
      </Card>

      {/* API Keys */}
      <Card title="🔑 API Keys" subtitle="Saved securely in the local database. Takes effect immediately — no restart needed.">
        <div className="grid grid-cols-2 gap-2 text-xs">
          {apiKeyStatusRows.map(([label, ok]) => (
            <div key={label} className="flex items-center gap-1.5">
              <StatusDot on={ok} />
              <span className="text-base-content/70">{label}</span>
              <span className={ok ? 'text-success' : 'text-base-content/40'}>{ok ? '✅' : '❌'}</span>
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">PricesAPI Key <span className="text-base-content/40">(pricesapi.io — free 50k/month)</span></label>
          <SecretInput value={apiKeyPricesApi} onChange={setApiKeyPricesApi} placeholder="pa_…" secretKey="pricesapi" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">eBay Browse API <span className="text-base-content/40">(developer.ebay.com — free)</span></label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Client ID (AppID)</label>
              <SecretInput value={apiKeyEbayId} onChange={setApiKeyEbayId} placeholder="YourApp-…" secretKey="ebayId" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Client Secret (CertID)</label>
              <SecretInput value={apiKeyEbaySec} onChange={setApiKeyEbaySec} placeholder="SBX-…" secretKey="ebaySec" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Keepa API Key <span className="text-base-content/40">(keepa.com/api — Amazon price history)</span></label>
          <SecretInput value={apiKeyKeepa} onChange={setApiKeyKeepa} placeholder="keepa_…" secretKey="keepa" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Amazon PA API <span className="text-base-content/40">(affiliate programme — requires associate account)</span></label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Access Key</label>
              <SecretInput value={apiKeyAmzAccess} onChange={setApiKeyAmzAccess} placeholder="AKIA…" secretKey="amzAccess" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Secret Key</label>
              <SecretInput value={apiKeyAmzSecret} onChange={setApiKeyAmzSecret} placeholder="…" secretKey="amzSecret" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Associate Tag</label>
              <SecretInput value={apiKeyAmzTag} onChange={setApiKeyAmzTag} placeholder="yourtag-21" secretKey="amzTag" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">AWIN Affiliate <span className="text-base-content/40">(awin.com — Scan, Overclockers, Currys, 300+ UK shops)</span></label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Publisher ID</label>
              <SecretInput value={apiKeyAwinId} onChange={setApiKeyAwinId} placeholder="123456" secretKey="awinId" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
            <div>
              <label className="text-xs text-base-content/40 block mb-1">API Key</label>
              <SecretInput value={apiKeyAwinKey} onChange={setApiKeyAwinKey} placeholder="…" secretKey="awinKey" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Reddit API <span className="text-base-content/40">(reddit.com/prefs/apps — free)</span></label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Client ID</label>
              <SecretInput value={apiKeyRedditId} onChange={setApiKeyRedditId} placeholder="…" secretKey="redditId" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
            <div>
              <label className="text-xs text-base-content/40 block mb-1">Client Secret</label>
              <SecretInput value={apiKeyRedditSec} onChange={setApiKeyRedditSec} placeholder="…" secretKey="redditSec" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">YouTube Data API v3 <span className="text-base-content/40">(Google Cloud Console — free 10k units/day)</span></label>
          <SecretInput value={apiKeyYoutube} onChange={setApiKeyYoutube} placeholder="AIza…" secretKey="youtube" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Bing Search API Key <span className="text-base-content/40">(Azure — free 1k/month)</span></label>
          <SecretInput value={apiKeyBing} onChange={setApiKeyBing} placeholder="…" secretKey="bing" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Anthropic API Key <span className="text-base-content/40">(AI scraping fallback — used when all other methods fail)</span></label>
          <SecretInput value={apiKeyAnthropic} onChange={setApiKeyAnthropic} placeholder="sk-ant-…" secretKey="anthropic" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">OpenAI API Key <span className="text-base-content/40">(alternative AI fallback — gpt-4o-mini for price extraction &amp; self-healing)</span></label>
          <SecretInput value={apiKeyOpenAI} onChange={setApiKeyOpenAI} placeholder="sk-…" secretKey="openai" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
        </div>

        <div>
          <label className="text-xs text-base-content/60 block mb-1">Apify API Token <span className="text-base-content/40">(optional — enables cloud PCPartPicker scraping via apify.com actor)</span></label>
          <SecretInput value={apiKeyApify} onChange={setApiKeyApify} placeholder="apify_api_…" secretKey="apify" showSecrets={showSecrets} setShowSecrets={setShowSecrets} />
          <p className="text-xs text-base-content/40 mt-1">Used for POST /api/pcpartpicker/apify — optional, the Playwright scraper works without it.</p>
        </div>

        <button onClick={saveApiKeys} className="btn btn-primary">Save API Keys</button>
      </Card>

      {/* Scraper Settings */}
      <Card title="🕵️ Scraper Settings" subtitle="Anti-detection browser and proxy configuration for JS-rendered retailer pages.">
        <div>
          <label className="text-xs text-base-content/60 font-medium block mb-1">
            Camofox Server URL <span className="text-base-content/40 font-normal">(jo-inc/camofox-browser — bypasses Cloudflare, Dell, HP anti-bot)</span>
          </label>
          <input value={scraperCamofoxUrl} onChange={e => setScraperCamofoxUrl(e.target.value)} type="url" placeholder="http://localhost:9377" className="w-full input input-bordered mono" />
          <p className="text-xs text-base-content/40 mt-1.5">
            Start server: <code className="text-base-content/60 bg-base-300/50 px-1.5 py-0.5 rounded">npx @askjo/camofox-browser</code> or Docker on port 9377.
          </p>
        </div>
        <div>
          <label className="text-xs text-base-content/60 font-medium block mb-1">
            Rotating Proxies <span className="text-base-content/40 font-normal">(comma-separated — randomly selected per scrape session)</span>
          </label>
          <textarea value={scraperProxies} onChange={e => setScraperProxies(e.target.value)} rows={3} placeholder="http://user:pass@proxy1.example.com:8080, http://proxy2:3128" className="textarea textarea-bordered w-full mono text-xs resize-none" />
          <p className="text-xs text-base-content/40 mt-1">Used as Playwright context proxy — helps bypass IP-based rate limits and geo-blocks.</p>
        </div>
        <button onClick={saveScraperSettings} className="btn btn-primary">Save Scraper Settings</button>
      </Card>

      {/* VAT Display */}
      <Card title="💰 VAT Display">
        <div className="flex gap-2">
          <button
            onClick={() => handleSetVatMode('inc_vat')}
            className={`btn btn-ghost btn-sm ${vatMode === 'inc_vat' ? 'bg-primary text-primary-content' : 'text-base-content/70'}`}
          >
            Inc. VAT
          </button>
          <button
            onClick={() => handleSetVatMode('ex_vat')}
            className={`btn btn-ghost btn-sm ${vatMode === 'ex_vat' ? 'bg-primary text-primary-content' : 'text-base-content/70'}`}
          >
            Ex. VAT (−20%)
          </button>
        </div>
        <p className="text-xs text-base-content/50">Ex-VAT divides all prices by 1.2. Useful for business purchasing / expense tracking.</p>
      </Card>

      {/* Saved Search Alerts */}
      <Card title="🔍 Saved Search Alerts">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Label</label>
            <input value={savedSearchName} onChange={e => setSavedSearchName(e.target.value)} type="text" placeholder="RTX 5070 Ti watch" className="w-full input input-bordered" />
          </div>
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Search query</label>
            <input value={savedSearchQuery} onChange={e => setSavedSearchQuery(e.target.value)} type="text" placeholder="RTX 5070 Ti" className="w-full input input-bordered" />
          </div>
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Max price (£, optional)</label>
            <input value={savedSearchMaxPrice} onChange={e => setSavedSearchMaxPrice(e.target.value)} type="number" placeholder="600" className="w-full input input-bordered" />
          </div>
          <div className="flex items-end">
            <button onClick={addSavedSearch} className="w-full btn btn-primary">+ Add Alert</button>
          </div>
        </div>
        {savedSearches.length > 0 ? (
          <div className="space-y-1 mt-2">
            {savedSearches.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-base-300/40 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-base-content font-medium">{s.name}</div>
                  <div className="text-xs text-base-content/60 flex gap-3 mt-0.5">
                    <span>Query: {s.query}</span>
                    {s.max_price && <span>Max: £{s.max_price}</span>}
                    <span>Last: {s.last_checked ? fmtDate(s.last_checked) : 'never'}</span>
                  </div>
                </div>
                <button onClick={() => deleteSavedSearch(s.id)} className="btn btn-error btn-xs ml-3">🗑️</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-base-content/40">No saved searches yet. Add one above to get notified when new deals appear.</p>
        )}
      </Card>

      {/* Export */}
      <Card title="📤 Export">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-base-content/70 w-44">Full watchlist</span>
          <a href="/api/export?type=tracked_components&format=csv" className="btn btn-ghost btn-sm">Download CSV</a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-base-content/70 w-44">Full backup</span>
          <a href="/api/export/backup" className="btn btn-xs btn-secondary">Download JSON backup</a>
          <span className="text-xs text-base-content/50">Includes components, tags, scrape rules (no API keys)</span>
        </div>
        <p className="text-xs text-base-content/40">Per-component and per-build exports are available from the Watchlist and Builds tabs.</p>
      </Card>

      {/* Import */}
      <div className="bg-base-200 rounded-xl border border-base-300">
        <div className="px-4 py-3 border-b border-base-300">
          <h3 className="font-semibold text-base-content">📥 Import</h3>
        </div>
        <div className="p-4 space-y-5">
          <div>
            <p className="text-xs text-base-content/60 font-medium mb-2">Bulk CSV Import</p>
            <p className="text-xs text-base-content/40 mb-2">Required column: <code className="text-base-content/60">name</code> — Optional: <code className="text-base-content/60">search_query, category, alert_price, notes, source_url</code></p>
            <textarea
              value={importCsv}
              onChange={e => setImportCsv(e.target.value)}
              rows={5}
              placeholder={"name,search_query,category,alert_price\nRTX 5080,RTX 5080 founders,gpu,1100\nRyzen 9 9950X,Ryzen 9 9950X,cpu,"}
              className="textarea textarea-bordered w-full mono text-xs resize-none"
            />
            <button onClick={importFromCsv} disabled={importCsvLoading || !importCsv.trim()} className="mt-2 btn btn-primary">
              {importCsvLoading ? '⏳ Importing…' : 'Import CSV'}
            </button>
          </div>
          <div className="border-t border-base-300 pt-4">
            <p className="text-xs text-base-content/60 font-medium mb-2">Restore from JSON Backup</p>
            <p className="text-xs text-base-content/40 mb-2">Paste the contents of a previously exported JSON backup. Existing items with the same name are skipped.</p>
            <textarea
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              rows={4}
              placeholder='{"components":[…],"tags":[…],"rules":[…]}'
              className="textarea textarea-bordered w-full mono text-xs resize-none"
            />
            <button onClick={importFromJson} disabled={importJsonLoading || !importJson.trim()} className="btn btn-sm mt-2 btn-secondary">
              {importJsonLoading ? '⏳ Restoring…' : 'Restore JSON Backup'}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
