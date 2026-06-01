import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { addPoints, rewardTicketsForAd } from '../lib/ticketSystem';

const router = Router();

// -----------------------------------------------
// POST /api/answers/watch-ad - 광고 시청 보상 (인증 필요) - 먼저 정의!
// -----------------------------------------------
router.post('/watch-ad', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;

  try {
    const newTicketCount = await rewardTicketsForAd(userId);
    
    res.json({
      message: '광고 시청 완료! 2개의 티켓을 획득했습니다.',
      questionTickets: newTicketCount,
    });
  } catch (error) {
    res.status(500).json({ message: '티켓 충전에 실패했습니다.' });
  }
});

// -----------------------------------------------
// PATCH /api/answers/:id/accept - 답변 채택 (작성자만)
// -----------------------------------------------
router.patch('/:id/accept', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
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
});

// -----------------------------------------------
// POST /api/answers/:id/upvote - 좋아요 (인증 필요)
// -----------------------------------------------
router.post('/:id/upvote', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const answerId = Number(req.params.id);

  const answer = await prisma.answer.findUnique({ where: { id: answerId } });
  if (!answer) {
    res.status(404).json({ message: '답변을 찾을 수 없습니다.' });
    return;
  }

  const updated = await prisma.answer.update({
    where: { id: answerId },
    data: { upvotes: { increment: 1 } },
  });

  res.json({ upvotes: updated.upvotes });
});

export default router;
