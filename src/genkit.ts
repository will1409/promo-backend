import { genkit, z } from 'genkit';
import { db } from './config/firebase';

// Inicializa o Genkit de forma limpa, sem carregar plugins de rede de terceiros
const ai = genkit({});

export const OfferInputSchema = z.object({
  productName: z.string(),
  currentPrice: z.string(),
  oldPrice: z.string().optional(),
  category: z.string().optional(),
  platform: z.string().optional(),
  affiliateLink: z.string().optional(),
  userId: z.string().optional(),
});

export const OfferOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  whatsapp: z.string(),
  telegram: z.string(),
  instagram: z.string(),
});

// Fluxo que gera as ofertas
export const generateOfferFlow = ai.defineFlow({
  name: 'generateOfferFlow',
  inputSchema: OfferInputSchema,
  outputSchema: OfferOutputSchema,
}, async (input) => {
  const discount = input.oldPrice && input.currentPrice
    ? Math.round(((parseFloat(input.oldPrice) - parseFloat(input.currentPrice)) / parseFloat(input.oldPrice)) * 100)
    : 0;

  const prompt = `Você é um especialista em marketing de afiliados brasileiro. 
Crie textos de divulgação para o seguinte produto:

Produto: ${input.productName}
Preço atual: R$ ${input.currentPrice}
${input.oldPrice ? `Preço antigo: R$ ${input.oldPrice} (${discount}% de desconto)` : ''}
${input.affiliateLink ? `Link: ${input.affiliateLink}` : 'Link: [LINK_AFILIADO]'}

Regras IMPORTANTÍSSIMAS:
1. USE APENAS OS DADOS FORNECIDOS ACIMA.
2. NÃO INVENTE características, benefícios ou especificações que não estejam contidas no nome do produto.
3. O preço, desconto e nome do produto devem ser EXATAMENTE os fornecidos. Se algo estiver em branco, não preencha nem invente.

Crie:
1. Um título chamativo (máximo 80 caracteres)
2. Uma descrição curta e persuasiva (máximo 150 caracteres)
3. Textos para "whatsapp" e "telegram". ELES DEVEM SEGUIR EXATAMENTE ESTE FORMATO (com as quebras de linha e emojis, preenchendo os dados reais):
[Nome do Produto]

🔥 Por: R$ [Preço]

🛒 Link de compra: [Link]

[Breve mensagem persuasiva]

Todas as ofertas são válidas por tempo limitado!
4. Legenda para Instagram com emojis e hashtags relevantes (mínimo 10 hashtags)

Responda usando a estrutura fornecida.`;

  const groqKey = process.env.GROQ_API_KEY;
  const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqKey || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Você é um assistente de marketing que sempre responde estritamente com um objeto JSON válido correspondendo ao esquema solicitado.' },
        { role: 'user', content: prompt + '\nRetorne no formato JSON com as seguintes chaves: title (string), description (string), whatsapp (string), telegram (string), instagram (string).' }
      ],
      response_format: { type: "json_object" },
      temperature: 0.8
    })
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(`Erro na API do Groq: Status ${chatRes.status} - ${errText}`);
  }

  const responseJson = await chatRes.json();
  const content = responseJson.choices?.[0]?.message?.content;
  if (!content) throw new Error('Falha ao gerar oferta com Groq (resposta vazia).');

  let generatedData: any = {};
  try {
    generatedData = JSON.parse(content);
  } catch (e) {
    console.error('Erro ao fazer parse do JSON da IA:', e);
    throw new Error('Resposta da IA inválida ou mal formatada.');
  }

  const outputData = {
    title: generatedData.title || input.productName || "",
    description: generatedData.description || "",
    whatsapp: generatedData.whatsapp || "",
    telegram: generatedData.telegram || "",
    instagram: generatedData.instagram || "",
  };

  // Salva no banco de dados se houver userId
  if (input.userId && db) {
    try {
      await db.collection('offers').add({
        userId: input.userId,
        ...input,
        ...outputData,
        clicks: 0,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Falha ao salvar no Firestore (possível falta de credenciais):', e);
    }
  }

  return outputData;
});

