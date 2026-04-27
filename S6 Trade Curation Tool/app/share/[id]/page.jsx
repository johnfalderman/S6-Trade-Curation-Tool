import { getStore } from '@netlify/blobs';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function loadShare(id) {
  if (!id || !/^[A-Za-z0-9_-]{4,32}$/.test(id)) return null;
  try {
    const store = getStore('shares');
    const raw = await store.get(id, { type: 'text' });
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('loadShare failed:', e?.message);
    return null;
  }
}

function absUrl(u) {
  if (!u) return '';
  return u.startsWith('/') ? 'https://society6.com' + u : u;
}

function ShareCard({ item }) {
  const productUrl = absUrl(item.product_url);
  const imageUrl = absUrl(item.image_url);
  return (
    <a
      href={productUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-gray-900 transition-colors"
    >
      <div className="bg-gray-100 aspect-square overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.image_alt || item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs text-center px-2">
            {item.title}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium text-gray-900 leading-tight line-clamp-2">{item.title}</div>
        {item.reason && (
          <div className="text-xs text-gray-500 mt-1 italic line-clamp-2">{item.reason}</div>
        )}
        <div className="text-xs text-red-600 mt-2 font-medium group-hover:text-red-800">View on Society6 {'->'}</div>
      </div>
    </a>
  );
}

function Section({ title, description, items }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mb-12">
      <div className="border-b border-gray-200 pb-2 mb-5 flex items-baseline justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">{title}</h2>
        <span className="text-xs text-gray-400">{items.length} pieces</span>
      </div>
      {description && <p className="text-sm text-gray-500 mb-4">{description}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {items.map(item => (
          <ShareCard key={item.product_url} item={item} />
        ))}
      </div>
    </section>
  );
}

export async function generateMetadata(props) {
  const params = await props.params;
  const data = await loadShare(params.id);
  if (!data) return { title: 'Curation Not Found — Society6' };
  const parts = [data.brief.projectName, data.brief.clientName].filter(Boolean);
  const title = parts.length ? `${parts.join(' — ')} | Society6 Curation` : 'Society6 Curation';
  return {
    title,
    description: data.brief.briefSummary || 'A curated selection from Society6.',
  };
}

export default async function SharePage(props) {
  const params = await props.params;
  const data = await loadShare(params.id);
  if (!data) notFound();

  const { brief, primary, accent, galleryWallSets } = data;
  const totalItems =
    (primary?.length || 0) +
    (accent?.length || 0) +
    (galleryWallSets || []).reduce((n, s) => n + (s.items?.length || 0), 0);

  return (
    <div className="max-w-6xl mx-auto -mt-8">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-lg px-8 py-10 mb-10">
        <div className="text-xs uppercase tracking-widest text-red-400 mb-2">Society6 Curation</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
          {brief.projectName || 'Curated Selection'}
        </h1>
        {brief.clientName && (
          <div className="text-lg text-gray-300 mb-3">For {brief.clientName}</div>
        )}
        {brief.location && <div className="text-sm text-gray-400 mb-4">{brief.location}</div>}
        {brief.briefSummary && (
          <p className="text-gray-200 max-w-2xl leading-relaxed">{brief.briefSummary}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-5">
          {(brief.styleTags || []).slice(0, 6).map(t => (
            <span key={t} className="text-xs bg-white/10 border border-white/20 rounded-full px-2.5 py-1">{t}</span>
          ))}
          {(brief.paletteTags || []).slice(0, 4).map(t => (
            <span key={t} className="text-xs bg-red-600/20 border border-red-400/40 rounded-full px-2.5 py-1 text-red-200">{t}</span>
          ))}
        </div>
        <div className="text-xs text-gray-400 mt-6">{totalItems} curated pieces</div>
      </div>

      <Section title="Primary Collection" items={primary} />
      <Section title="Accent & Alternates" items={accent} />

      {(galleryWallSets || []).map(set => (
        <Section
          key={set.setNumber}
          title={`Gallery Wall — Set ${set.setNumber}${set.theme ? ` · ${set.theme}` : ''}`}
          items={set.items}
        />
      ))}

      <div className="border-t border-gray-200 pt-6 mt-12 text-center text-xs text-gray-400">
        Curated via the Society6 Curation Tool · All product links open on society6.com
      </div>
    </div>
  );
}
