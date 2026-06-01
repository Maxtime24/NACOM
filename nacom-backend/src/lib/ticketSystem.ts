import prisma from './prisma';

// 상수
const MAX_TICKETS = 10;
const REFILL_INTERVAL_MS = 5 * 60 * 1000; // 5분
const AUTO_REFILL_AMOUNT = 1; // 자동 충전 수량
const AD_REWARD_AMOUNT = 2; // 광고 시청 보상

// -----------------------------------------------
// 티켓 자동 재충전 함수
// -----------------------------------------------
export async function refillTicketsIfNeeded(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({ 
    where: { id: userId },
    select: {
      id: true,
      questionTickets: true,
      lastTicketRefillAt: true,
    }
  });
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  const now = new Date();
  const lastRefill = user.lastTicketRefillAt;

  // 마지막 충전 이후 5분이 지났는지 확인
  if (lastRefill && now.getTime() - lastRefill.getTime() < REFILL_INTERVAL_MS) {
    return user.questionTickets;
  }

  // 최대 개수에 미치지 못했으면 자동 충전
  if (user.questionTickets < MAX_TICKETS) {
    const newTicketCount = Math.min(user.questionTickets + AUTO_REFILL_AMOUNT, MAX_TICKETS);
    
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          questionTickets: newTicketCount,
          lastTicketRefillAt: now,
        },
      }),
      prisma.ticketRefillHistory.create({
        data: {
          userId,
          amount: AUTO_REFILL_AMOUNT,
          reason: 'AUTO',
        },
      }),
    ]);

    return newTicketCount;
  }

  return user.questionTickets;
}

// -----------------------------------------------
// 티켓 사용 함수
// -----------------------------------------------
export async function useTicket(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ 
    where: { id: userId },
    select: { questionTickets: true }
  });
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  if (user.questionTickets <= 0) {
    return false;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { questionTickets: { decrement: 1 } },
  });

  return true;
}

// -----------------------------------------------
// 광고 시청으로 티켓 충전
// -----------------------------------------------
export async function rewardTicketsForAd(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({ 
    where: { id: userId },
    select: { questionTickets: true }
  });
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  // 최대값을 넘지 않도록 처리
  const newTicketCount = Math.min(user.questionTickets + AD_REWARD_AMOUNT, MAX_TICKETS);
  const actualReward = newTicketCount - user.questionTickets;

  if (actualReward > 0) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { questionTickets: newTicketCount },
      }),
      prisma.ticketRefillHistory.create({
        data: {
          userId,
          amount: actualReward,
          reason: 'AD',
        },
      }),
    ]);
  }

  return newTicketCount;
}

// -----------------------------------------------
// 포인트 부여 함수
// -----------------------------------------------
export async function addPoints(userId: number, points: number, reason: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { points: { increment: points } },
    select: { points: true }
  });

  console.log(`[포인트] 사용자 ${userId}에게 ${points}점 부여됨 (사유: ${reason})`);
  return user.points;
}
