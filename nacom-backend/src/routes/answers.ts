import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { addPoints, rewardTicketsForAd } from '../lib/ticketSystem';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

// -----------------------------------------------
// POST /api/answers/watch-ad/start - 광고 시청 세션 시작 (인증 필요)
// -----------------------------------------------
router.post('/watch-ad/start', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  
  const session = await prisma.adSession.create({
    data: {
      userId,
      status: 'STARTED',
      heartbeats: 0,
    },
  });

  res.json({ sessionId: session.id });
}));

// -----------------------------------------------
// POST /api/answers/watch-ad/heartbeat - 광고 시청 heartbeat 전송 (인증 필요)
// -----------------------------------------------
router.post('/watch-ad/heartbeat', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.body;
  const userId = req.user!.id;

  if (!sessionId) {
    res.status(400).json({ message: '세션 ID가 필요합니다.' });
    return;
  }

  const session = await prisma.adSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.userId !== userId || session.status !== 'STARTED') {
    res.status(400).json({ message: '유효하지 않은 광고 세션입니다.' });
    return;
  }

  const now = Date.now();
  const elapsed = now - new Date(session.lastHeartbeat).getTime();

  // 첫 번째 heartbeat가 아닐 때, 12초 이상 heartbeat가 수신되지 않았다면 비정상 세션으로 판단하여 오류 처리
  if (session.heartbeats > 0 && elapsed > 12000) {
    await prisma.adSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' }, // 비활성화
    });
    res.status(400).json({ message: '광고 시청 세션이 만료되었습니다. 다시 시작해 주세요.' });
    return;
  }

  await prisma.adSession.update({
    where: { id: sessionId },
    data: {
      heartbeats: { increment: 1 },
      lastHeartbeat: new Date(),
    },
  });

  res.json({ message: 'heartbeat received' });
}));

// -----------------------------------------------
// POST /api/answers/watch-ad/claim - 광고 시청 완료 보상 지급 (인증 필요)
// -----------------------------------------------
router.post('/watch-ad/claim', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.body;
  const userId = req.user!.id;

  if (!sessionId) {
    res.status(400).json({ message: '세션 ID가 필요합니다.' });
    return;
  }

  const session = await prisma.adSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.userId !== userId || session.status !== 'STARTED') {
    res.status(400).json({ message: '유효하지 않은 광고 세션입니다.' });
    return;
  }

  const now = Date.now();
  const totalTime = now - new Date(session.startedAt).getTime();

  // 검증: 최소 15초 광고 시청 + 최소 3회 이상의 heartbeat 수신
  if (totalTime < 15000 || session.heartbeats < 3) {
    res.status(400).json({ message: '광고 시청 조건이 충족되지 않았습니다.' });
    return;
  }

  // 세션 완료 처리 (중복 Claim 방지를 위해 상태 변경)
  await prisma.adSession.update({
    where: { id: sessionId },
    data: {
      status: 'CLAIMED',
      completedAt: new Date(),
    },
  });

  // 티켓 2개 보상 지급
  const newTicketCount = await rewardTicketsForAd(userId);

  res.json({
    message: '광고 시청 완료! 2개의 티켓을 획득했습니다.',
    questionTickets: newTicketCount,
  });
}));

// -----------------------------------------------
// PATCH /api/answers/:id/accept - 답변 채택 (작성자만)
// -----------------------------------------------
router.patch('/:id/accept', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const answerId = Number(req.params.id);

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { post: true },
  });

  if (!answer) {
    res.status(404).json({ message: '답변을 찾을 수 없습니다.' });
    return;
  }

  // 보안: 질문 작성자만 채택 가능
  if (answer.post.authorId !== req.user!.id) {
    res.status(403).json({ message: '질문 작성자만 답변을 채택할 수 있습니다.' });
    return;
  }

  // 이미 채택된 답변이 있는지 확인
  const alreadyAccepted = await prisma.answer.findFirst({
    where: { postId: answer.postId, isAccepted: true },
  });

  if (alreadyAccepted) {
    res.status(409).json({ message: '이미 채택된 답변이 있습니다.' });
    return;
  }

  // 채택 처리 + 게시글 resolved 상태 업데이트 (트랜잭션)
  const [updatedAnswer] = await prisma.$transaction([
    prisma.answer.update({
      where: { id: answerId },
      data: { isAccepted: true },
      include: { author: { select: { id: true, name: true, school: true, grade: true } } },
    }),
    prisma.post.update({ where: { id: answer.postId }, data: { isResolved: true } }),
  ]);

  // 답변 작성자에게 채택 보상 포인트 부여 (10점)
  await addPoints(answer.authorId, 10, '답변 채택 보상');

  res.json(updatedAnswer);
}));

// -----------------------------------------------
// POST /api/answers/:id/upvote - 좋아요 (인증 필요, 1회 제한)
// -----------------------------------------------
router.post('/:id/upvote', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const answerId = Number(req.params.id);
  const userId = req.user!.id;

  const answer = await prisma.answer.findUnique({ where: { id: answerId } });
  if (!answer) {
    res.status(404).json({ message: '답변을 찾을 수 없습니다.' });
    return;
  }

  // 중복 추천 검사
  const existingUpvote = await prisma.answerUpvote.findUnique({
    where: {
      userId_answerId: {
        userId,
        answerId,
      },
    },
  });

  if (existingUpvote) {
    res.status(409).json({ message: '이미 추천한 답변입니다.' });
    return;
  }

  // 트랜잭션으로 추천 기록 생성 및 upvotes 수치 가산
  const [_, updated] = await prisma.$transaction([
    prisma.answerUpvote.create({
      data: { userId, answerId },
    }),
    prisma.answer.update({
      where: { id: answerId },
      data: { upvotes: { increment: 1 } },
    }),
  ]);

  res.json({ upvotes: updated.upvotes });
}));

export default router;

