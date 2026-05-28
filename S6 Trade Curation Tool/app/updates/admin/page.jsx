'use client';

import { useState } from 'react';

export default function UpdatesAdminPage() {
  const [secret, setSecret] = useState('');
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(null);

  function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    setLog(prev => [...prev, { msg, type, time }]);
  }

  async function trigger(endpoint, label) {
    if (!secret) {
      addLog('Enter your admin secret first.', 'error');
      return;
    }
    setLoading(endpoint);
    addLog(`Triggering ${label}...`);
    try {
      const res = await fetch(`/api/updates/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secret,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addLog(`✓ ${label} complete: ${JSON.stringify(data, null, 2)}`, 'success');
    } catch (err) {
      addLog(`✗ Error: ${err.message}`, 'error');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={styles.shell}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.logo}>S6</div>
          <div>
            <h1 style={styles.title}>Updates Admin</h1>
            <p style={styles.subtitle}>Manually trigger Friday sends and Monday digests for testing.</p>
          </div>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Admin Secret</label>
          <input
            type="password"
            style={styles.input}
            placeholder="Enter ADMIN_SECRET value"
            value={secret}
            onChange={e => setSecret(e.target.value)}
          />
        </div>

        <div style={styles.buttonRow}>
          <ActionButton
            label="Send Friday Emails"
            description="Reads sheet, finds stale items, emails each owner their form link."
            onClick={() => trigger('send-friday', 'Friday Send')}
            loading={loading === 'send-friday'}
          />
          <ActionButton
            label="Send Monday Digest"
            description="Reads latest notes from sheet, emails digest to Julie + Sara."
            onClick={() => trigger('send-monday', 'Monday Digest')}
            loading={loading === 'send-monday'}
          />
        </div>

        {log.length > 0 && (
          <div style={styles.logBox}>
            <div style={styles.logHeader}>Log</div>
            {log.map((entry, i) => (
              <div key={i} style={{
                ...styles.logEntry,
                color: entry.type === 'error' ? '#e05c2a' : entry.type === 'success' ? '#2a7a4f' : '#555',
              }}>
                <span style={styles.logTime}>{entry.time}</span>
                <pre style={styles.logMsg}>{entry.msg}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ label, description, onClick, loading }) {
  return (
    <div style={styles.actionCard}>
      <div style={styles.actionLabel}>{label}</div>
      <div style={styles.actionDesc}>{description}</div>
      <button
        style={{ ...styles.button, opacity: loading ? 0.6 : 1 }}
        onClick={onClick}
        disabled={loading}
      >
        {loading ? 'Running...' : 'Trigger →'}
      </button>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: '100vh',
    backgroundColor: '#f9f7f4',
    fontFamily: "'Georgia', 'Times New Roman', serif",
    padding: '40px 20px',
  },
  container: { maxWidth: '640px', margin: '0 auto' },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '20px',
    marginBottom: '40px',
    paddingBottom: '32px',
    borderBottom: '2px solid #1a1a1a',
  },
  logo: {
    width: '48px',
    height: '48px',
    backgroundColor: '#1a1a1a',
    color: '#f9f7f4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '16px',
    letterSpacing: '1px',
    flexShrink: 0,
    marginTop: '4px',
  },
  title: { margin: '0 0 8px 0', fontSize: '28px', fontWeight: 'normal', color: '#1a1a1a' },
  subtitle: { margin: 0, fontSize: '15px', color: '#555' },
  section: { marginBottom: '32px' },
  label: {
    display: 'block',
    fontSize: '12px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '1px',
    color: '#999',
    marginBottom: '8px',
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    fontFamily: "'Courier New', monospace",
    border: '1px solid #ddd',
    backgroundColor: '#fff',
    color: '#1a1a1a',
    boxSizing: 'border-box',
    outline: 'none',
  },
  buttonRow: { display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '40px' },
  actionCard: { backgroundColor: '#fff', border: '1px solid #e0ddd8', padding: '24px' },
  actionLabel: { fontSize: '17px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '6px' },
  actionDesc: { fontSize: '14px', color: '#666', marginBottom: '16px', lineHeight: '1.5' },
  button: {
    backgroundColor: '#1a1a1a',
    color: '#f9f7f4',
    border: 'none',
    padding: '10px 24px',
    fontSize: '14px',
    fontFamily: "'Georgia', serif",
    cursor: 'pointer',
  },
  logBox: { backgroundColor: '#fff', border: '1px solid #e0ddd8', padding: '20px' },
  logHeader: {
    fontSize: '12px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '1px',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: '12px',
  },
  logEntry: { marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start' },
  logTime: { fontSize: '12px', fontFamily: "'Courier New', monospace", color: '#bbb', flexShrink: 0, paddingTop: '2px' },
  logMsg: { margin: 0, fontSize: '13px', fontFamily: "'Courier New', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
};
