import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/categories
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const categories = await prisma.category.findMany({ orderBy: { id: 'asc' } });
  res.json(categories);
});

export default router;
