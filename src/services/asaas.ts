/**
 * ═══════════════════════════════════════════════════════════
 *  ASAAS SERVICE — Linkou IA
 *  Serviço central de comunicação com a API Asaas.
 *
 *  Variáveis de ambiente necessárias (.env na VPS):
 *    ASAAS_API_KEY=<sua chave>          ← Obrigatório
 *    ASAAS_ENVIRONMENT=sandbox          ← 'sandbox' ou 'production'
 *
 *  COMO SABER SE É SANDBOX OU PRODUÇÃO:
 *    1. Acesse app.asaas.com (ou sandbox.asaas.com para testes)
 *    2. Vá em Configurações → Integrações → Chave de API
 *    3. Se a URL for sandbox.asaas.com → ASAAS_ENVIRONMENT=sandbox
 *    4. Se for app.asaas.com (conta real) → ASAAS_ENVIRONMENT=production
 * ═══════════════════════════════════════════════════════════
 */

import { db } from '../config/firebase';

// ─── Configuração da API ───────────────────────────────────
const ASAAS_ENV = process.env.ASAAS_ENVIRONMENT || 'sandbox';
const ASAAS_BASE_URL =
  ASAAS_ENV === 'production'
    ? 'https://www.asaas.com/api/v3'
    : 'https://sandbox.asaas.com/api/v3';

const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';

if (!ASAAS_API_KEY) {
  console.warn('[Asaas] ⚠️  ASAAS_API_KEY não definido no .env!');
}

console.log(`[Asaas] Modo: ${ASAAS_ENV.toUpperCase()} — URL: ${ASAAS_BASE_URL}`);

// ─── Helpers HTTP ──────────────────────────────────────────
async function asaasRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: object
): Promise<any> {
  const url = `${ASAAS_BASE_URL}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'LinkouIA/1.0',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Asaas retornou resposta inválida (${response.status}): ${text.substring(0, 200)}`);
  }

  if (!response.ok) {
    const errMsg = data?.errors?.[0]?.description || data?.message || `HTTP ${response.status}`;
    throw new Error(`[Asaas API] ${method} ${endpoint} → ${errMsg}`);
  }

  return data;
}

// ─── Planos e valores ─────────────────────────────────────
export const PLAN_VALUES: Record<string, number> = {
  lite: 14.90,
  pro: 39.90,
  premium: 69.90,
};

export const PLAN_NAMES: Record<string, string> = {
  lite: 'Lite',
  pro: 'Pro',
  premium: 'Premium',
};

/** Dias de trial gratuito antes da primeira cobrança */
export const PLAN_TRIAL_DAYS = 3;

// ─── Interfaces ────────────────────────────────────────────
export interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  nextDueDate: string;
  cycle: string;
  status: string;
  description: string;
  paymentLink?: string;
}

