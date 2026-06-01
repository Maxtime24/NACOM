import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { refillTicketsIfNeeded } from '../lib/ticketSystem';

const router = Router();

// -----------------------------------------------
// POST /api/auth/register - 회원가입
// -----------------------------------------------
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, school, grade } = req.body;

  // 보안: 입력값 유효성 검사
  if (!name || !email || !password || !school || !grade) {
    res.status(400).json({ message: '모든 필드를 입력해주세요.' });
    return;
  }

  // 이메일 형식 검사
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ message: '올바른 이메일 형식을 입력해주세요.' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ message: '비밀번호는 8자리 이상이어야 합니다.' });
    return;
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
    return;
  }

  // 보안: bcrypt 해싱 (saltRounds: 12)
  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword, school, grade: Number(grade) },
    select: {
      id: true,
      name: true,
      email: true,
      school: true,
      grade: true,
      role: true,
      points: true,
      questionTickets: true,
    }
  });

  const secret = process.env.JWT_SECRET!;
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '7d' });

  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      school: user.school,
      grade: user.grade,
      role: user.role,
      points: user.points,
      questionTickets: user.questionTickets,
    },
  });
});

// -----------------------------------------------
// POST /api/auth/login - 로그인
// -----------------------------------------------
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
    return;
  }

  const user = await prisma.user.findUnique({ 
    where: { email },
    select: {
      id: true,
      password: true,
      email: true,
      role: true,
    }
  });

  // 보안: 이메일/비밀번호 불일치를 동일한 메시지로 처리 (계정 열거 공격 방지)
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    return;
  }

  // 티켓 자동 재충전
  const ticketCount = await refillTicketsIfNeeded(user.id);

  const secret = process.env.JWT_SECRET!;
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '7d' });

  // 업데이트된 사용자 정보 조회
  const updatedUser = await prisma.user.findUnique({ 
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      school: true,
      grade: true,
      role: true,
      points: true,
      questionTickets: true,
    }
  });

  res.json({
    token,
    user: {
      id: updatedUser!.id,
      name: updatedUser!.name,
      email: updatedUser!.email,
      school: updatedUser!.school,
      grade: updatedUser!.grade,
      role: updatedUser!.role,
      points: updatedUser!.points,
      questionTickets: updatedUser!.questionTickets,
    },
  });
});

export default router;
