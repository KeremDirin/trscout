const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// ─── [Lead Architect] ROOT DOMAIN TEMİZLEYİCİ ───────────────────────────────
function cleanDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// ─── [Data Engineer] GELİŞMİŞ REGEX YIL FİLTRESİ ────────────────────────────
// Kural:
//   - Metindeki tüm 4 haneli yılları (20xx) çıkar
//   - En büyük yıl 2024'ten küçükse → saf dışı bırak (eski haber)
//   - En büyük yıl >= 2024 ise → dahil et (güncel)
//   - Hiç yıl yoksa → riske girme, dahil et (tarihsiz haberler de geçerli olabilir)
function filterFreshResults(results) {
  const CUTOFF_YEAR = 2024;
  const YEAR_REGEX = /\b(20\d{2})\b/g;

  return results.filter(item => {
    const text = `${item?.title || ''} ${item?.snippet || ''}`;
    const matches = [...text.matchAll(YEAR_REGEX)];

    // Hiç yıl bulunamadıysa dahil et
    if (matches.length === 0) return true;

    const years = matches.map(m => parseInt(m[1], 10));
    const maxYear = Math.max(...years);

    // En büyük yıl cutoff'tan küçükse eski haber — ele
    const isPast = maxYear < CUTOFF_YEAR;
    if (isPast) {
      console.log(`[FILTER] Elendi (max yil: ${maxYear}): ${item?.title?.substring(0, 60) || ''}`);
    }
    return !isPast;
  });
}

// ─── SERPER: Genel arama ─────────────────────────────────────────────────────
async function searchWithSerper(query) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY || '',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' })
  });
  if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
  const data = await response.json();
  return data?.organic || [];
}

// ─── SERPER: Startup'ın resmi sitesini bul ───────────────────────────────────
async function findOfficialWebsite(startupName) {
  if (!startupName) return '';
  try {
    const results = await searchWithSerper(`${startupName} official website`);
    const blocklist = [
      'crunchbase', 'linkedin', 'techcrunch', 'wikipedia',
      'pitchbook', 'tracxn', 'wellfound', 'twitter', 'facebook',
      'instagram', 'youtube', 'bloomberg', 'forbes', 'businesswire'
    ];
    const official = results.find(r => {
      const url = (r?.link || '').toLowerCase();
      return url && !blocklist.some(b => url.includes(b));
    });
    // [Lead Architect] Root domain temizle
    return cleanDomain(official?.link || '');
  } catch {
    return '';
  }
}

// ─── İki aşamalı startup araması ─────────────────────────────────────────────
async function fetchStartupData(sectorLabel) {
  const q1 = `"raised" "million" "seed" OR "series A" ${sectorLabel} startup 2024 2025 site:techcrunch.com`;
  const q2 = `${sectorLabel} startup "series A" OR "seed round" funded 2024 2025 -site:crunchbase.com -site:wikipedia.org`;

  const [r1, r2] = await Promise.allSettled([
    searchWithSerper(q1),
    searchWithSerper(q2)
  ]);

  const combined = [
    ...(r1.status === 'fulfilled' ? r1.value : []),
    ...(r2.status === 'fulfilled' ? r2.value : [])
  ];

  // Deduplicate
  const seen = new Set();
  const unique = combined.filter(item => {
    const link = item?.link || '';
    if (!link || seen.has(link)) return false;
    seen.add(link);
    return true;
  });

  // [Data Engineer] Tarih filtresi — 2024 öncesini bedavaya ayıkla
  const fresh = filterFreshResults(unique);
  console.log(`[FILTER] ${unique.length} sonuçtan ${fresh.length} taze kaldı`);

  return fresh.slice(0, 12);
}

