import { genkit, z } from 'genkit';
import { googleAI, gemini25FlashLite } from '@genkit-ai/googleai';
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

Crie:
1. Um título chamativo (máximo 80 caracteres)
2. Uma descrição curta e persuasiva (máximo 150 caracteres)
3. Texto para WhatsApp com emojis, formatação em negrito (*texto*) e destaque no preço
4. Texto para Telegram com formatação Markdown (**negrito**) e link clicável
5. Legenda para Instagram com emojis e hashtags relevantes (mínimo 10 hashtags)

Responda usando a estrutura fornecida.`;

  // Chama o modelo Gemini via Genkit
  const response = await ai.generate({
    model: gemini25FlashLite,
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
    await db.collection('offers').add({
      userId: input.userId,
      ...input,
      ...generatedData,
      clicks: 0,
      createdAt: new Date().toISOString(),
    });
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
    model: gemini25FlashLite,
    prompt: promptText,
    config: { temperature: 0.7 }
  });

  return response.text;
});
