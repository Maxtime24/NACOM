import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { useTicket, addPoints, refillTicketsIfNeeded } from '../lib/ticketSystem';
import { asyncHandler } from '../lib/asyncHandler';


const router = Router();

// -----------------------------------------------
// GET /api/posts - 게시글 목록 조회 (검색 기능 포함)
// -----------------------------------------------
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { categoryId, resolved, search, page = '1', limit = '20' } = req.query;

  const skip = (Number(page) - 1) * Number(limit);

  const where: Record<string, unknown> = {};
  if (categoryId) where.categoryId = Number(categoryId);
  if (resolved !== undefined) where.isResolved = resolved === 'true';
  
  // 검색 기능: 제목 또는 내용에서 검색
  if (search) {
    where.OR = [
      { title: { contains: String(search) } },
      { content: { contains: String(search) } },
    ];
  }

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
}));

// -----------------------------------------------
// GET /api/posts/my/notifications - 내 게시물에 달린 답변 알림 (인증 필요)
// -----------------------------------------------
router.get('/my/notifications', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;

  // 내가 작성한 게시물들을 조회
  const myPosts = await prisma.post.findMany({
    where: { authorId: userId },
    select: { id: true },
  });

  const myPostIds = myPosts.map(p => p.id);

  // 내 게시물에 달린 모든 답변들 (최신순)
  const notifications = await prisma.answer.findMany({
    where: { postId: { in: myPostIds } },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
      post: { select: { id: true, title: true } },
    },
  });

  res.json({
    data: notifications.map(n => ({
      id: n.id,
      content: n.content,
      isAccepted: n.isAccepted,
      upvotes: n.upvotes,
      createdAt: n.createdAt,
      author: n.author,
      post: n.post,
    })),
    total: notifications.length,
  });
}));

// -----------------------------------------------
// GET /api/posts/:id - 게시글 상세 조회
// -----------------------------------------------
router.get('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

  // 토큰 기반 중복 조회 방지 (1시간에 1회)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: number };
      const userId = decoded.id;
      
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      // 기존 조회 이력 확인
      const postView = await prisma.postView.findUnique({
        where: {
          userId_postId: {
            userId,
            postId: id,
          },
        },
      });

      if (!postView) {
        // 이력이 없으면 새로 생성하고 조회수 증가
        await prisma.$transaction([
          prisma.postView.create({
            data: { userId, postId: id },
          }),
          prisma.post.update({
            where: { id },
            data: { views: { increment: 1 } },
          }),
        ]);
        post.views += 1;
      } else if (postView.viewedAt < oneHourAgo) {
        // 1시간이 지났으면 갱신하고 조회수 증가
        await prisma.$transaction([
          prisma.postView.update({
            where: {
              userId_postId: {
                userId,
                postId: id,
              },
            },
            data: { viewedAt: new Date() },
          }),
          prisma.post.update({
            where: { id },
            data: { views: { increment: 1 } },
          }),
        ]);
        post.views += 1;
      }
    } catch (jwtError) {
      console.warn('[JWT VERIFY WARNING for POST VIEW]', jwtError);
    }
  }

  res.json({
    ...post,
    tags: post.tags ? JSON.parse(post.tags) : [],
    answerCount: post.answers.length,
  });
}));

// -----------------------------------------------
// POST /api/posts - 게시글 작성 (인증 필요, 이미지 첨부 가능)
// -----------------------------------------------
router.post('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, content, categoryId, tags, imageUrl } = req.body;
  const userId = req.user!.id;

  if (!title || !content || !categoryId) {
    res.status(400).json({ message: '제목, 내용, 카테고리는 필수입니다.' });
    return;
  }

  // 이미지 크기 제한 (Base64로 인코딩된 경우 약 10MB 제한)
  if (imageUrl && imageUrl.length > 10 * 1024 * 1024) {
    res.status(400).json({ message: '이미지 크기가 너무 큽니다. (최대 10MB)' });
    return;
  }

  // 티켓 확인 및 소비
  const hasTicket = await useTicket(userId);
  if (!hasTicket) {
    res.status(429).json({ message: '질문 티켓이 부족합니다. 광고를 시청하거나 5분을 기다려주세요.' });
    return;
  }

  const post = await prisma.post.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      categoryId: Number(categoryId),
      authorId: userId,
      tags: tags ? JSON.stringify(tags) : null,
      imageUrl: imageUrl || null,
    },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
      category: true,
    },
  });

  // 질문 작성 포인트 부여 (5점)
  await addPoints(userId, 5, '질문 작성');

  res.status(201).json({ ...post, tags: tags ?? [], answerCount: 0 });
}));

// -----------------------------------------------
// POST /api/posts/:id/answers - 답변 작성 (인증 필요)
// -----------------------------------------------
router.post('/:id/answers', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const postId = Number(req.params.id);
  const { content } = req.body;
  const userId = req.user!.id;

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
      authorId: userId,
    },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
    },
  });

  // 답변 작성 포인트 부여 (3점)
  await addPoints(userId, 3, '답변 작성');

  res.status(201).json(answer);
}));

// -----------------------------------------------
// PATCH /api/posts/:id - 게시글 수정 (작성자만)
// -----------------------------------------------
router.patch('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const postId = Number(req.params.id);
  const { title, content, categoryId, tags, imageUrl } = req.body;
  const userId = req.user!.id;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return;
  }

  // 보안: 작성자만 수정 가능
  if (post.authorId !== userId) {
    res.status(403).json({ message: '작성자만 게시글을 수정할 수 있습니다.' });
    return;
  }

  // 이미지 크기 제한
  if (imageUrl && imageUrl.length > 10 * 1024 * 1024) {
    res.status(400).json({ message: '이미지 크기가 너무 큽니다. (최대 10MB)' });
    return;
  }

  const updatedPost = await prisma.post.update({
    where: { id: postId },
    data: {
      title: title ? title.trim() : undefined,
      content: content ? content.trim() : undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      tags: tags ? JSON.stringify(tags) : undefined,
      imageUrl: imageUrl !== undefined ? imageUrl : undefined,
    },
    include: {
      author: { select: { id: true, name: true, school: true, grade: true } },
      category: true,
      _count: { select: { answers: true } },
    },
  });

  res.json({
    ...updatedPost,
    tags: updatedPost.tags ? JSON.parse(updatedPost.tags) : [],
    answerCount: updatedPost._count.answers,
  });
}));

// -----------------------------------------------
// DELETE /api/posts/:id - 게시글 삭제 (작성자만)
// -----------------------------------------------
router.delete('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const postId = Number(req.params.id);
  const userId = req.user!.id;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { answers: true },
  });

  if (!post) {
    res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    return;
  }

  // 보안: 작성자만 삭제 가능
  if (post.authorId !== userId) {
    res.status(403).json({ message: '작성자만 게시글을 삭제할 수 있습니다.' });
    return;
  }

  // 트랜잭션으로 게시글과 관련 답변 삭제
  await prisma.$transaction([
    prisma.answer.deleteMany({ where: { postId } }),
    prisma.post.delete({ where: { id: postId } }),
  ]);

  res.json({ message: '게시글이 삭제되었습니다.' });
}));

export default router;
