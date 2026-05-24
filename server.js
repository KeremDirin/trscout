const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

async function searchStartups(query) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' })
  });
  const data = await response.json();
  return data.organic || [];
}

app.get('/api/search', async (req, res) => {
  const { sector, momentum, barrier } = req.query;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'API key bulunamadı' });
  if (!process.env.SERPER_API_KEY) return res.status(500).json({ success: false, error: 'Serper key bulunamadı' });

  const client = new Anthropic({ apiKey });

  const sectorLabel = sector || 'fintech ecommerce saas healthtech edtech ai logistics proptech';

  const momentumMap = {
    'proven': 'proven in USA, no strong competitor in Turkey yet',
    'pioneer': 'very early stage globally, pioneer opportunity',
    'moving': 'Turkey market just starting, last entry window'
  };

  const barrierMap = {
    'open': 'low barrier, solo founder can build MVP quickly',
    'mid': 'medium barrier, needs network or tech advantage',
    'fortress': 'high barrier, requires license or large capital but protected market'
  };

  const momentumFilter = momentum ? momentumMap[momentum] : '';
  const barrierFilter = barrier ? barrierMap[barrier] : '';

  try {
    // Serper ile güncel startup haberleri çek
    const searchQuery = `${sectorLabel} startup "seed funding" OR "series A" 2024 2025 site:techcrunch.com OR site:crunchbase.com`;
    console.log('Searching:', searchQuery);
    
    const searchResults = await searchStartups(searchQuery);
    
    const searchContext = searchResults
      .slice(0, 8)
      .map(r => `- ${r.title}: ${r.snippet} (${r.link})`)
      .join('\n');

    console.log('Search results found:', searchResults.length);

    // Regülasyon riski sektöre göre otomatik
    const regRiskBySector = {
      'fintech': 'yüksek', 'healthtech': 'yüksek',
      'ecommerce': 'orta', 'logistics': 'orta',
      'saas': 'düşük', 'ai': 'düşük', 'edtech': 'düşük',
      'proptech': 'orta', 'gaming': 'düşük', 'hrtech': 'düşük'
    };
    const autoReg = regRiskBySector[sector] || 'orta';

    const prompt = `Sen Türkiye odaklı venture araştırmacısısın. Aşağıdaki güncel web arama sonuçlarını kullanarak Amerika'da yatırım almış, Türkiye'de henüz iyi uygulanmamış 5 startup bul ve analiz et.

GÜNCEL WEB ARAMA SONUÇLARI:
${searchContext}

Filtreler:
- Sektör: ${sectorLabel}
- Momentum: ${momentumFilter || 'herhangi'}
- Bariyer: ${barrierFilter || 'herhangi'}

Bu arama sonuçlarındaki gerçek startupları kullan. Eğer sonuçlarda yeterli startup yoksa bildiğin güncel örnekleri ekle.

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:

[
  {
    "name": "Startup adı",
    "sector": "Sektör (Türkçe)",
    "stage": "Seed — $2M",
    "oneLiner": "Ne yaptığı (max 10 kelime)",
    "whatItDoes": "İş modeli (Türkçe, 2-3 cümle)",
    "trOpportunity": "Türkiye fırsatı (Türkçe, 2-3 cümle)",
    "trRisk": "En büyük risk (Türkçe, 1 cümle)",
    "trScore": 8,
    "competitor": "Türk rakibi veya Henüz güçlü rakip yok",
    "marketSize": "Türkiye pazar büyüklüğü, rakam ver (Türkçe, 1 cümle)",
    "momentum": "Amerika kanıtladı",
    "momentumDetail": "Neden şimdi (Türkçe, 1-2 cümle)",
    "barrier": "Açık pazar",
    "barrierDetail": "Sermaye ve ekip gereksinimi (Türkçe, 1-2 cümle)",
    "revenueModel": "Abonelik",
    "revenueDetail": "Gelir detayı (Türkçe, 1-2 cümle)",
    "hype": "sessiz",
    "url": "https://example.com"
  }
]

momentum: "Amerika kanıtladı", "Dünyada da yeni", "Tren hareket etti"
barrier: "Açık pazar", "Orta bariyer", "Kaleli pazar"
revenueModel: "Abonelik", "Marketplace", "Finansal ürün", "Doğrudan satış"
hype: "sessiz", "yükselen", "zirve"`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = textBlocks.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Sonuç alınamadı, tekrar deneyin');

    const startups = JSON.parse(match[0]);
    startups.forEach(s => s.regulatoryRisk = autoReg);

    res.json({ success: true, data: startups });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`TRScout çalışıyor: http://localhost:${PORT}`));