// ─── ANA ROUTE ────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { sector, momentum, barrier } = req.query;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY eksik' });
  }
  if (!process.env.SERPER_API_KEY) {
    return res.status(500).json({ success: false, error: 'SERPER_API_KEY eksik' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const sectorLabel = sector || 'fintech ecommerce saas healthtech edtech ai logistics proptech hrtech';

  const momentumMap = {
    proven: 'proven in USA, no strong competitor in Turkey yet — ideal entry window',
    pioneer: 'very early stage globally, pioneer opportunity, high risk high reward',
    moving: 'Turkey market just starting, 1-2 players appeared, last entry window'
  };
  const barrierMap = {
    open: 'low barrier, solo founder MVP possible in weeks',
    mid: 'medium barrier, network or tech advantage required',
    fortress: 'high barrier — license or large capital needed, but highly protected market'
  };

  const momentumFilter = momentumMap[momentum] || '';
  const barrierFilter = barrierMap[barrier] || '';

  const regMap = {
    fintech: 'yüksek', healthtech: 'yüksek',
    ecommerce: 'orta', logistics: 'orta', proptech: 'orta',
    saas: 'düşük', ai: 'düşük', edtech: 'düşük', gaming: 'düşük', hrtech: 'düşük'
  };
  const autoReg = regMap[sector] || 'orta';

  try {
    // AŞAMA 1: Serper'dan taze veri çek
    console.log(`[SEARCH] Sector: ${sectorLabel}`);
    const results = await fetchStartupData(sectorLabel);
    console.log(`[SEARCH] ${results.length} taze sonuç bulundu`);

    // [QA] Kibar fallback: yeterli sonuç yoksa çökme, kullanıcıya bildir
    if (results.length < 3) {
      return res.status(422).json({
        success: false,
        error: 'Bu filtrelerle yeterli güncel startup bulunamadı. Lütfen farklı filtreler deneyin.'
      });
    }

    // [QA] Optional chaining ile güvenli veri hazırlama
    const searchData = results.map((r, i) => ({
      index: i + 1,
      title: r?.title || '',
      snippet: r?.snippet || '',
      url: r?.link || ''
    }));

    // AŞAMA 2: Claude analiz — strict system prompt
    const systemPrompt = `Sen bir startup veri analiz motorusun.

KESİN KURALLAR:
1. SADECE verilen JSON'daki title veya snippet'larda geçen gerçek şirket adlarını kullan.
2. Kendi eğitim verisinden HİÇBİR şirket adı üretemezsin.
3. url alanını BOŞ BIRAK — sistem otomatik dolduracak.
4. Savunma, askeri, government-only, DoD contractor şirketleri kesinlikle dahil etme.
5. Yanıtın SADECE geçerli JSON array olacak. Başka metin YOK.`;

    const userPrompt = `Aşağıdaki CANLI WEB ARAMA SONUÇLARI JSON'unu analiz et.

CANLI ARAMA VERİSİ:
${JSON.stringify(searchData, null, 2)}

FİLTRELER:
- Sektör: ${sectorLabel}
- Momentum: ${momentumFilter || 'herhangi'}
- Bariyer: ${barrierFilter || 'herhangi'}
- HARİÇ TUT: savunma, askeri, government-only, silah teknolojisi, DoD contractor

Bu verilerden Türkiye için en uygun 5 şirketi seç ve analiz et:

[
  {
    "name": "Gerçek şirket adı (arama verisinden)",
    "sector": "Sektör Türkçe",
    "stage": "Yatırım turu — tutar",
    "oneLiner": "Ne yaptığı max 10 kelime Türkçe",
    "whatItDoes": "İş modeli Türkçe 2-3 cümle",
    "trOpportunity": "Türkiye fırsatı Türkçe 2-3 cümle",
    "trRisk": "En büyük risk Türkçe 1 cümle",
    "trScore": 8,
    "competitor": "Türk rakibi veya Henüz güçlü rakip yok",
    "marketSize": "Türkiye pazar büyüklüğü rakam ver Türkçe 1 cümle",
    "momentum": "Amerika kanıtladı",
    "momentumDetail": "Neden şimdi Türkçe 1-2 cümle",
    "barrier": "Açık pazar",
    "barrierDetail": "Sermaye ve ekip Türkçe 1-2 cümle",
    "revenueModel": "Abonelik",
    "revenueDetail": "Gelir detayı Türkçe 1-2 cümle",
    "hype": "sessiz",
    "url": ""
  }
]

momentum: "Amerika kanıtladı", "Dünyada da yeni", "Tren hareket etti"
barrier: "Açık pazar", "Orta bariyer", "Kaleli pazar"
revenueModel: "Abonelik", "Marketplace", "Finansal ürün", "Doğrudan satış"
hype: "sessiz", "yükselen", "zirve"`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    // [QA] Optional chaining ile güvenli response parse
    const rawText = (response?.content || [])
      .filter(b => b?.type === 'text')
      .map(b => b?.text || '')
      .join('');

    const clean = rawText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);

    if (!match) {
      console.error('[PARSE ERROR] Raw:', clean.substring(0, 300));
      // [QA] Kibar fallback
      return res.status(422).json({
        success: false,
        error: 'Analiz tamamlanamadı. Lütfen tekrar deneyin.'
      });
    }

    let startups;
    try {
      startups = JSON.parse(match[0]);
    } catch (parseErr) {
      console.error('[PARSE ERROR]', parseErr?.message || 'unknown');
      return res.status(422).json({
        success: false,
        error: 'Yanıt formatı hatalı. Lütfen tekrar deneyin.'
      });
    }

    // Validasyon
    const valid = startups.filter(s =>
      s?.name &&
      s.name.length > 2 &&
      !s.name.toLowerCase().includes('startup adı') &&
      s?.trScore >= 1 &&
      s?.trScore <= 10
    );

    if (valid.length === 0) {
      return res.status(422).json({
        success: false,
        error: 'Geçerli startup bulunamadı. Farklı filtreler deneyin.'
      });
    }

    // AŞAMA 3: Her startup için resmi site araması + domain temizliği
    console.log(`[URL LOOKUP] ${valid.length} startup için resmi site aranıyor...`);
    await Promise.all(
      valid.map(async (s) => {
        s.regulatoryRisk = autoReg;
        // [Lead Architect] cleanDomain ile temiz URL
        const officialUrl = await findOfficialWebsite(s?.name || '');
        s.url = officialUrl || '';
        console.log(`[URL] ${s.name} → ${s.url || 'bulunamadı'}`);
      })
    );

    console.log(`[SUCCESS] ${valid.length} startup döndürüldü`);
    res.json({ success: true, data: valid });

  } catch (err) {
    console.error('[ERROR]', err?.message || 'Bilinmeyen hata');
    // [QA] En dış katman kibar fallback
    res.status(500).json({
      success: false,
      error: 'Bir hata oluştu. Lütfen tekrar deneyin.'
    });
  }
});

app.listen(PORT, () => console.log(`TRScout çalışıyor: http://localhost:${PORT}`));
