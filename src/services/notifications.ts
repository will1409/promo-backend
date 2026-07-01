/**
 * ═══════════════════════════════════════════════════════════
 *  NOTIFICATIONS SERVICE — Linkou IA
 *  Salva notificações internas no Firestore.
 *  Frontend escuta com onSnapshot para tempo real.
 * ═══════════════════════════════════════════════════════════
 */

import { db } from '../config/firebase';

export type NotificationType =
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_REACTIVATED'
  | 'DAYS_BEFORE_DUE_7'
  | 'DAYS_BEFORE_DUE_3'
  | 'DAYS_BEFORE_DUE_1'
  | 'PLAN_CHANGED';

interface NotificationContent {
  title: string;
  message: string;
  icon: string;
}

const getNotificationContent = (
  type: NotificationType,
  payload?: Record<string, any>
): NotificationContent => {
  switch (type) {
    case 'PAYMENT_CONFIRMED':
      return {
        title: '✅ Pagamento Confirmado!',
        message: `Seu pagamento de R$ ${(payload?.value || 0).toFixed(2).replace('.', ',')} foi confirmado. Plano ${payload?.plan || ''} ativo!`,
        icon: 'check_circle',
      };
    case 'PAYMENT_OVERDUE':
      return {
        title: '⚠️ Pagamento Vencido',
        message: `Sua cobrança de R$ ${(payload?.value || 0).toFixed(2).replace('.', ',')} está vencida. Regularize para manter o acesso.`,
        icon: 'warning',
      };
    case 'PAYMENT_PENDING':
      return {
        title: '⏳ Aguardando Pagamento',
        message: 'Seu pagamento via PIX está aguardando confirmação. Escaneie o QR Code para pagar.',
        icon: 'hourglass_empty',
      };
    case 'PAYMENT_FAILED':
      return {
        title: '❌ Falha no Pagamento',
        message: 'Houve uma falha ao processar seu cartão. Verifique os dados ou troque a forma de pagamento.',
        icon: 'error',
      };
    case 'SUBSCRIPTION_CREATED':
      return {
        title: '🎉 Assinatura Criada!',
        message: `Bem-vindo ao plano ${payload?.plan || ''}! Você tem ${payload?.trialDays || 3} dias grátis. Aproveite!`,
        icon: 'celebration',
      };
    case 'SUBSCRIPTION_CANCELED':
      return {
        title: '😢 Assinatura Cancelada',
        message: 'Sua assinatura foi cancelada. Sentiremos sua falta! Você pode reativar a qualquer momento.',
        icon: 'cancel',
      };
    case 'SUBSCRIPTION_REACTIVATED':
      return {
        title: '🚀 Assinatura Reativada!',
        message: `Plano ${payload?.plan || ''} reativado com sucesso! Boas vendas!`,
        icon: 'rocket_launch',
      };
    case 'DAYS_BEFORE_DUE_7':
      return {
        title: '📅 Vencimento em 7 dias',
        message: 'Sua assinatura vence em 7 dias. Certifique-se que seu pagamento está em dia.',
        icon: 'event',
      };
    case 'DAYS_BEFORE_DUE_3':
      return {
        title: '📅 Vencimento em 3 dias',
        message: 'Sua assinatura vence em 3 dias. Não deixe seu acesso ser bloqueado!',
        icon: 'event_upcoming',
      };
    case 'DAYS_BEFORE_DUE_1':
      return {
        title: '🔔 Vencimento AMANHÃ!',
        message: 'Sua assinatura vence amanhã. Pague agora para não perder o acesso!',
        icon: 'notifications_active',
      };
    case 'PLAN_CHANGED':
      return {
        title: '🔄 Plano Alterado',
        message: `Seu plano foi alterado de ${payload?.fromPlan || ''} para ${payload?.toPlan || ''} com sucesso!`,
        icon: 'swap_horiz',
      };
    default:
      return { title: 'Notificação', message: '', icon: 'info' };
  }
};

/**
 * Envia uma notificação interna para o usuário.
 * Salva em users/{userId}/notifications para o frontend escutar em tempo real.
 */
export async function sendNotification(
  userId: string,
  type: NotificationType,
  payload?: Record<string, any>
): Promise<void> {
  try {
    const { title, message, icon } = getNotificationContent(type, payload);

    await db
      .collection('users')
      .doc(userId)
      .collection('notifications')
      .add({
        type,
        title,
        message,
        icon,
        read: false,
        createdAt: new Date().toISOString(),
      });

    console.log(`[Notifications] ${type} → user ${userId}`);
  } catch (error) {
    // Nunca deixar falha de notificação derrubar o fluxo principal
    console.error('[Notifications] Erro ao enviar notificação:', error);
  }
}
