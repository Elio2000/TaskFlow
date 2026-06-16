import { useState } from 'react'
import { Icon } from '../icons'
import { getByokConfig, setByokConfig } from '../utils/byok'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const init = getByokConfig()
  const [key, setKey] = useState(init.key)
  const [model, setModel] = useState(init.model)
  const save = () => { setByokConfig({ key, model }); onClose() }

  return (
    <div className="modal-scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card" style={{ maxWidth: 440, marginTop: '14vh', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>AI 设置</span>
          <button className="btn-icon" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.5 }}>
          本应用使用你自己的 DeepSeek API Key（BYOK），用自己的额度。
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>DeepSeek API Key</div>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-..." autoFocus
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13.5, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', marginBottom: 14, fontFamily: 'var(--mono)' }} />

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>模型 <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>（可选）</span></div>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="deepseek-chat（留空用默认）"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13.5, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', marginBottom: 14 }} />

        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.5 }}>
          🔒 Key 只保存在本浏览器（localStorage），不会上传到服务器数据库或 Git；AI 请求通过 HTTPS 携带。
          <br />还没有 Key？到 <span style={{ fontFamily: 'var(--mono)' }}>platform.deepseek.com</span> 申请。
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
