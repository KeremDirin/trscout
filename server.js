const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// ─── SERPER: Genel arama ─────────────────────────────────────────────────────
async function searchWithSerper(query) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' })
  });
  if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
  const data = await response.json();
  return data.organic || [];
}

// ─── SERPER: Startup'ın resmi sitesini bul ───────────────────────────────────
async function findOfficialWebsite(startupName) {
  try {
    const results = await searchWithSerper(`${startupName} official website`);
    // İlk organik sonucu al, haber/wiki/crunchbase gibi siteleri atla
    const blocklist = ['crunchbase', 'linkedin', 'techcrunch', 'wikipedia',
      'pitchbook', 'tracxn', 'wellfound', 'twitter', 'facebook', 'instagram'];
    const official = results.find(r => {
      const url = (r.link || '').toLowerCase();
      return !blocklist.some(b => url.includes(b));
    });
    return official ? official.link : null;
  } catch {
    return null;
  }
}

// ─── İki aşamalı startup araması ─────────────────────────────────────────────
async function fetchStartupData(sectorLabel) {
  const q1 = `"raised" "million" "seed" OR "series A" ${sectorLabel} startup 2024 2025 site:techcrunch.com`;
  const q2 = `${sectorLabel} startup "series A" OR "seed round" funded 2024 2025 -site:crunchbase.com -site:wikipedia.org`;

  const [r1, r2] = await Promise.all([
    searchWithSerper(q1).catch(() => []),
    searchWithSerper(q2).catch(() => [])
  ]);

  const seen = new Set();
  return [...r1, ...r2].filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  }).slice(0, 12);
}

// ─── ANA ROUTE ────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { sector, momentum, barrier } = req.query;

  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY eksik' });
  if (!process.env.SERPER_API_KEY)
    return res.status(500).json({ success: false, error: 'SERPER_API_KEY eksik' });

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
    console.log(`[SEARCH] ${results.length} sonuç bulundu`);

    if (results.length < 3) {
      return res.status(422).json({
        success: false,
        error: 'Yeterli arama sonucu bulunamadı. Lütfen farklı filtreler deneyin.'
      });
    }

    const searchData = results.map((r, i) => ({
      index: i + 1,
      title: r.title || '',
      snippet: r.snippet || '',
      url: r.link || ''
    }));

    // AŞAMA 2: Claude analiz yapsın, URL üretmesin — sadece isim döndürsün
    const systemPrompt = `Sen bir startup veri analiz motorusun.

KESİN KURALLAR:
1. SADECE verilen JSON'daki title veya snippet'larda geçen gerçek şirket adlarını kullan.
2. Kendi eğitim verisinden HİÇBİR şirket adı üretemezsin.
3. url alanını BOŞ BIRAK — sistem bunu otomatik dolduracak.
4. Yanıtın SADECE geçerli JSON array olacak. Başka metin YOK.`;

    const userPrompt = `Aşağıdaki CANLI WEB ARAMA SONUÇLARI JSON'unu analiz et.

CANLI ARAMA VERİSİ:
${JSON.stringify(searchData, null, 2)}

FİLTRELER:
- Sektör: ${sectorLabel}
- Momentum: ${momentumFilter || 'herhangi'}
- Bariyer: ${barrierFilter || 'herhangi'}

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

    const rawText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = rawText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);

    if (!match) throw new Error('JSON parse hatası — tekrar deneyin');

    let startups;
    try {
      startups = JSON.parse(match[0]);
    } catch {
      throw new Error('Yanıt formatı hatalı — tekrar deneyin');
    }

    // Validasyon
    const valid = startups.filter(s =>
      s.name && s.name.length > 2 &&
      !s.name.toLowerCase().includes('startup adı') &&
      s.trScore >= 1 && s.trScore <= 10
    );

    if (valid.length === 0) throw new Error('Geçerli startup bulunamadı — filtreleri değiştirip tekrar deneyin');

    // AŞAMA 3: Her startup için resmi site araması (paralel)
    console.log(`[URL LOOKUP] ${valid.length} startup için resmi site aranıyor...`);
    await Promise.all(
      valid.map(async (s) => {
        s.regulatoryRisk = autoReg;
        const officialUrl = await findOfficialWebsite(s.name);
        s.url = officialUrl || '';
        console.log(`[URL] ${s.name} → ${s.url || 'bulunamadı'}`);
      })
    );

    console.log(`[SUCCESS] ${valid.length} startup döndürüldü`);
    res.json({ success: true, data: valid });

  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`TRScout çalışıyor: http://localhost:${PORT}`));
