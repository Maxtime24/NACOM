import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

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
    prisma.answer.update({ where: { id: answerId }, data: { isAccepted: true } }),
    prisma.post.update({ where: { id: answer.postId }, data: { isResolved: true } }),
  ]);

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
