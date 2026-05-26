import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// -----------------------------------------------
// GET /api/posts - 게시글 목록 조회
// -----------------------------------------------
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { categoryId, resolved, page = '1', limit = '20' } = req.query;

  const skip = (Number(page) - 1) * Number(limit);

  const where: Record<string, unknown> = {};
  if (categoryId) where.categoryId = Number(categoryId);
  if (resolved !== undefined) where.isResolved = resolved === 'true';

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, name: true, school: true, grade: true } },
        category: true,
        _count: { select: { answers: true } },
      },
    }),
    prisma.post.count({ where }),
  ]);

  // views 증가 없이 목록만 반환
  res.json({
    data: posts.map(p => ({
      id: p.id,
      title: p.title,
      content: p.content.substring(0, 200), // 목록에서는 미리보기만
      views: p.views,
      isResolved: p.isResolved,
      tags: p.tags ? JSON.parse(p.tags) : [],
      createdAt: p.createdAt,
      author: p.author,
      category: p.category,
      answerCount: p._count.answers,
    })),
    meta: { total, page: Number(page), limit: Number(limit) },
  });
});

// -----------------------------------------------
// GET /api/posts/:id - 게시글 상세 조회
// -----------------------------------------------
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
      category: true,
      answers: {
        orderBy: [{ isAccepted: 'desc' }, { createdAt: 'asc' }],
        include: {
          author: { select: { id: true, name: true, school: true, grade: true } },
        },
      },
    },
  });

  if (!post) {
    res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return;
  }

  // 조회수 증가
  await prisma.post.update({ where: { id }, data: { views: { increment: 1 } } });

  res.json({
    ...post,
    tags: post.tags ? JSON.parse(post.tags) : [],
    answerCount: post.answers.length,
  });
});

// -----------------------------------------------
// POST /api/posts - 게시글 작성 (인증 필요)
// -----------------------------------------------
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, content, categoryId, tags } = req.body;

  if (!title || !content || !categoryId) {
    res.status(400).json({ message: '제목, 내용, 카테고리는 필수입니다.' });
    return;
  }

  const post = await prisma.post.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      categoryId: Number(categoryId),
      authorId: req.user!.id,
      tags: tags ? JSON.stringify(tags) : null,
    },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
      category: true,
    },
  });

  res.status(201).json({ ...post, tags: tags ?? [], answerCount: 0 });
});

// -----------------------------------------------
// POST /api/posts/:id/answers - 답변 작성 (인증 필요)
// -----------------------------------------------
router.post('/:id/answers', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const postId = Number(req.params.id);
  const { content } = req.body;

  if (!content) {
    res.status(400).json({ message: '답변 내용을 입력해주세요.' });
    return;
  }

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return;
  }

  const answer = await prisma.answer.create({
    data: {
      content: content.trim(),
      postId,
      authorId: req.user!.id,
    },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
    },
  });

  res.status(201).json(answer);
});

export default router;
