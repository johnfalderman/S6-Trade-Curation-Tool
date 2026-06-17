'use client';

import { useEffect, useState } from 'react';

const STATUS_COLORS = {
  'High Risk': '#dc2626',
  'Low Risk': '#f59e0b',
  'On Track': '#16a34a',
  'Not Started': '#94a3b8',
  'A New Proposal': '#6366f1',
  'No status set': '#cbd5e1',
};

export default function SummaryPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/updates/summary')
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d);
        else setError(d.error || 'Failed to load');
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.errorBox}>Error loading summary: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.page}>
        <div style={styles.muted}>Loading planning summary…</div>
      </div>
    );
  }

  const hasLastWeek = !!data.lastWeek;

  // Merge this/last week status into rows for the grouped bar chart
  const statusLabels = data.thisWeek.statusData.map(s => s.label);
  const lastByLabel = {};
  if (hasLastWeek) {
    for (const s of data.lastWeek.statusData) lastByLabel[s.label] = s.count;
  }
  const maxStatus = Math.max(
    1,
    ...data.thisWeek.statusData.map(s => s.count),
    ...(hasLastWeek ? data.lastWeek.statusData.map(s => s.count) : [0])
  );

  const maxPeople = Math.max(1, ...data.people.map(p => p.count));

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Planning Hub — Summary</h1>
        <p style={styles.sub}>
          {data.initiativeCount} active initiatives · week {data.thisWeek.week}
        </p>
      </div>

      <section style={styles.card}>
        <h2 style={styles.h2}>Initiatives by Status</h2>
        <p style={styles.note}>
          {hasLastWeek
            ? `Comparing this week (${data.thisWeek.week}) with last recorded week (${data.lastWeek.week}).`
            : 'This is the first recorded week — last-week comparison will appear once a new week is captured.'}
        </p>

        <div style={styles.legend}>
          <span style={styles.legendItem}>
            <span style={{ ...styles.swatch, background: '#334155' }} /> This week
          </span>
          {hasLastWeek && (
            <span style={styles.legendItem}>
              <span style={{ ...styles.swatch, background: '#cbd5e1' }} /> Last week
            </span>
          )}
        </div>

        <div style={styles.chart}>
          {data.thisWeek.statusData.map(s => {
            const thisH = (s.count / maxStatus) * 160;
            const lastVal = hasLastWeek ? (lastByLabel[s.label] || 0) : null;
            const lastH = hasLastWeek ? (lastVal / maxStatus) * 160 : 0;
            const color = STATUS_COLORS[s.label] || '#334155';
            return (
              <div key={s.label} style={styles.barGroup}>
                <div style={styles.bars}>
                  {hasLastWeek && (
                    <div style={styles.barWrap}>
                      <span style={styles.barCount}>{lastVal}</span>
                      <div style={{ ...styles.bar, height: lastH, background: '#cbd5e1' }} />
                    </div>
                  )}
                  <div style={styles.barWrap}>
                    <span style={styles.barCount}>{s.count}</span>
                    <div style={{ ...styles.bar, height: thisH, background: color }} />
                  </div>
                </div>
                <div style={styles.barLabel}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>People — Initiatives Involved In</h2>
        <p style={styles.note}>
          Counted from the People column. Includes teams and vendors as their own entries.
        </p>

        <div style={styles.peopleList}>
          {data.people.map(p => (
            <div key={p.label} style={styles.peopleRow}>
              <div style={styles.peopleName}>{p.label}</div>
              <div style={styles.peopleBarTrack}>
                <div style={{ ...styles.peopleBar, width: `${(p.count / maxPeople) * 100}%` }} />
              </div>
              <div style={styles.peopleCount}>{p.count}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const styles = {
  page: { maxWidth: 860, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1e293b' },
  header: { marginBottom: 24 },
  h1: { fontSize: 26, fontWeight: 700, margin: 0 },
  sub: { color: '#64748b', marginTop: 6, fontSize: 14 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, marginBottom: 24 },
  h2: { fontSize: 18, fontWeight: 600, margin: '0 0 4px' },
  note: { color: '#64748b', fontSize: 13, margin: '0 0 20px' },
  legend: { display: 'flex', gap: 18, marginBottom: 12, fontSize: 13, color: '#475569' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3, display: 'inline-block' },
  chart: { display: 'flex', alignItems: 'flex-end', gap: 16, height: 220, paddingTop: 10, overflowX: 'auto' },
  barGroup: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 90 },
  bars: { display: 'flex', alignItems: 'flex-end', gap: 6, height: 180 },
  barWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: 28, borderRadius: '4px 4px 0 0', transition: 'height 0.3s' },
  barCount: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#334155' },
  barLabel: { fontSize: 12, color: '#475569', marginTop: 8, textAlign: 'center', lineHeight: 1.2 },
  peopleList: { display: 'flex', flexDirection: 'column', gap: 10 },
  peopleRow: { display: 'flex', alignItems: 'center', gap: 12 },
  peopleName: { width: 130, fontSize: 13, textAlign: 'right', color: '#334155', flexShrink: 0 },
  peopleBarTrack: { flex: 1, background: '#f1f5f9', borderRadius: 5, height: 22, overflow: 'hidden' },
  peopleBar: { height: '100%', background: '#6366f1', borderRadius: 5, transition: 'width 0.3s' },
  peopleCount: { width: 28, fontSize: 13, fontWeight: 600, color: '#334155', flexShrink: 0 },
  muted: { color: '#64748b' },
  errorBox: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 16, borderRadius: 8, fontSize: 14 },
};
