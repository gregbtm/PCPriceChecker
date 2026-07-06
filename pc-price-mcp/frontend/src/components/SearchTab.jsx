import { useState, useEffect, useRef } from 'react'
import { fmtPrice } from '../lib/format.js'
import { useToast, Toast } from '../lib/useToast.jsx'
import { retailerList, ALL_SEARCH_RETAILER_IDS, DEFAULT_SEARCH_RETAILER_IDS } from '../lib/retailers.js'

const PCPP_CATEGORIES = ['gpu', 'cpu', 'ram', 'motherboard', 'storage', 'psu', 'case', 'cooling', 'monitor']

const SOURCE_BADGE = {
  retailers: 'badge-info',
  pricesapi: 'badge-success',
  cex: 'badge-warning',
  pcpartpicker: 'badge-secondary',
}

function ConfidenceNote({ confidence, offerCount }) {
  if (confidence !== 'fuzzy' || offerCount < 2) return null
  return (
    <span className="badge badge-ghost badge-sm" title="Grouped by similar name and price — expand to check if that's right">
      Possibly the same item
    </span>
  )
}

export default function SearchTab() {
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [retailers, setRetailers] = useState(DEFAULT_SEARCH_RETAILER_IDS)
  const [pcppCategory, setPcppCategory] = useState('gpu')
  const [cexInStockOnly, setCexInStockOnly] = useState(false)

  const [loading, setLoading] = useState(false)
  const [clusters, setClusters] = useState(null)
  const [perSource, setPerSource] = useState([])
  const [splitClusters, setSplitClusters] = useState(new Set())
  const [vatMode, setVatMode] = useState('inc_vat')

  const { toast, showToast } = useToast()
  const searchGenRef = useRef(0)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(cfg => setVatMode(cfg.vat_mode ?? 'inc_vat')).catch(() => {})
    const onVatChanged = e => setVatMode(e.detail)
    window.addEventListener('pc:vat-changed', onVatChanged)
    return () => window.removeEventListener('pc:vat-changed', onVatChanged)
  }, [])

  async function runSearch(q) {
    const searchQuery = q ?? query
    if (!searchQuery.trim() || loading) return
    setLoading(true)
    setLastQuery(searchQuery)
    setSplitClusters(new Set())
    const gen = ++searchGenRef.current
    try {
      const p = new URLSearchParams({ q: searchQuery, retailers: retailers.join(','), pcpp_category: pcppCategory })
      if (cexInStockOnly) p.set('cex_in_stock', 'true')
      const r = await fetch(`/api/search/unified?${p}`)
      const d = await r.json()
      if (gen !== searchGenRef.current) return
      setClusters(d.clusters ?? [])
      setPerSource(d.perSource ?? [])
    } catch (e) {
      if (gen === searchGenRef.current) showToast('❌ Search failed: ' + e.message, 'error')
    } finally {
      if (gen === searchGenRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    function onSearchRequest(e) {
      setQuery(e.detail.query)
      runSearch(e.detail.query)
    }
    window.addEventListener('pc:search-request', onSearchRequest)
    return () => window.removeEventListener('pc:search-request', onSearchRequest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retailers, pcppCategory, cexInStockOnly])

  function toggleRetailer(id) {
    setRetailers(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])
  }

  function toggleSplit(clusterId) {
    setSplitClusters(prev => {
      const next = new Set(prev)
      next.has(clusterId) ? next.delete(clusterId) : next.add(clusterId)
      return next
    })
  }

  function track(name) {
    window.dispatchEvent(new CustomEvent('pc:track-request', { detail: { name } }))
  }

  const failedSources = perSource.filter(s => !s.ok)
  const totalOffers = (clusters ?? []).reduce((n, c) => n + c.offers.length, 0)

  return (
    <div className="space-y-5">
      <Toast toast={toast} />

      <div className="bg-base-200 rounded-xl border border-base-300 p-5 space-y-4">
        <h2 className="font-semibold text-base-content">Search — all sources, merged</h2>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
            type="text"
            placeholder="e.g. RTX 5080, Ryzen 7 9800X3D, 32GB DDR5 6000…"
            className="flex-1 input input-bordered"
          />
          <button onClick={() => runSearch()} disabled={loading || !query.trim()} className="btn btn-primary">
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          {retailerList(ALL_SEARCH_RETAILER_IDS).map(r => (
            <label key={r.id} className="flex items-center gap-1.5 text-sm text-base-content/70 cursor-pointer select-none">
              <input type="checkbox" checked={retailers.includes(r.id)} onChange={() => toggleRetailer(r.id)} className="checkbox checkbox-sm" />
              <span>{r.label}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-base-content/70 cursor-pointer">
            <input type="checkbox" checked={cexInStockOnly} onChange={e => setCexInStockOnly(e.target.checked)} className="checkbox checkbox-sm" />
            CeX: in stock online only
          </label>
          <label className="flex items-center gap-2 text-sm text-base-content/70">
            PCPartPicker category:
            <select value={pcppCategory} onChange={e => setPcppCategory(e.target.value)} className="select select-bordered select-sm">
              {PCPP_CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </label>
        </div>

        {loading && (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">⏳</div>
            <p className="text-base-content/60 text-sm">Querying all four sources in parallel — PricesAPI and PCPartPicker can take up to a minute on a cold search…</p>
          </div>
        )}
      </div>

      {clusters !== null && !loading && (
        <div className="bg-base-200 rounded-xl border border-base-300">
          <div className="px-4 py-3 border-b border-base-300 flex flex-wrap items-center gap-3">
            <h3 className="font-medium text-base-content">
              Results for &quot;{lastQuery}&quot; — {clusters.length} product{clusters.length !== 1 ? 's' : ''}, {totalOffers} offer{totalOffers !== 1 ? 's' : ''}
            </h3>
            {perSource.map(s => (
              <span key={s.source} className={`badge badge-sm ${s.ok ? SOURCE_BADGE[s.source] ?? 'badge-ghost' : 'badge-ghost opacity-50'}`} title={s.error ?? `${s.count} offer(s)`}>
                {s.source} {s.ok ? `· ${s.count}` : '· —'}
              </span>
            ))}
          </div>

          {failedSources.length > 0 && (
            <div className="px-4 py-2 bg-warning/10 text-xs text-warning border-b border-base-300">
              {failedSources.map(s => `${s.source}: ${s.error}`).join(' · ')}
            </div>
          )}

          <div className="divide-y divide-base-300/50">
            {clusters.map(c => {
              const isSplit = splitClusters.has(c.clusterId)
              const rows = isSplit ? c.offers.map(o => ({ ...o, _solo: true })) : [c]
              return rows.map((row, ri) => {
                if (row._solo) {
                  const o = row
                  return (
                    <div key={`${c.clusterId}-solo-${ri}`} className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-base-content truncate">{o.name}</div>
                          <span className={`badge badge-sm mt-1 ${SOURCE_BADGE[o.source] ?? 'badge-ghost'}`}>{o.sourceLabel}</span>
                        </div>
                        <button onClick={() => track(o.name)} className="btn btn-primary btn-xs flex-shrink-0">+ Track</button>
                      </div>
                      <div className="flex items-center justify-between bg-base-300/40 rounded-lg px-3 py-2">
                        <span className="text-sm text-base-content/70">{o.retailer}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs">{o.inStock ? '✅ In stock' : '❌ Out of stock'}</span>
                          <span className="font-bold text-base-content">{o.price != null ? fmtPrice(o.price, o.currency, vatMode) : 'N/A'}</span>
                          {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-xs text-info hover:underline">View →</a>}
                        </div>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={c.clusterId} className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-base-content text-sm leading-snug">{c.displayName}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {c.bestPrice !== null && <span className="text-xs font-semibold text-success">from {fmtPrice(c.bestPrice, c.offers[0]?.currency ?? 'GBP', vatMode)}</span>}
                          <span className="text-xs text-base-content/50">{c.offers.length} offer{c.offers.length !== 1 ? 's' : ''}</span>
                          <ConfidenceNote confidence={c.confidence} offerCount={c.offers.length} />
                          {c.confidence === 'fuzzy' && c.offers.length > 1 && (
                            <button onClick={() => toggleSplit(c.clusterId)} className="text-xs text-info hover:underline">Split — these aren&apos;t the same</button>
                          )}
                        </div>
                      </div>
                      <button onClick={() => track(c.displayName)} className="btn btn-primary btn-xs flex-shrink-0">+ Track</button>
                    </div>
                    <div className="space-y-1.5">
                      {c.offers.map((o, oi) => (
                        <div key={o.offerId + oi} className={`rounded px-3 py-2 ${o.inStock && o.price === c.bestPrice ? 'bg-success/10 border border-success/30' : 'bg-base-200/60'}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {o.inStock && o.price === c.bestPrice && <span className="badge badge-success badge-sm flex-shrink-0">Best</span>}
                              <span className={`badge badge-sm flex-shrink-0 ${SOURCE_BADGE[o.source] ?? 'badge-ghost'}`}>{o.sourceLabel}</span>
                              {o.url ? (
                                <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-sm text-base-content/80 hover:text-base-content font-medium truncate">{o.retailer}</a>
                              ) : (
                                <span className="text-sm text-base-content/80 font-medium truncate">{o.retailer}</span>
                              )}
                              {o.condition && o.condition.toLowerCase() !== 'new' && (
                                <span className={`badge badge-soft badge-sm flex-shrink-0 whitespace-nowrap ${o.condition.toLowerCase().includes('used') || o.condition.toLowerCase().includes('refurb') ? 'badge-warning' : 'badge-secondary'}`}>{o.condition}</span>
                              )}
                              {o.confirmedBySources && (
                                <span className="badge badge-ghost badge-sm flex-shrink-0" title={`Independently seen by: ${o.confirmedBySources.join(', ')}`}>
                                  ✓ {o.confirmedBySources.length} sources agree
                                </span>
                              )}
                              <span className="text-xs flex-shrink-0">{o.inStock ? '✅' : '❌'}</span>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="font-semibold text-base-content text-sm whitespace-nowrap">{o.price != null ? fmtPrice(o.price, o.currency, vatMode) : 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            })}
            {clusters.length === 0 && (
              <div className="p-6 text-center text-base-content/40 text-sm">No results found. Try a different keyword or select more retailers.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
