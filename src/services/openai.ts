import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// OpenAI client — a API Key é lida do arquivo .env (OPENAI_API_KEY)
// Você precisará criar um arquivo .env na pasta /server com:
// OPENAI_API_KEY=sk-...
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface OfferInput {
  productName: string;
  currentPrice: string;
  oldPrice?: string;
  category?: string;
  platform?: string;
  affiliateLink?: string;
}

export interface GeneratedOffer {
  title: string;
  description: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
}

export async function generateOfferTexts(input: OfferInput): Promise<GeneratedOffer> {
  const discount = input.oldPrice && input.currentPrice
    ? Math.round(((parseFloat(input.oldPrice) - parseFloat(input.currentPrice)) / parseFloat(input.oldPrice)) * 100)
    : 0;

  const prompt = `Você é um especialista em marketing de afiliados brasileiro. 
Crie textos de divulgação para o seguinte produto:

Produto: ${input.productName}
Preço atual: R$ ${input.currentPrice}
${input.oldPrice ? `Preço antigo: R$ ${input.oldPrice} (${discount}% de desconto)` : ''}
${input.category ? `Categoria: ${input.category}` : ''}
${input.platform ? `Plataforma: ${input.platform}` : ''}
${input.affiliateLink ? `Link: ${input.affiliateLink}` : 'Link: [LINK_AFILIADO]'}

Crie:
1. Um título chamativo (máximo 80 caracteres)
2. Uma descrição curta e persuasiva (máximo 150 caracteres)
3. Texto para WhatsApp com emojis, formatação em negrito (*texto*) e destaque no preço
4. Texto para Telegram com formatação Markdown (**negrito**) e link clicável
5. Legenda para Instagram com emojis e hashtags relevantes (mínimo 10 hashtags)

Responda APENAS em JSON com esta estrutura exata:
{
  "title": "...",
  "description": "...",
  "whatsapp": "...",
  "telegram": "...",
  "instagram": "..."
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0].message.content;
  if (!content) throw new Error('Resposta vazia da IA');

  return JSON.parse(content) as GeneratedOffer;
}
