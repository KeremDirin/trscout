const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

app.get('/api/search', async (req, res) => {
  const { sector, momentum, barrier } = req.query;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'API key bulunamadı' });

  const client = new Anthropic({ apiKey });

  const sectorLabel = sector || 'fintech, ecommerce, saas, healthtech, edtech, ai, lojistik, proptech';

  const momentumMap = {
    'proven': 'Amerika\'da kanıtlanmış, Türkiye\'de henüz güçlü rakip yok — şu an girmek için ideal pencere',
    'pioneer': 'Dünyada da erken aşamada, Türkiye\'de sıfır rakip — öncü olmak için fırsat, yüksek risk yüksek ödül',
    'moving': 'Türkiye\'de hareket başladı, 1-2 oyuncu var — hızlı hareket edilmesi gereken son pencere'
  };

  const barrierMap = {
    'open': 'Giriş bariyeri düşük — hızlı MVP yapılabilir, teknik altyapı minimal, solo founder uygun',
    'mid': 'Orta bariyer — network veya teknoloji avantajı şart, 2-3 kişilik ekip gerekli',
    'fortress': 'Yüksek bariyer — lisans, regülasyon veya büyük sermaye gerekli, ama bu yüzden korunaklı'
  };

  const momentumFilter = momentum ? `Pazar momentumu kriteri: ${momentumMap[momentum]}` : '';
  const barrierFilter = barrier ? `Giriş bariyeri kriteri: ${barrierMap[barrier]}` : '';

  // Auto regulatory risk by sector
  const regRiskBySector = {
    'fintech': 'yüksek', 'healthtech': 'yüksek',
    'ecommerce': 'orta', 'logistics': 'orta',
    'saas': 'düşük', 'ai': 'düşük', 'edtech': 'düşük',
    'proptech': 'orta', 'gaming': 'düşük', 'hrtech': 'düşük'
  };
  const autoReg = regRiskBySector[sector] || null;

  const prompt = `Sen Türkiye odaklı venture araştırmacısısın. Amerika'da yatırım almış, Türkiye'de henüz iyi uygulanmamış 5 startup bul ve analiz et.

Sektör: ${sectorLabel}
${momentumFilter}
${barrierFilter}

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma, markdown kullanma:

[
  {
    "name": "Startup adı",
    "sector": "Sektör (Türkçe, kısa)",
    "stage": "Seed — $2M",
    "oneLiner": "Ne yaptığı (max 10 kelime)",
    "whatItDoes": "İş modeli açıklaması (Türkçe, 2-3 cümle)",
    "trOpportunity": "Türkiye fırsatı (Türkçe, 2-3 cümle)",
    "trRisk": "En büyük risk (Türkçe, 1 cümle)",
    "trScore": 8,
    "competitor": "Türk rakibi veya Henüz güçlü rakip yok",
    "marketSize": "Türkiye pazar büyüklüğü, rakam ver (Türkçe, 1 cümle)",
    "momentum": "Amerika kanıtladı",
    "momentumDetail": "Zamanlama açıklaması neden şimdi (Türkçe, 1-2 cümle)",
    "barrier": "Açık pazar",
    "barrierDetail": "Giriş bariyeri detayı, sermaye ve ekip (Türkçe, 1-2 cümle)",
    "revenueModel": "Abonelik",
    "revenueDetail": "Gelir modeli detayı (Türkçe, 1-2 cümle)",
    "hype": "sessiz",
    "url": "https://example.com"
  }
]

momentum alanı için: "Amerika kanıtladı", "Dünyada da yeni", "Tren hareket etti"
barrier alanı için: "Açık pazar", "Orta bariyer", "Kaleli pazar"
revenueModel alanı için: "Abonelik", "Marketplace", "Finansal ürün", "Doğrudan satış"
hype alanı için: "sessiz", "yükselen", "zirve"`;

  try {
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

    // Auto-inject regulatory risk if sector known
    if (autoReg) startups.forEach(s => s.regulatoryRisk = autoReg);
    else startups.forEach(s => { if (!s.regulatoryRisk) s.regulatoryRisk = 'orta'; });

    res.json({ success: true, data: startups });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`TRScout çalışıyor: http://localhost:${PORT}`));
