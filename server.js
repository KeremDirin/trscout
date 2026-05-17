const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

app.get('/api/search', async (req, res) => {
  const { sector, stage, capital, founder } = req.query;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key bulunamadı' });
  }

  const client = new Anthropic({ apiKey });

  const sectorLabel = sector || 'fintech, ecommerce, saas, healthtech, edtech, ai, lojistik, proptech';
  const stageLabel = stage || 'seed, series a, series b';

  const capitalFilter = capital === 'bootstrap'
    ? 'Başlangıç sermayesi $0-10K arasında olmalı, tek kişi bile başlatabilmeli.'
    : capital === 'low'
    ? 'Başlangıç sermayesi $10K-100K arasında olmalı, küçük ekiple yapılabilmeli.'
    : capital === 'mid'
    ? 'Başlangıç sermayesi $100K+ olabilir, yatırım gerektirebilir.'
    : '';

  const founderFilter = founder === 'solo'
    ? 'Solo founder veya 1-2 kişilik ekiple yapılabilecek bir model olmalı.'
    : founder === 'small'
    ? '2-3 kişilik küçük bir ekiple yapılabilecek bir model olmalı.'
    : founder === 'large'
    ? 'Daha büyük bir ekip ve kaynak gerektiren bir model olabilir.'
    : '';

  const prompt = `Sen Türkiye odaklı venture araştırmacısısın. Amerika'da yatırım almış, Türkiye'de henüz iyi uygulanmamış 5 startup bul ve analiz et.

Sektör: ${sectorLabel}
Aşama: ${stageLabel}
${capitalFilter}
${founderFilter}

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
    "difficulty": "Kolay",
    "difficultyDetail": "Zorluk detayı (Türkçe, 2 cümle)",
    "capitalNeeded": "$10K–50K",
    "founderType": "Solo founder",
    "revenueModel": "Gelir modeli (Türkçe, 2 cümle)",
    "url": "https://example.com"
  }
]`;

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
