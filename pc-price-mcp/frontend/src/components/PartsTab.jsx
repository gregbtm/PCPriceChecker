import { useState, useEffect } from 'react'
import { post } from '../lib/api.js'
import { useToast, Toast } from '../lib/useToast.jsx'
import {
  CATEGORY_GROUPS, categoryLabel, COLUMN_SCHEMA, COLUMN_TO_FILTER_KEY, SLUG_TO_COMPONENT_CATEGORY,
} from '../lib/partsCatalog.js'

const PAGE_SIZE = 40
// A stable reference for "no filters set", reused everywhere instead of `{}`
// literals — a fresh {} on every reset breaks Object.is dependency checks
// and cascades into redundant/racing fetches (category switch + debounce
// effect both "changing" an already-empty value).
const EMPTY_FILTERS = {}
// The dataset has genuine duplicate `name`s (e.g. the same CPU listed twice
// at different prices), so name alone can't be a React key or a compare
// selection id — pair it with price to disambiguate.
const partKey = (p) => `${p.name}__${p.price}`

function SortHeader({ label, sortKey, activeKey, activeDir, onSort }) {
  const active = sortKey === activeKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="cursor-pointer select-none hover:text-base-content whitespace-nowrap"
      title={`Sort by ${label}`}
    >
      {label}
      <span className={active ? 'text-primary ml-1' : 'text-base-content/20 ml-1'}>
        {active ? (activeDir === 'asc' ? '▲' : '▼') : '▾'}
      </span>
    </th>
  )
}

function SpecChips({ specs, skipKeys }) {
  const entries = Object.entries(specs).filter(([k]) => !skipKeys.includes(k))
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.slice(0, 4).map(([k, v]) => (
        <span key={k} className="badge badge-ghost badge-sm font-normal" title={k}>{v}</span>
      ))}
    </div>
  )
}

function SkeletonRows({ cols }) {
  return Array.from({ length: 8 }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j}><div className="h-4 bg-base-300/60 rounded animate-pulse" style={{ width: j === 0 ? '70%' : '45%' }} /></td>
      ))}
    </tr>
  ))
}

