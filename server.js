const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// ─── SERPER: İki aşamalı arama ───────────────────────────────────────────────
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

async function fetchStartupData(sectorLabel, momentumFilter) {
  // Sorgu 1: TechCrunch'tan güncel yatırım haberleri
  const q1 = `"raised" "million" "seed" OR "series A" ${sectorLabel} startup 2024 2025 site:techcrunch.com`;
  // Sorgu 2: YC ve genel haberler
  const q2 = `${sectorLabel} startup "series A" OR "seed round" funded 2024 2025 -site:crunchbase.com -site:wikipedia.org`;

  const [r1, r2] = await Promise.all([
    searchWithSerper(q1).catch(() => []),
    searchWithSerper(q2).catch(() => [])
  ]);

  // Birleştir ve deduplicate et
  const seen = new Set();
  const combined = [...r1, ...r2].filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  return combined.slice(0, 12);
}

// ─── ANA ROUTE ────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { sector, momentum, barrier } = req.query;

  // Env kontrolleri
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

  // Regülasyon riski sektöre göre otomatik
  const regMap = {
    fintech: 'yüksek', healthtech: 'yüksek',
    ecommerce: 'orta', logistics: 'orta', proptech: 'orta',
    saas: 'düşük', ai: 'düşük', edtech: 'düşük', gaming: 'düşük', hrtech: 'düşük'
  };
  const autoReg = regMap[sector] || 'orta';

  try {
    // 1. Serper'dan taze veri çek
    console.log(`[SEARCH] Sector: ${sectorLabel} | Momentum: ${momentumFilter}`);
    const results = await fetchStartupData(sectorLabel, momentumFilter);
    console.log(`[SEARCH] ${results.length} sonuç bulundu`);

    // 2. Güvenlik: Yeterli sonuç yoksa dur
    if (results.length < 3) {
      return res.status(422).json({
        success: false,
        error: 'Yeterli arama sonucu bulunamadı. Lütfen farklı filtreler deneyin.'
      });
    }

    // 3. Serper verilerini yapılandırılmış formata çevir
    const searchData = results.map((r, i) => ({
      index: i + 1,
      title: r.title || '',
      snippet: r.snippet || '',
      url: r.link || ''
    }));

    const searchDataJSON = JSON.stringify(searchData, null, 2);

    // 4. Claude'a strict system prompt ile gönder
    const systemPrompt = `Sen bir startup veri analiz motorusun. Görevin: sana verilen JSON arama verilerindeki şirketleri Türkiye pazarı için analiz etmek.

KESİN KURALLAR:
1. SADECE verilen JSON'daki title veya snippet'larda geçen gerçek şirket adlarını kullan.
2. Kendi eğitim verisinden HİÇBİR şirket adı üretemezsin, ekleyemezsin.
3. URL olarak MUTLAKA verilen JSON'daki "url" alanını kullan. Şirketin kendi sitesini biliyorsan onu da ekleyebilirsin ama uyduramazsın.
4. Eğer JSON'da yeterli gerçek şirket bulamazsan, gerçekten bulunan kadarını döndür (minimum 2).
5. Yanıtın SADECE geçerli JSON array olacak. Açıklama, özür veya başka metin YOK.`;

    const userPrompt = `Aşağıdaki CANLI WEB ARAMA SONUÇLARI JSON'unu analiz et. Bu sonuçlardaki gerçek şirketleri Türkiye fırsat radarı perspektifinden değerlendir.

CANLI ARAMA VERİSİ:
${searchDataJSON}

FİLTRELER:
- Sektör: ${sectorLabel}
- Momentum kriteri: ${momentumFilter || 'herhangi'}
- Bariyer kriteri: ${barrierFilter || 'herhangi'}

Yukarıdaki JSON verilerinde geçen gerçek şirketlerden Türkiye için en uygun 5 tanesini seç. Her biri için şu alanları doldur:

[
  {
    "name": "Arama verisindeki gerçek şirket adı",
    "sector": "Sektör Türkçe",
    "stage": "Yatırım turu — tutar (arama verisinden çıkar)",
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
    "url": "arama verisindeki url alanından al"
  }
]

momentum değerleri: "Amerika kanıtladı", "Dünyada da yeni", "Tren hareket etti"
barrier değerleri: "Açık pazar", "Orta bariyer", "Kaleli pazar"
revenueModel değerleri: "Abonelik", "Marketplace", "Finansal ürün", "Doğrudan satış"
hype değerleri: "sessiz", "yükselen", "zirve"`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    // 5. Response parse
    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const clean = rawText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);

    if (!match) {
      console.error('[PARSE ERROR] Raw:', clean.substring(0, 300));
      throw new Error('JSON parse hatası — tekrar deneyin');
    }

    let startups;
    try {
      startups = JSON.parse(match[0]);
    } catch (parseErr) {
      console.error('[PARSE ERROR]', parseErr.message);
      throw new Error('Yanıt formatı hatalı — tekrar deneyin');
    }

    // 6. Validasyon: Boş veya geçersiz kayıtları filtrele
    const valid = startups.filter(s =>
      s.name &&
      s.name.length > 2 &&
      !s.name.toLowerCase().includes('startup adı') &&
      s.trScore >= 1 && s.trScore <= 10
    );

    if (valid.length === 0) {
      throw new Error('Geçerli startup bulunamadı — filtreleri değiştirip tekrar deneyin');
    }

    // 7. Regülasyon riskini otomatik ata
    valid.forEach(s => { s.regulatoryRisk = autoReg; });

    console.log(`[SUCCESS] ${valid.length} geçerli startup döndürüldü`);
    res.json({ success: true, data: valid });

  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`TRScout çalışıyor: http://localhost:${PORT}`));
