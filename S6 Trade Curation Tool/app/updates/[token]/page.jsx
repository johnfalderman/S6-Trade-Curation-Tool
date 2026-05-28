'use client';

import { useState, useEffect } from 'react';

const MAX_CHARS = 300;

const STATUS_OPTIONS = [
  { value: 'Green', emoji: '🟢', label: 'Green', color: '#2a7a4f' },
  { value: 'Yellow', emoji: '🟡', label: 'Yellow', color: '#b8860b' },
  { value: 'Red', emoji: '🔴', label: 'Red', color: '#c0392b' },
];

export default function UpdatesPage({ params }) {
  const { token } = params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ownerName, setOwnerName] = useState('');
  const [initiatives, setInitiatives] = useState([]);
  const [updates, setUpdates] = useState({});
  const [statuses, setStatuses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch(`/api/updates/form-data/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid link');
        setOwnerName(data.ownerName);
        setInitiatives(data.initiatives);
        const initialUpdates = {};
        const initialStatuses = {};
        data.initiatives.forEach(i => {
          initialUpdates[i.rowIndex] = '';
          initialStatuses[i.rowIndex] = i.status || 'Yellow';
        });
        setUpdates(initialUpdates);
        setStatuses(initialStatuses);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [token]);

  function handleTextChange(rowIndex, value) {
    if (value.length > MAX_CHARS) return;
    setUpdates(prev => ({ ...prev, [rowIndex]: value }));
  }

  function handleStatusChange(rowIndex, value) {
    setStatuses(prev => ({ ...prev, [rowIndex]: value }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload = initiatives.map(i => ({
        rowIndex: i.rowIndex,
        initiative: i.initiative,
        currentNotes: i.currentNotes,
        currentStatus: i.status || 'Yellow',
        update: updates[i.rowIndex] || '',
        newStatus: statuses[i.rowIndex] || i.status,
      })).filter(i => i.update.trim() || i.newStatus !== i.currentStatus);

      if (!payload.length) {
        alert('Please add at least one update or status change before submitting.');
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/updates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, updates: payload }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setSubmitCount(data.updated);
      setSubmitted(true);
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Shell><LoadingState /></Shell>;
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (submitted) return <Shell><SuccessState ownerName={ownerName} count={submitCount} /></Shell>;

  return (
    <Shell>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.logo}>S6</div>
          <div>
            <h1 style={styles.title}>Weekly Check-In</h1>
            <p style={styles.subtitle}>
              Hey {ownerName} — add a quick update on each initiative below. Keep it short (max 300 chars). You can also update the status. Julie and Sara see this Monday morning.
            </p>
          </div>
        </div>

        {initiatives.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>You're all caught up — no stale initiatives right now. Nice work.</p>
          </div>
        ) : (
          <div style={styles.initiativeList}>
            {initiatives.map((initiative) => {
              const textValue = updates[initiative.rowIndex] || '';
              const currentStatus = statuses[initiative.rowIndex] || initiative.status || 'Yellow';
              const remaining = MAX_CHARS - textValue.length;
              const isNearLimit = remaining < 50;

              return (
                <div key={initiative.rowIndex} style={styles.card}>
                  <div style={styles.metaRow}>
                    <span style={styles.pillarTag}>{initiative.pillar}</span>
                    {initiative.targetDate && (
                      <span style={styles.dateTag}>Due {initiative.targetDate}</span>
                    )}
                  </div>
                  <div style={styles.initiativeName}>{initiative.initiative}</div>
                  {initiative.currentNotes ? (
                    <div style={styles.lastUpdate}>
                      <span style={styles.lastUpdateLabel}>Last update: </span>
                      <span style={styles.lastUpdateText}>{getLastEntry(initiative.currentNotes)}</span>
                    </div>
                  ) : (
                    <div style={styles.noUpdate}>No previous update on record.</div>
                  )}
                  <div style={styles.statusRow}>
                    <span style={styles.statusLabel}>Status</span>
                    <div style={styles.statusButtons}>
                      {STATUS_OPTIONS.map(opt => {
                        const isSelected = currentStatus === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => handleStatusChange(initiative.rowIndex, opt.value)}
                            style={{
                              ...styles.statusBtn,
                              backgroundColor: isSelected ? opt.color : 'transparent',
                              color: isSelected ? '#fff' : '#666',
                              borderColor: isSelected ? opt.color : '#ddd',
                            }}
                          >
                            {opt.emoji} {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={styles.inputWrapper}>
                    <textarea
                      style={styles.textarea}
                      placeholder="What's the latest? (e.g. 'Launch on track for 5/30, final QA in progress')"
                      value={textValue}
                      onChange={(e) => handleTextChange(initiative.rowIndex, e.target.value)}
                      rows={3}
                    />
                    <div style={{ ...styles.charCount, color: isNearLimit ? '#e05c2a' : '#999' }}>
                      {remaining} chars left
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {initiatives.length > 0 && (
          <div style={styles.submitRow}>
            <button
              style={{ ...styles.submitButton, opacity: submitting ? 0.6 : 1 }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Saving...' : 'Submit Updates →'}
            </button>
            <p style={styles.submitNote}>Only items you've changed will be saved.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}

function getLastEntry(notes) {
  if (!notes) return '';
  const entries = notes.split(/(?=\d{1,2}\/\d{1,2}(?:\/\d{2,4})?:)/g).filter(e => e.trim());
  return entries[entries.length - 1]?.trim() || '';
}

function Shell({ children }) {
  return <div style={styles.shell}>{children}</div>;
}

function LoadingState() {
  return (
    <div style={styles.stateContainer}>
      <p style={styles.stateText}>Loading your initiatives...</p>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div style={styles.stateContainer}>
      <div style={styles.errorIcon}>!</div>
      <h2 style={styles.stateTitle}>This link isn't valid</h2>
      <p style={styles.stateText}>
        {message === 'Invalid or expired link'
          ? 'This link has expired or already been used. Check your email for a fresh one on Friday.'
          : message}
      </p>
    </div>
  );
}

function SuccessState({ ownerName, count }) {
  return (
    <div style={styles.stateContainer}>
      <div style={styles.successIcon}>✓</div>
      <h2 style={styles.stateTitle}>Updates saved</h2>
      <p style={styles.stateText}>
        Thanks {ownerName} — {count} item{count !== 1 ? 's' : ''} updated in the tracker. Julie and Sara will see everything Monday morning.
      </p>
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
  title: {
    margin: '0 0 8px 0',
    fontSize: '28px',
    fontWeight: 'normal',
    color: '#1a1a1a',
    letterSpacing: '-0.5px',
  },
  subtitle: { margin: 0, fontSize: '15px', color: '#555', lineHeight: '1.6' },
  initiativeList: { display: 'flex', flexDirection: 'column', gap: '24px' },
  card: { backgroundColor: '#fff', border: '1px solid #e0ddd8', padding: '24px' },
  metaRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' },
  pillarTag: {
    fontSize: '11px',
    fontFamily: "'Courier New', monospace",
    color: '#666',
    backgroundColor: '#f0ede8',
    padding: '2px 8px',
    letterSpacing: '0.5px',
  },
  dateTag: {
    fontSize: '11px',
    fontFamily: "'Courier New', monospace",
    color: '#666',
    backgroundColor: '#f0ede8',
    padding: '2px 8px',
  },
  initiativeName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: '12px',
    lineHeight: '1.3',
  },
  lastUpdate: {
    marginBottom: '16px',
    fontSize: '13px',
    color: '#777',
    lineHeight: '1.5',
    padding: '10px 12px',
    backgroundColor: '#f9f7f4',
    borderLeft: '3px solid #ddd',
  },
  lastUpdateLabel: { fontWeight: 'bold', color: '#999' },
  lastUpdateText: { color: '#555' },
  noUpdate: {
    marginBottom: '16px',
    fontSize: '13px',
    color: '#aaa',
    fontStyle: 'italic',
    padding: '10px 12px',
    backgroundColor: '#f9f7f4',
    borderLeft: '3px solid #eee',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  statusLabel: {
    fontSize: '12px',
    fontFamily: "'Courier New', monospace",
    color: '#999',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  statusButtons: { display: 'flex', gap: '8px' },
  statusBtn: {
    padding: '5px 14px',
    fontSize: '13px',
    fontFamily: "'Georgia', serif",
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  inputWrapper: { position: 'relative' },
  textarea: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    fontFamily: "'Georgia', serif",
    border: '1px solid #ddd',
    backgroundColor: '#fafafa',
    color: '#1a1a1a',
    lineHeight: '1.5',
    resize: 'vertical',
    boxSizing: 'border-box',
    outline: 'none',
  },
  charCount: {
    textAlign: 'right',
    fontSize: '12px',
    fontFamily: "'Courier New', monospace",
    marginTop: '4px',
  },
  submitRow: {
    marginTop: '40px',
    paddingTop: '32px',
    borderTop: '1px solid #e0ddd8',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    flexWrap: 'wrap',
  },
  submitButton: {
    backgroundColor: '#1a1a1a',
    color: '#f9f7f4',
    border: 'none',
    padding: '14px 32px',
    fontSize: '15px',
    fontFamily: "'Georgia', serif",
    cursor: 'pointer',
    letterSpacing: '0.3px',
  },
  submitNote: { margin: 0, fontSize: '13px', color: '#999' },
  emptyState: { padding: '40px', textAlign: 'center', border: '1px dashed #ccc' },
  emptyText: { color: '#666', fontSize: '16px' },
  stateContainer: { maxWidth: '480px', margin: '80px auto', textAlign: 'center', padding: '0 20px' },
  stateTitle: { fontSize: '24px', fontWeight: 'normal', color: '#1a1a1a', marginBottom: '12px' },
  stateText: { fontSize: '16px', color: '#555', lineHeight: '1.6' },
  successIcon: {
    width: '56px', height: '56px', backgroundColor: '#1a1a1a', color: '#f9f7f4',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '24px', margin: '0 auto 24px',
  },
  errorIcon: {
    width: '56px', height: '56px', backgroundColor: '#e05c2a', color: '#fff',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '28px', fontWeight: 'bold', margin: '0 auto 24px',
  },
};
