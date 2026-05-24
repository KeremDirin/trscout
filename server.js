const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

app.get('/api/search', async (req, res) => {
  const { sector, timing, revenueModel } = req.query;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key bulunamadı' });
  }

  const client = new Anthropic({ apiKey });

  const sectorLabel = sector || 'fintech, ecommerce, saas, healthtech, edtech, ai, lojistik, proptech';

  const timingMap = {
    'seed': 'Dünya yeni keşfetti, Türkiye henüz bilmiyor — çok erken dönem fırsat',
    'golden': 'Amerika\'da kanıtlandı, Türkiye\'de henüz güçlü rakip yok — şu an girmek için ideal zaman',
    'last': 'Türkiye\'de 1-2 oyuncu başladı, hızlı hareket edilmesi gereken son fırsat penceresi',
    'late': 'Türkiye pazarı olgunlaşmış, büyük oyuncular var'
  };

  const revenueMap = {
    'subscription': 'Abonelik (SaaS) — aylık/yıllık recurring gelir modeli',
    'marketplace': 'Marketplace — her işlemden komisyon alan platform modeli',
    'financial': 'Finansal ürün — kredi, sigorta veya yatırım odaklı gelir modeli',
    'direct': 'Doğrudan satış — ürün veya hizmet satışı'
  };

  const timingFilter = timing ? `Türkiye zamanlama kriteri: ${timingMap[timing]}` : '';
  const revenueFilter = revenueModel ? `Gelir modeli kriteri: ${revenueMap[revenueModel]}` : '';

  const prompt = `Sen Türkiye odaklı venture araştırmacısısın. Amerika'da yatırım almış, Türkiye'de henüz iyi uygulanmamış 5 startup bul ve analiz et.

Sektör: ${sectorLabel}
${timingFilter}
${revenueFilter}

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma, markdown kullanma:

[
  {
    "name": "Startup adı",
    "sector": "Sektör (Türkçe)",
    "stage": "Seed — $2M",
    "oneLiner": "Ne yaptığı (max 10 kelime)",
    "whatItDoes": "İş modeli açıklaması (Türkçe, 2-3 cümle)",
    "trOpportunity": "Türkiye fırsatı (Türkçe, 2-3 cümle)",
    "trRisk": "En büyük risk (Türkçe, 1 cümle)",
    "trScore": 8,
    "competitor": "Türk rakibi veya Henüz güçlü rakip yok",
    "marketSize": "Türkiye pazar büyüklüğü (Türkçe, 1 cümle)",
    "timing": "Tohum dönem",
    "timingDetail": "Zamanlama açıklaması (Türkçe, 1-2 cümle)",
    "revenueModel": "Abonelik",
    "revenueDetail": "Gelir modeli detayı (Türkçe, 2 cümle)",
    "regulatoryRisk": "düşük",
    "hype": "sessiz",
    "url": "https://example.com"
  }
]

timing alanı için şu değerlerden birini kullan: "Tohum dönem", "Altın pencere", "Son fırsat", "Geç kalındı"
revenueModel alanı için: "Abonelik", "Marketplace", "Finansal ürün", "Doğrudan satış"
regulatoryRisk alanı için: "düşük", "orta", "yüksek"
hype alanı için: "sessiz", "yükselen", "zirve"`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const textBlocks = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const clean = textBlocks.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);

    if (!match) {
      console.error('No JSON found. Response:', clean.substring(0, 500));
      throw new Error('Sonuç alınamadı, tekrar deneyin');
    }

    const startups = JSON.parse(match[0]);
    res.json({ success: true, data: startups });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`TRScout çalışıyor: http://localhost:${PORT}`);
});
