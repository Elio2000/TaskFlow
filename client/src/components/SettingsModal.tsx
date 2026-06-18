import { useState } from 'react'
import { Icon } from '../icons'
import { getByokConfig, setByokConfig } from '../utils/byok'
import { PROVIDERS, getProvider } from '../providers'

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px',
  fontSize: 13.5, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', marginBottom: 14,
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const init = getByokConfig()
  const [providerId, setProviderId] = useState(init.providerId)
  const [key, setKey] = useState(init.key)
  const [model, setModel] = useState(init.model)
  const [baseUrl, setBaseUrl] = useState(init.baseUrl)

  const provider = getProvider(providerId)
  const save = () => { setByokConfig({ providerId, key, model, baseUrl }); onClose() }

  const onProviderChange = (id: string) => {
    setProviderId(id)
    // Default the model to the new provider's first suggestion so non-DeepSeek requests
    // never go out with an empty/wrong model id.
    setModel(getProvider(id).models[0] || '')
  }

  return (
    <div className="modal-scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card" style={{ maxWidth: 440, marginTop: '12vh', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>AI 设置</span>
          <button className="btn-icon" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.5 }}>
          BYOK：用你自己的模型服务和额度。支持任何 OpenAI 兼容的接口（含本地模型）。
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>模型服务商</div>
        <select value={providerId} onChange={e => onProviderChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        {provider.custom && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>Base URL <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>（OpenAI 兼容）</span></div>
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:8000/v1"
              style={{ ...inputStyle, fontFamily: 'var(--mono)' }} />
          </>
        )}

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
          API Key {provider.keyless && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>（本地服务无需 Key，可留空）</span>}
        </div>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={provider.keyless ? '可留空' : 'sk-...'} autoFocus={!provider.keyless}
          style={{ ...inputStyle, fontFamily: 'var(--mono)' }} />

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>模型</div>
        <input value={model} onChange={e => setModel(e.target.value)} list="byok-model-suggestions" placeholder={provider.models[0] || '填写模型 id'}
          style={inputStyle} />
        <datalist id="byok-model-suggestions">
          {provider.models.map(m => <option key={m} value={m} />)}
        </datalist>

        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.5 }}>
          🔒 Key 只保存在本浏览器（localStorage），不会上传到服务器数据库或 Git；AI 请求通过本地后端转发。
          {provider.keyHint && <><br />还没有 Key？到 <span style={{ fontFamily: 'var(--mono)' }}>{provider.keyHint}</span> 申请。</>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
