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
3. Textos para "whatsapp" e "telegram". ELES DEVEM SEGUIR EXATAMENTE ESTE FORMATO (com as quebras de linha e emojis, preenchendo os dados reais):
[Nome do Produto]

🔥 Por: R$ [Preço]

🛒 Link de compra: [Link]

[Breve mensagem persuasiva]

Todas as ofertas são válidas por tempo limitado!

Atenção: NÃO é necessário gerar texto ou legenda para o Instagram. Deixe o campo "instagram" como uma string vazia "".

Responda APENAS em JSON com esta estrutura exata:
{
  "title": "...",
  "description": "...",
  "whatsapp": "...",
  "telegram": "...",
  "instagram": ""
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    response_format: { type: 'json_object' },
  });

  let content = completion.choices[0].message.content;
  if (!content) throw new Error('Resposta vazia da IA');

  content = content.replace(/```json/gi, '').replace(/```/g, '').trim();

  let generatedData: GeneratedOffer;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      generatedData = JSON.parse(match[0]) as GeneratedOffer;
    } else {
      generatedData = JSON.parse(content) as GeneratedOffer;
    }
  } catch (e) {
    console.error('Erro ao fazer parse do JSON da IA:', e);
    throw new Error('Resposta da IA inválida ou mal formatada.');
  }

  return generatedData;
}

export interface ChatMessage {
  role: 'user' | 'system' | 'assistant';
  content: { text: string }[];
}

export async function chatFlow(messages: ChatMessage[]): Promise<string> {
  let promptText = `Você é um assistente inteligente e amigável da plataforma Pegue a Promo (uma ferramenta para top afiliados que ajuda a gerar textos persuasivos, encurtar links e gerenciar ofertas). Responda sempre em português brasileiro, de forma direta, prestativa e use emojis.\n\nHistórico da Conversa:\n`;

  messages.forEach((msg) => {
    const roleName = msg.role === 'user' ? 'Usuário' : 'Assistente';
    const textContent = msg.content && msg.content[0] ? msg.content[0].text : '';
    promptText += `${roleName}: ${textContent}\n\n`;
  });

  promptText += `Assistente: `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: promptText }],
    temperature: 0.7,
  });

  return completion.choices[0].message.content || '';
}
