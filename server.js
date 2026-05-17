const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/api/search', async (req, res) => {
  const { sector, stage, capital, founder } = req.query;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const sectorLabel = sector || 'fintech, ecommerce, saas, healthtech, edtech, ai, lojistik, proptech';
  const stageLabel = stage || 'seed, series a, series b';
  const capitalLabel = capital || 'herhangi';
  const founderLabel = founder || 'herhangi';

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

  const prompt = `Sen deneyimli bir Türkiye odaklı venture araştırmacısısın. Amerika'da yatırım almış, Türkiye'de henüz iyi uygulanmamış startup modellerini araştırıp analiz ediyorsun.

Görev: ${sectorLabel} sektöründe, ${stageLabel} aşamasında, son 1-2 yılda yatırım almış ve Türkiye'de uygulanabilecek 5 gerçek startup bul.

Önemli filtreler:
${capitalFilter}
${founderFilter}

Her startup için şu alanları doldur:
- name: Startup'ın gerçek adı
- sector: Sektör (Türkçe, kısa)
- stage: Yatırım turu ve tutarı (ör: "Series A — $12M")
- oneLiner: Ne yaptığı (Türkçe, max 12 kelime)
- whatItDoes: Detaylı açıklama — iş modeli, nasıl para kazanıyor, müşterisi kim (Türkçe, 3-4 cümle)
- trOpportunity: Türkiye'de neden büyük fırsat var (Türkçe, 3-4 cümle)
- trRisk: En kritik engel (Türkçe, 1-2 cümle)
- trScore: Türkiye uygunluk skoru 1-10 (sadece tam sayı)
- competitor: Türkiye'deki mevcut rakip (yoksa "Henüz güçlü rakip yok")
- marketSize: Türkiye pazar büyüklüğü bu sektörde, TAM rakamı dolar cinsinden (Türkçe, 1-2 cümle)
- difficulty: Zorluk seviyesi — "Kolay", "Orta" veya "Zor"
- difficultyDetail: Zorluk açıklaması — gereken sermaye, ekip büyüklüğü, teknik gereksinimler (Türkçe, 2-3 cümle)
- capitalNeeded: Tahmini başlangıç sermayesi dolar cinsinden (ör: "$5K–20K", "$50K–200K", "$500K+")
- founderType: Kimler yapabilir (ör: "Solo founder", "2-3 kişilik ekip", "Büyük ekip + yatırım")
- revenueModel: Türkiye'de nasıl para kazanılır (Türkçe, 2-3 cümle)
- url: Startup websitesi URL'i

SADECE geçerli JSON döndür, başka hiçbir şey yazma:
[{"name":"...","sector":"...","stage":"...","oneLiner":"...","whatItDoes":"...","trOpportunity":"...","trRisk":"...","trScore":8,"competitor":"...","marketSize":"...","difficulty":"Orta","difficultyDetail":"...","capitalNeeded":"...","founderType":"...","revenueModel":"...","url":"..."}]`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });

    const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = textBlocks.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON parse hatası');
    const startups = JSON.parse(match[0]);
    res.json({ success: true, data: startups });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`TRScout çalışıyor: http://localhost:${PORT}`);
});