// Tipagem para mensagens de chat
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'model', 'system']),
  content: z.array(z.object({ text: z.string() })),
});

// Fluxo para o Chatbot
export const chatFlow = ai.defineFlow({
  name: 'chatFlow',
  inputSchema: z.array(ChatMessageSchema),
  outputSchema: z.string(),
}, async (messages) => {
  let promptText = `Você é um assistente inteligente e amigável da plataforma Pegue a Promo (uma ferramenta para top afiliados que ajuda a gerar textos persuasivos, encurtar links e gerenciar ofertas). Responda sempre em português brasileiro, de forma direta, prestativa e use emojis.\n\nHistórico da Conversa:\n`;

  messages.forEach((msg) => {
    const roleName = msg.role === 'user' ? 'Usuário' : 'Assistente';
    promptText += `${roleName}: ${msg.content[0].text}\n\n`;
  });

  promptText += `Assistente: `;

  const groqKey = process.env.GROQ_API_KEY;
  const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqKey || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: promptText }
      ],
      temperature: 0.7
    })
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(`Erro na API do Groq: Status ${chatRes.status} - ${errText}`);
  }

  const responseJson = await chatRes.json();
  const text = responseJson.choices?.[0]?.message?.content || '';
  return text;
});

export const CreativeInputSchema = z.object({
  linkUrl: z.string(),
  finalUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  htmlContent: z.string().optional(),
});

export const CreativeOutputSchema = z.object({
  productName: z.string().default(""),
  description: z.string().default(""),
  price: z.string().default(""),
  oldPrice: z.string().default(""),
  imageUrl: z.string().default(""),
});

export const generateCreativeFlow = ai.defineFlow({
  name: 'generateCreativeFlow',
  inputSchema: CreativeInputSchema,
  outputSchema: CreativeOutputSchema,
}, async (input) => {
  const prompt = `Você é um redator de marketing. Seu único objetivo é ler os dados brutos de um produto e retornar um JSON estrito.
NÃO TENTE inventar valores, use estritamente os dados fornecidos.

Dados Originais:
Título: ${input.pageTitle || ''}
Descrição: ${input.htmlContent || ''}
Preço: ${input.linkUrl || ''} // Usando linkUrl como transporte do preço no bypass

Sua missão é criar uma legenda persuasiva e copiar o preço e imagem exatos.
Você DEVE retornar APENAS um objeto JSON exatamente com a estrutura abaixo:

{
  "productName": "título atrativo baseado no título original",
  "description": "descrição persuasiva com emojis. Não inclua link.",
  "price": "o valor exato fornecido",
  "oldPrice": "valor antigo se houver, ou vazio",
  "imageUrl": "copie a URL da imagem fornecida"
}

REGRA CRÍTICA:
- NÃO adicione crases de markdown (\`\`\`json).
- O valor de TODAS as chaves deve ser STRING.
- Se não houver informação, use uma string vazia "".`;

  const groqKey = process.env.GROQ_API_KEY;
  const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqKey || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(`Erro na API do Groq: Status ${chatRes.status} - ${errText}`);
  }

  const responseJson = await chatRes.json();
  const text = responseJson.choices?.[0]?.message?.content || '';

  let parsed = { productName: input.pageTitle || "Oferta Especial", description: "Confira essa oferta!", price: "", oldPrice: "", imageUrl: "" };
  
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const extractedJson = JSON.parse(match[0]);
      parsed = {
        productName: extractedJson.productName || input.pageTitle || "",
        description: extractedJson.description || "Confira essa oferta!",
        price: extractedJson.price || "",
        oldPrice: extractedJson.oldPrice || "",
        imageUrl: extractedJson.imageUrl || "",
      };
    }
  } catch (e) {
    console.error("Erro ao fazer parse manual do JSON da IA:", e);
  }

  return parsed;
});
