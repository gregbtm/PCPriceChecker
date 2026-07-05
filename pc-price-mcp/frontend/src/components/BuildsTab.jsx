import { useState, useEffect, useCallback } from 'react'
import { fmtPrice } from '../lib/format.js'
import { post } from '../lib/api.js'
import { useToast, Toast } from '../lib/useToast.jsx'

export default function BuildsTab() {
  const [builds, setBuilds] = useState([])
  const [selectedBuild, setSelectedBuild] = useState(null)
  const [selectedBuildDetail, setSelectedBuildDetail] = useState(null)
  const [vatMode, setVatMode] = useState('inc_vat')
  const [components, setComponents] = useState([])

  const [showCreateBuild, setShowCreateBuild] = useState(false)
  const [newBuildName, setNewBuildName] = useState('')
  const [newBuildDesc, setNewBuildDesc] = useState('')

  const [showAddToBuild, setShowAddToBuild] = useState(false)
  const [addToBuildCid, setAddToBuildCid] = useState('')
  const [addToBuildQty, setAddToBuildQty] = useState(1)

  const { toast, showToast } = useToast()

  const loadBuilds = useCallback(async () => {
    try {
      const r = await fetch('/api/builds')
      setBuilds(await r.json())
    } catch { /* silent */ }
  }, [])

  const selectBuild = useCallback(async (b) => {
    setSelectedBuild(b)
    const r = await fetch(`/api/builds/${b.id}`)
    setSelectedBuildDetail(await r.json())
  }, [])

  useEffect(() => {
    loadBuilds()
    fetch('/api/config').then(r => r.json()).then(cfg => setVatMode(cfg.vat_mode ?? 'inc_vat')).catch(() => {})
    const onVatChanged = e => setVatMode(e.detail)
    window.addEventListener('pc:vat-changed', onVatChanged)
    return () => window.removeEventListener('pc:vat-changed', onVatChanged)
  }, [loadBuilds])

  function openCreateBuild() {
    setNewBuildName('')
    setNewBuildDesc('')
    setShowCreateBuild(true)
  }

  async function submitCreateBuild() {
    if (!newBuildName) return
    const r = await post('/api/builds', { name: newBuildName, description: newBuildDesc })
    const b = await r.json()
    setShowCreateBuild(false)
    showToast(`✅ Build "${b.name}" created`)
    await loadBuilds()
    await selectBuild(b)
  }

  async function deleteBuild(b) {
    if (!confirm(`Delete build "${b.name}"? The tracked components will remain in your watchlist.`)) return
    await fetch(`/api/builds/${b.id}`, { method: 'DELETE' })
    if (selectedBuild?.id === b.id) {
      setSelectedBuild(null)
      setSelectedBuildDetail(null)
    }
    showToast(`🗑️ Build "${b.name}" deleted`)
    await loadBuilds()
  }

  async function openAddToBuild() {
    setAddToBuildCid('')
    setAddToBuildQty(1)
    try {
      const r = await fetch('/api/components')
      setComponents(await r.json())
    } catch { setComponents([]) }
    setShowAddToBuild(true)
  }

  async function submitAddToBuild() {
    if (!addToBuildCid || !selectedBuild) return
    await post(`/api/builds/${selectedBuild.id}/items`, { component_id: parseInt(addToBuildCid), quantity: parseInt(addToBuildQty) })
    setShowAddToBuild(false)
    await Promise.all([selectBuild(selectedBuild), loadBuilds()])
    showToast('✅ Component added to build')
  }

  async function removeFromBuild(item) {
    await fetch(`/api/builds/${selectedBuild.id}/items/${item.component_id}`, { method: 'DELETE' })
    await Promise.all([selectBuild(selectedBuild), loadBuilds()])
    showToast('🗑️ Component removed from build')
  }

  function closeOnBackdrop(setShow) {
    return (e) => { if (e.target === e.currentTarget) setShow(false) }
  }

  return (
    <div className="space-y-5">
      <Toast toast={toast} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-base-content">PC Builds</h2>
        <button onClick={openCreateBuild} className="btn btn-primary btn-sm">+ New Build</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {builds.map(b => (
          <div
            key={b.id}
            onClick={() => selectBuild(b)}
            className={`rounded-xl border cursor-pointer transition-all ${
              selectedBuild?.id === b.id ? 'border-primary bg-base-200' : 'border-base-300 bg-base-200 hover:border-base-content/30'
            }`}
          >
            <div className="p-4">
              <h3 className="font-semibold text-base-content truncate">{b.name}</h3>
              {b.description && <p className="text-xs text-base-content/50 mt-0.5 truncate">{b.description}</p>}
              <div className="mt-3">
                <div className="text-2xl font-bold text-base-content">
                  {b.total_cost > 0 ? fmtPrice(b.total_cost, 'GBP', vatMode) : '—'}
                </div>
                <div className="text-xs text-base-content/50 mt-0.5">
                  {b.item_count} component{b.item_count !== 1 ? 's' : ''}
                </div>
                {b.missing_prices > 0 && (
                  <div className="text-xs text-warning mt-0.5">⚠️ {b.missing_prices} missing prices</div>
                )}
              </div>
            </div>
            <div className="px-4 pb-3 flex gap-3 border-t border-base-300 pt-2">
              <button onClick={e => { e.stopPropagation(); deleteBuild(b) }} className="text-xs text-error hover:text-error/70">
                Delete
              </button>
              <a onClick={e => e.stopPropagation()} href={`/api/export?type=build&format=csv&id=${b.id}`} className="text-xs text-base-content/60 hover:text-base-content/70">
                CSV
              </a>
              <a onClick={e => e.stopPropagation()} href={`/api/export?type=build&format=json&id=${b.id}`} className="text-xs text-base-content/60 hover:text-base-content/70">
                JSON
              </a>
            </div>
          </div>
        ))}
        {builds.length === 0 && (
          <div className="col-span-3 py-12 text-center text-base-content/40">
            No builds yet. Click "+ New Build" to get started.
          </div>
        )}
      </div>

      {selectedBuildDetail && (
        <div className="bg-base-200 rounded-xl border border-base-300">
          <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
            <h3 className="font-semibold text-base-content">{selectedBuildDetail.build.name}</h3>
            <div className="flex items-center gap-4">
              <div className="text-xl font-bold text-base-content">{fmtPrice(selectedBuildDetail.totalCost ?? 0, 'GBP', vatMode)}</div>
              <button onClick={openAddToBuild} className="btn btn-primary btn-sm">+ Add Component</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra w-full">
              <thead className="border-b border-base-300">
                <tr className="text-xs text-base-content/50 uppercase text-left">
                  <th>Component</th>
                  <th>Cat.</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Line Total</th>
                  <th>Retailer</th>
                  <th>Stock</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-300/50">
                {(selectedBuildDetail.items ?? []).map(item => {
                  const bp = selectedBuildDetail.bestPrices[item.component_id]
                  return (
                    <tr key={item.component_id} className="hover:bg-base-300/20">
                      <td className="font-medium text-base-content">{item.component_name}</td>
                      <td><span className="badge badge-ghost badge-sm">{item.component_category}</span></td>
                      <td className="text-base-content/70">{item.quantity}</td>
                      <td className="text-base-content/70">{bp ? fmtPrice(bp.price, bp.currency, vatMode) : '—'}</td>
                      <td className="font-medium text-base-content">{bp ? fmtPrice(bp.price * item.quantity, bp.currency, vatMode) : '—'}</td>
                      <td className="text-base-content/70 text-xs">{bp?.retailer ?? '—'}</td>
                      <td>{bp ? '✅' : '—'}</td>
                      <td><button onClick={() => removeFromBuild(item)} className="text-xs text-error hover:text-error/70">Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreateBuild && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeOnBackdrop(setShowCreateBuild)}>
          <div className="bg-base-200 rounded-xl border border-base-300 w-full max-w-sm p-6">
            <h3 className="font-semibold text-lg text-base-content mb-4">New PC Build</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-base-content/60 block mb-1">Build Name *</label>
                <input
                  value={newBuildName}
                  onChange={e => setNewBuildName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitCreateBuild() }}
                  type="text" placeholder="e.g. Gaming Rig 2025"
                  className="w-full input input-bordered"
                />
              </div>
              <div>
                <label className="text-xs text-base-content/60 block mb-1">Description (optional)</label>
                <input
                  value={newBuildDesc}
                  onChange={e => setNewBuildDesc(e.target.value)}
                  type="text" placeholder="Budget build, workstation…"
                  className="w-full input input-bordered"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={submitCreateBuild} className="btn btn-primary flex-1">Create</button>
              <button onClick={() => setShowCreateBuild(false)} className="btn btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showAddToBuild && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeOnBackdrop(setShowAddToBuild)}>
          <div className="bg-base-200 rounded-xl border border-base-300 w-full max-w-sm p-6">
            <h3 className="font-semibold text-lg text-base-content mb-4">Add Component to Build</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-base-content/60 block mb-1">Tracked Component</label>
                <select value={addToBuildCid} onChange={e => setAddToBuildCid(e.target.value)} className="select select-bordered w-full">
                  <option value="">Select…</option>
                  {components.map(c => <option key={c.id} value={c.id}>[{c.id}] {c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-base-content/60 block mb-1">Quantity</label>
                <input value={addToBuildQty} onChange={e => setAddToBuildQty(e.target.value)} type="number" min="1" className="w-28 input input-bordered" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={submitAddToBuild} className="btn btn-primary flex-1">Add</button>
              <button onClick={() => setShowAddToBuild(false)} className="btn btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