export default function PartsTab() {
  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('video-card')

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [pricedOnly, setPricedOnly] = useState(false)

  const [filterSchema, setFilterSchema] = useState([])
  const [filterInputs, setFilterInputs] = useState(EMPTY_FILTERS)
  const [debouncedFilters, setDebouncedFilters] = useState(EMPTY_FILTERS)

  const [sortKey, setSortKey] = useState('price')
  const [sortDir, setSortDir] = useState('asc')

  const [results, setResults] = useState([])
  const [totalMatching, setTotalMatching] = useState(0)
  const [total, setTotal] = useState(0)
  const [totalPriced, setTotalPriced] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [compareKeys, setCompareKeys] = useState([])
  const [showCompare, setShowCompare] = useState(false)

  const [addToBuildPart, setAddToBuildPart] = useState(null)
  const [builds, setBuilds] = useState([])
  const [addToBuildId, setAddToBuildId] = useState('')
  const [addToBuildBusy, setAddToBuildBusy] = useState(false)

  const { toast, showToast } = useToast()

  useEffect(() => {
    fetch('/api/dataset/slugs').then(r => r.json()).then(d => setCategories(d.slugs ?? [])).catch(() => {})
  }, [])

  // Fresh category: clear query/filters/sort/compare and load its filter schema.
  useEffect(() => {
    setQuery('')
    setDebouncedQuery('')
    setFilterInputs(EMPTY_FILTERS)
    setDebouncedFilters(EMPTY_FILTERS)
    setSortKey('price')
    setSortDir('asc')
    setCompareKeys([])
    fetch(`/api/dataset/filters?part_type=${category}`)
      .then(r => r.json())
      .then(d => setFilterSchema(d.fields ?? []))
      .catch(() => setFilterSchema([]))
  }, [category])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(filterInputs), 300)
    return () => clearTimeout(t)
  }, [filterInputs])

  function buildParams(offset) {
    const p = new URLSearchParams({
      part_type: category, limit: String(PAGE_SIZE), offset: String(offset), sort: sortKey, dir: sortDir,
    })
    if (pricedOnly) p.set('priced_only', 'true')
    for (const [key, range] of Object.entries(debouncedFilters)) {
      if (range?.min !== undefined && range.min !== '') p.set(`min_${key}`, range.min)
      if (range?.max !== undefined && range.max !== '') p.set(`max_${key}`, range.max)
    }
    if (debouncedQuery.trim()) p.set('q', debouncedQuery.trim())
    return p
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const endpoint = debouncedQuery.trim() ? '/api/dataset/search' : '/api/dataset/browse'
    fetch(`${endpoint}?${buildParams(0)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setResults(d.results ?? [])
        setTotalMatching(d.totalMatching ?? d.total ?? (d.results?.length ?? 0))
        setTotal(d.total ?? 0)
        setTotalPriced(d.totalPriced ?? 0)
      })
      .catch(() => { if (!cancelled) showToast('❌ Failed to load parts', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, debouncedQuery, pricedOnly, debouncedFilters, sortKey, sortDir])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const endpoint = debouncedQuery.trim() ? '/api/dataset/search' : '/api/dataset/browse'
      const r = await fetch(`${endpoint}?${buildParams(results.length)}`)
      const d = await r.json()
      setResults(prev => [...prev, ...(d.results ?? [])])
    } catch {
      showToast('❌ Failed to load more', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'price' ? 'asc' : 'desc')
    }
  }

  function setFilterBound(key, bound, value) {
    setFilterInputs(prev => ({ ...prev, [key]: { ...prev[key], [bound]: value === '' ? undefined : Number(value) } }))
  }

  function toggleCompare(name) {
    setCompareKeys(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name)
      if (prev.length >= 4) { showToast('Compare up to 4 parts at a time', 'error'); return prev }
      return [...prev, name]
    })
  }

  function trackPart(part) {
    window.dispatchEvent(new CustomEvent('pc:track-request', { detail: { name: part.name } }))
  }

  function findUkPrice(part) {
    window.dispatchEvent(new CustomEvent('pc:search-request', { detail: { query: part.name } }))
  }

  async function openAddToBuild(part) {
    setAddToBuildPart(part)
    setAddToBuildId('')
    try {
      const r = await fetch('/api/builds')
      setBuilds(await r.json())
    } catch { setBuilds([]) }
  }

  async function confirmAddToBuild() {
    if (!addToBuildId || !addToBuildPart) return
    setAddToBuildBusy(true)
    try {
      const existing = await fetch('/api/components').then(r => r.json())
      let componentId = existing.find(c => c.name === addToBuildPart.name)?.id
      if (!componentId) {
        const compCategory = SLUG_TO_COMPONENT_CATEGORY[addToBuildPart.slug] ?? 'other'
        const created = await post('/api/components', {
          name: addToBuildPart.name, search_query: addToBuildPart.name, category: compCategory, fetch_now: false,
        }).then(r => r.json())
        componentId = created.id
      }
      await post(`/api/builds/${addToBuildId}/items`, { component_id: componentId, quantity: 1 })
      showToast(`✅ Added to build`)
      setAddToBuildPart(null)
    } catch {
      showToast('❌ Failed to add to build', 'error')
    } finally {
      setAddToBuildBusy(false)
    }
  }

  const columns = COLUMN_SCHEMA[category] ?? []
  const sortableKeys = COLUMN_TO_FILTER_KEY[category] ?? {}
  const compareItems = results.filter(r => compareKeys.includes(partKey(r)))
  const compareSpecKeys = [...new Set(compareItems.flatMap(i => Object.keys(i.specs)))]

  return (
    <div className="space-y-5">
      <Toast toast={toast} />

      <div className="bg-base-200 rounded-xl border border-base-300 p-5 space-y-4">
        <h2 className="font-semibold text-base-content">
          Parts Database <span className="text-base-content/50 font-normal text-sm">— 66,000+ components · full specs · USD reference prices</span>
        </h2>

        <div className="flex flex-col gap-2">
          {CATEGORY_GROUPS.map(g => (
            <div key={g.label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-base-content/40 w-32 shrink-0">{g.label}</span>
              {g.slugs.filter(s => categories.includes(s)).map(s => (
                <button
                  key={s}
                  onClick={() => setCategory(s)}
                  className={`btn btn-xs ${category === s ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {categoryLabel(s)}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-base-content/60 block mb-1">Search within {categoryLabel(category)}</label>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              type="text" placeholder="e.g. RTX 4070, 32GB DDR5…"
              className="input input-bordered w-64"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-base-content/70 cursor-pointer mb-2.5">
            <input type="checkbox" checked={pricedOnly} onChange={e => setPricedOnly(e.target.checked)} className="checkbox checkbox-sm" />
            Priced only
          </label>
          {filterSchema.map(f => (
            <div key={f.key}>
              <label className="text-xs text-base-content/60 block mb-1">{f.label}{f.unit ? ` (${f.unit})` : ''}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number" placeholder={String(f.min)}
                  value={filterInputs[f.key]?.min ?? ''}
                  onChange={e => setFilterBound(f.key, 'min', e.target.value)}
                  className="input input-bordered input-sm w-20"
                />
                <span className="text-base-content/30 text-xs">–</span>
                <input
                  type="number" placeholder={String(f.max)}
                  value={filterInputs[f.key]?.max ?? ''}
                  onChange={e => setFilterBound(f.key, 'max', e.target.value)}
                  className="input input-bordered input-sm w-20"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-base-200 rounded-xl border border-base-300">
        <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-base-content">
            {loading && results.length === 0
              ? 'Loading…'
              : <>Showing <strong className="font-variant-tabular">{results.length}</strong> of <strong className="font-variant-tabular">{totalMatching.toLocaleString()}</strong> matching{!pricedOnly ? <> ({totalPriced.toLocaleString()} priced, {total.toLocaleString()} total)</> : null}</>}
          </span>
          <span className="text-xs text-base-content/50">USD reference prices · from docyx/pc-part-dataset</span>
        </div>

        {/* Desktop table */}
        <div className="overflow-x-auto hidden md:block">
          <table className="table table-sm table-zebra w-full">
            <thead>
              <tr className="text-left text-xs text-base-content/50 uppercase border-b border-base-300">
                <th></th>
                <th>Name</th>
                {columns.map(col => sortableKeys[col]
                  ? <SortHeader key={col} label={col} sortKey={sortableKeys[col]} activeKey={sortKey} activeDir={sortDir} onSort={handleSort} />
                  : <th key={col} className="whitespace-nowrap">{col}</th>)}
                <SortHeader label="Price" sortKey="price" activeKey={sortKey} activeDir={sortDir} onSort={handleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-300/50">
              {loading && results.length === 0 ? (
                <SkeletonRows cols={columns.length + 4} />
              ) : results.length === 0 ? (
                <tr><td colSpan={columns.length + 4} className="text-center py-10 text-base-content/40">No parts matched. Try widening the filters.</td></tr>
              ) : results.map((p, idx) => (
                <tr key={idx} className="hover:bg-base-300/30 transition-colors">
                  <td>
                    <input
                      type="checkbox" className="checkbox checkbox-xs"
                      checked={compareKeys.includes(partKey(p))}
                      onChange={() => toggleCompare(partKey(p))}
                    />
                  </td>
                  <td className="font-medium text-base-content text-sm max-w-xs">
                    {p.name}
                    {columns.length === 0 && <SpecChips specs={p.specs} skipKeys={[]} />}
                  </td>
                  {columns.map(col => (
                    <td key={col} className="text-base-content/70 text-xs whitespace-nowrap">{p.specs[col] ?? '—'}</td>
                  ))}
                  <td className="font-variant-tabular">
                    {p.price != null
                      ? <span className="text-warning font-semibold text-sm">${p.price.toFixed(0)}</span>
                      : <span className="text-base-content/40 text-xs">N/A</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    <button onClick={() => findUkPrice(p)} className="btn btn-ghost btn-xs" title="Search UK retailers for this part">UK price</button>
                    <button onClick={() => trackPart(p)} className="btn btn-ghost btn-xs">+ Track</button>
                    <button onClick={() => openAddToBuild(p)} className="btn btn-ghost btn-xs">+ Build</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-base-300/50">
          {loading && results.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-base-300/60 rounded animate-pulse" />)}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-10 text-base-content/40 text-sm">No parts matched. Try widening the filters.</div>
          ) : results.map((p, idx) => (
            <div key={idx} className="p-4 flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <input type="checkbox" className="checkbox checkbox-xs mt-1" checked={compareKeys.includes(partKey(p))} onChange={() => toggleCompare(partKey(p))} />
                  <div className="font-medium text-base-content text-sm">{p.name}</div>
                </div>
                {p.price != null
                  ? <span className="text-warning font-semibold text-sm shrink-0">${p.price.toFixed(0)}</span>
                  : <span className="text-base-content/40 text-xs shrink-0">N/A</span>}
              </div>
              <SpecChips specs={p.specs} skipKeys={[]} />
              <div className="flex gap-2 mt-1">
                <button onClick={() => findUkPrice(p)} className="btn btn-ghost btn-xs">UK price</button>
                <button onClick={() => trackPart(p)} className="btn btn-ghost btn-xs">+ Track</button>
                <button onClick={() => openAddToBuild(p)} className="btn btn-ghost btn-xs">+ Build</button>
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && results.length < totalMatching && (
          <div className="p-4 flex justify-center border-t border-base-300">
            <button onClick={loadMore} disabled={loadingMore} className="btn btn-outline btn-sm">
              {loadingMore ? 'Loading…' : `Load more (${(totalMatching - results.length).toLocaleString()} remaining)`}
            </button>
          </div>
        )}
      </div>

      {compareKeys.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-base-300 border border-base-content/10 rounded-full shadow-lg px-4 py-2 flex items-center gap-3">
            <span className="text-sm text-base-content">{compareKeys.length} selected</span>
            <button onClick={() => setShowCompare(true)} className="btn btn-primary btn-sm">Compare</button>
            <button onClick={() => setCompareKeys([])} className="btn btn-ghost btn-xs">Clear</button>
          </div>
        </div>
      )}

      {showCompare && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowCompare(false) }}>
          <div className="bg-base-200 rounded-xl border border-base-300 w-full max-w-3xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
              <h3 className="font-semibold text-base-content">Compare {compareItems.length} parts</h3>
              <button onClick={() => setShowCompare(false)} className="text-base-content/50 hover:text-base-content">✕</button>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="table table-sm w-full">
                <thead>
                  <tr className="text-left text-xs text-base-content/50 uppercase border-b border-base-300">
                    <th>Spec</th>
                    {compareItems.map((i, idx) => <th key={idx} className="whitespace-nowrap">{i.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-300/50">
                  <tr>
                    <td className="font-medium text-base-content/60">Price</td>
                    {compareItems.map((i, idx) => <td key={idx} className="font-semibold text-warning">{i.price != null ? `$${i.price.toFixed(2)}` : 'N/A'}</td>)}
                  </tr>
                  {compareSpecKeys.map(key => (
                    <tr key={key}>
                      <td className="font-medium text-base-content/60">{key}</td>
                      {compareItems.map((i, idx) => <td key={idx} className="text-base-content/80">{i.specs[key] ?? '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {addToBuildPart && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setAddToBuildPart(null) }}>
          <div className="bg-base-200 rounded-xl border border-base-300 w-full max-w-sm p-6">
            <h3 className="font-semibold text-lg text-base-content mb-1">Add to Build</h3>
            <p className="text-xs text-base-content/50 mb-4">{addToBuildPart.name}</p>
            {builds.length === 0 ? (
              <p className="text-sm text-base-content/60">No builds yet — create one on the Builds tab first.</p>
            ) : (
              <select value={addToBuildId} onChange={e => setAddToBuildId(e.target.value)} className="select select-bordered w-full">
                <option value="">Select a build…</option>
                {builds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <div className="flex gap-2 mt-5">
              <button onClick={confirmAddToBuild} disabled={!addToBuildId || addToBuildBusy} className="btn btn-primary flex-1">
                {addToBuildBusy ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => setAddToBuildPart(null)} className="btn btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
