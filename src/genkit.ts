import { genkit, z } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { db } from './config/firebase';

// Inicializa o Genkit configurado com o plugin Google AI
const ai = genkit({
  plugins: [googleAI()],
});

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
${input.category ? `Categoria: ${input.category}` : ''}
${input.platform ? `Plataforma: ${input.platform}` : ''}
${input.affiliateLink ? `Link: ${input.affiliateLink}` : 'Link: [LINK_AFILIADO]'}

Regras IMPORTANTÍSSIMAS:
1. USE APENAS OS DADOS FORNECIDOS ACIMA.
2. NÃO INVENTE características, benefícios ou especificações que não estejam contidas no nome do produto.
3. O preço, desconto e nome do produto devem ser EXATAMENTE os fornecidos. Se algo estiver em branco, não preencha nem invente.

Crie:
1. Um título chamativo (máximo 80 caracteres)
2. Uma descrição curta e persuasiva (máximo 150 caracteres)
3. Texto para WhatsApp com emojis, formatação em negrito (*texto*) e destaque no preço
4. Texto para Telegram com formatação Markdown (**negrito**) e link clicável
5. Legenda para Instagram com emojis e hashtags relevantes (mínimo 10 hashtags)

Responda usando a estrutura fornecida.`;

  // Chama o modelo Gemini via Genkit
  const response = await ai.generate({
    model: 'googleai/gemini-2.0-flash',
    prompt: prompt,
    output: { schema: OfferOutputSchema },
    config: {
      temperature: 0.8,
    }
  });

  const generatedData = response.output;
  if (!generatedData) throw new Error('Falha ao gerar oferta com Genkit.');

  // Salva no banco de dados se houver userId
  if (input.userId && db) {
    try {
      await db.collection('offers').add({
        userId: input.userId,
        ...input,
        ...generatedData,
        clicks: 0,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Falha ao salvar no Firestore (possível falta de credenciais):', e);
    }
  }

  return generatedData;
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

  const response = await ai.generate({
    model: 'googleai/gemini-2.0-flash',
    prompt: promptText,
    config: { temperature: 0.7 }
  });

  return response.text;
});

export const CreativeInputSchema = z.object({
  linkUrl: z.string(),
  finalUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  htmlContent: z.string().optional(),
});

export const CreativeOutputSchema = z.object({
  productName: z.string().optional(),
  price: z.string().optional(),
  oldPrice: z.string().optional(),
});

// Fluxo para ler link e sugerir dados do criativo
export const generateCreativeFlow = ai.defineFlow({
  name: 'generateCreativeFlow',
  inputSchema: CreativeInputSchema,
  outputSchema: CreativeOutputSchema,
}, async (input) => {
  const prompt = `Você é um robô extrator de dados de e-commerce. O usuário colou o seguinte link:
URL Original: ${input.linkUrl}
${input.finalUrl ? `URL Final (após redirecionamento): ${input.finalUrl}` : ''}
${input.pageTitle ? `Título da Página: ${input.pageTitle}` : ''}
${input.htmlContent ? `Trecho do HTML:\n${input.htmlContent}` : ''}

Sua missão é descobrir as informações reais do produto.
Regras IMPORTANTÍSSIMAS:
1. Extraia o Nome do Produto exato. Não resuma demais, não invente nomes.
2. Se o HTML não mostrar o produto ou parecer um bloqueio de robô, tente extrair o nome do produto lendo a URL Final.
3. EXTRAIA APENAS VALORES REAIS DO SITE. NUNCA invente preços, descrições ou descontos. Se você não conseguir achar o preço exato no texto fornecido, deixe os campos de preço COMPLETAMENTE VAZIOS. Não faça sugestões.
4. O preço deve ser apenas números e ponto (Ex: 199.90).
5. Se não conseguir descobrir o produto de forma alguma, deixe os campos vazios. NÃO INVENTE PRODUTOS ALEATÓRIOS.

Responda usando o JSON Schema fornecido.`;

  const response = await ai.generate({
    model: 'googleai/gemini-2.0-flash',
    prompt: prompt,
    output: { schema: CreativeOutputSchema },
    config: { temperature: 0.1 }
  });

  if (!response.output) throw new Error('Falha ao gerar dados do criativo.');
  return response.output;
});