export interface CreditCardData {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface CreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

// ─── 1. Cliente ───────────────────────────────────────────
/**
 * Cria ou recupera um Customer do Asaas para o usuário.
 * Salva o asaasCustomerId no Firestore.
 */
export async function createOrGetCustomer(
  userId: string,
  name: string,
  email: string
): Promise<string> {
  // 1. Verifica se já temos o customerId salvo
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();

  if (userData?.asaasCustomerId) {
    return userData.asaasCustomerId as string;
  }

  // 2. Busca pelo email no Asaas
  try {
    const searchResult = await asaasRequest('GET', `/customers?email=${encodeURIComponent(email)}&limit=1`);
    if (searchResult?.data?.length > 0) {
      const customerId: string = searchResult.data[0].id;
      await db.collection('users').doc(userId).update({
        asaasCustomerId: customerId,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Asaas] Customer recuperado por email: ${customerId}`);
      return customerId;
    }
  } catch (e) {
    console.warn('[Asaas] Busca por email falhou, criando novo customer:', e);
  }

  // 3. Cria novo customer
  const cleanName = name.trim() || email.split('@')[0];
  const customer = await asaasRequest('POST', '/customers', {
    name: cleanName,
    email,
    externalReference: userId,
    notificationDisabled: false,
  }) as AsaasCustomer;

  await db.collection('users').doc(userId).update({
    asaasCustomerId: customer.id,
    updatedAt: new Date().toISOString(),
  });

  console.log(`[Asaas] Novo customer criado: ${customer.id} para userId: ${userId}`);
  return customer.id;
}

// ─── 2. Assinatura ────────────────────────────────────────
/**
 * Cria assinatura recorrente no Asaas.
 * Inclui 3 dias de trial — a primeira cobrança ocorre em PLAN_TRIAL_DAYS dias.
 */
export async function createSubscription(params: {
  customerId: string;
  planId: string;
  billingType: 'PIX' | 'CREDIT_CARD';
  remoteIp?: string;
  creditCard?: CreditCardData;
  creditCardHolderInfo?: CreditCardHolderInfo;
}): Promise<AsaasSubscription> {
  const { customerId, planId, billingType, remoteIp, creditCard, creditCardHolderInfo } = params;

  const value = PLAN_VALUES[planId];
  if (!value) throw new Error(`Plano inválido: ${planId}`);

  // Data da primeira cobrança (hoje + dias de trial)
  const firstDueDate = new Date();
  firstDueDate.setDate(firstDueDate.getDate() + PLAN_TRIAL_DAYS);
  const nextDueDateStr = firstDueDate.toISOString().split('T')[0]; // YYYY-MM-DD

  const payload: Record<string, any> = {
    customer: customerId,
    billingType,
    value,
    nextDueDate: nextDueDateStr,
    cycle: 'MONTHLY',
    description: `Linkou IA — Plano ${PLAN_NAMES[planId] || planId}`,
    externalReference: planId,
  };

  if (billingType === 'CREDIT_CARD' && creditCard && creditCardHolderInfo) {
    payload.creditCard = {
      holderName: creditCard.holderName,
      number: creditCard.number.replace(/\s/g, ''),
      expiryMonth: creditCard.expiryMonth,
      expiryYear: creditCard.expiryYear,
      ccv: creditCard.ccv,
    };
    payload.creditCardHolderInfo = {
      name: creditCardHolderInfo.name,
      email: creditCardHolderInfo.email,
      cpfCnpj: creditCardHolderInfo.cpfCnpj.replace(/\D/g, ''),
      postalCode: creditCardHolderInfo.postalCode.replace(/\D/g, ''),
      addressNumber: creditCardHolderInfo.addressNumber,
      phone: creditCardHolderInfo.phone.replace(/\D/g, ''),
    };
    payload.remoteIp = remoteIp || '0.0.0.0';
  }

  const subscription = await asaasRequest('POST', '/subscriptions', payload) as AsaasSubscription;
  console.log(`[Asaas] Assinatura criada: ${subscription.id} | Plano: ${planId} | Tipo: ${billingType}`);
  return subscription;
}

/**
 * Busca dados atuais de uma assinatura.
 */
export async function getSubscription(subscriptionId: string): Promise<AsaasSubscription> {
  return asaasRequest('GET', `/subscriptions/${subscriptionId}`);
}

/**
 * Cancela uma assinatura.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await asaasRequest('DELETE', `/subscriptions/${subscriptionId}`);
  console.log(`[Asaas] Assinatura cancelada: ${subscriptionId}`);
}

/**
 * Atualiza o plano de uma assinatura existente (upgrade/downgrade).
 */
export async function updateSubscriptionPlan(subscriptionId: string, planId: string): Promise<AsaasSubscription> {
  const value = PLAN_VALUES[planId];
  if (!value) throw new Error(`Plano inválido: ${planId}`);

  const result = await asaasRequest('PUT', `/subscriptions/${subscriptionId}`, {
    value,
    description: `Linkou IA — Plano ${PLAN_NAMES[planId] || planId}`,
    externalReference: planId,
  });

  console.log(`[Asaas] Assinatura ${subscriptionId} atualizada para plano ${planId}`);
  return result;
}

// ─── 3. Pagamentos ────────────────────────────────────────
/**
 * Lista pagamentos de uma assinatura.
 */
export async function getSubscriptionPayments(subscriptionId: string): Promise<any[]> {
  const result = await asaasRequest('GET', `/payments?subscription=${subscriptionId}&limit=20&status=PENDING,RECEIVED,CONFIRMED,OVERDUE`);
  return result?.data || [];
}

/**
 * Busca todos os pagamentos de um customer.
 */
export async function getCustomerPayments(customerId: string, limit = 20): Promise<any[]> {
  const result = await asaasRequest('GET', `/payments?customer=${customerId}&limit=${limit}`);
  return result?.data || [];
}

/**
 * Retorna QR Code PIX de um pagamento específico.
 */
export async function getPixQrCode(paymentId: string): Promise<{
  encodedImage: string;
  payload: string;
  expirationDate: string;
}> {
  return asaasRequest('GET', `/payments/${paymentId}/pixQrCode`);
}

/**
 * Retorna um único pagamento pelo ID.
 */
export async function getPayment(paymentId: string): Promise<any> {
  return asaasRequest('GET', `/payments/${paymentId}`);
}
